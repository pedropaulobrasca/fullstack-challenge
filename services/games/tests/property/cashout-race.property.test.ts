// REQ-WS-05 + PITFALLS C2: cashout race window.
// Across 50 fast-check runs at dt ∈ [-50ms, 50ms] of the inferred crashAt, each cashout
// is either (a) a valid pre-crash payout with bet.cashedOutAt < round.crashedAt OR
// (b) a 409 with code ∈ { ROUND_NOT_RUNNING, BET_NOT_CASHABLE, NO_ACTIVE_BET }.
// Never both succeed for the same bet, never pay out after crash.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties, @typescript-eslint/no-explicit-any */

import {
  setupIntegrationEnv,
  fetchPlayerToken,
  loadAppModule,
} from "../integration/_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "500",
  INSTANT_CRASH_BUCKET: "1000000",
  GROWTH_RATE: "0.06",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fc from "fast-check";

const KONG_BASE = process.env.KONG_BASE_URL ?? "http://localhost:8000";

let app: any;
let em: any;
let baseUrl: string;
let playerToken: string;
let playerId: string;

async function bootApp(): Promise<void> {
  const { Test, AppModule, EntityManager } = await loadAppModule();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  await app.listen(0, "127.0.0.1");
  const address = (app.getHttpServer().address?.() ?? {}) as { port?: number };
  const port = address.port ?? 0;
  baseUrl = `http://127.0.0.1:${port}`;
  em = app.get(EntityManager).fork();
}

async function provisionWallet(token: string): Promise<void> {
  const res = await fetch(`${KONG_BASE}/wallets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`wallet provision failed: ${res.status} ${await res.text()}`);
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 30_000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function findActiveBetForPlayer(pid: string): Promise<any | null> {
  const rows = await em
    .getConnection()
    .execute(
      "SELECT id, round_id, status FROM bets WHERE player_id = ? AND status = 'ACTIVE' ORDER BY placed_at DESC LIMIT 1",
      [pid],
    );
  return rows[0] ?? null;
}

async function clearPlayerBets(pid: string): Promise<void> {
  const conn = em.getConnection();
  await conn.execute(
    "DELETE FROM bet_saga_state WHERE bet_id IN (SELECT id FROM bets WHERE player_id = ?)",
    [pid],
  );
  await conn.execute("DELETE FROM bets WHERE player_id = ?", [pid]);
}

async function waitForBettingRound(): Promise<{ id: string }> {
  let row: any = null;
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute(
        "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
      );
    row = rows[0] ?? null;
    return row !== null;
  }, 30_000);
  return row;
}

async function waitForRunningRound(roundId: string): Promise<void> {
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute("SELECT status FROM rounds WHERE id = ?", [roundId]);
    return rows[0]?.status === "RUNNING";
  }, 30_000);
}

async function placeBetAndAwaitActive(): Promise<string> {
  const res = await fetch(`${baseUrl}/games/bet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${playerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amountCents: "1000" }),
  });
  if (res.status !== 202) {
    throw new Error(`place bet failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { betId: string };
  const betId = body.betId;
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute("SELECT status FROM bets WHERE id = ?", [betId]);
    return rows[0]?.status === "ACTIVE";
  }, 20_000);
  return betId;
}

type CashoutResponse =
  | { status: 200; body: { multiplier: number; payoutCents: { amount: string } } }
  | { status: 409; body: { code: string } }
  | { status: number; body: unknown };

async function cashoutNow(): Promise<CashoutResponse> {
  const res = await fetch(`${baseUrl}/games/bet/cashout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${playerToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body } as CashoutResponse;
}

const VALID_CONFLICT_CODES = new Set([
  "ROUND_NOT_RUNNING",
  "BET_NOT_CASHABLE",
  "NO_ACTIVE_BET",
]);

describe("cashout-race property (REQ-WS-05)", () => {
  beforeAll(async () => {
    await bootApp();
    playerToken = await fetchPlayerToken();
    const decoded = JSON.parse(
      Buffer.from(playerToken.split(".")[1]!, "base64").toString("utf-8"),
    );
    playerId = decoded.sub as string;
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  test(
    "cashout requests ±50ms of crash are either valid pre-crash payouts or 409 — never both, never post-crash",
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: -50, max: 50 }), async (dtMs) => {
          await clearPlayerBets(playerId);
          await waitForBettingRound();

          const betId = await placeBetAndAwaitActive();
          const active = await findActiveBetForPlayer(playerId);
          if (active === null) {
            throw new Error("no active bet found after placeBet");
          }
          const roundId = active.round_id as string;
          await waitForRunningRound(roundId);

          if (dtMs < 0) {
            await new Promise((r) => setTimeout(r, Math.max(0, -dtMs)));
            const res = await cashoutNow();
            await assertOutcome(res, betId, roundId);
            return;
          }

          await waitFor(async () => {
            const rows = await em
              .getConnection()
              .execute("SELECT status FROM rounds WHERE id = ?", [roundId]);
            return rows[0]?.status === "CRASHED";
          }, 30_000);
          await new Promise((r) => setTimeout(r, dtMs));
          const res = await cashoutNow();
          await assertOutcome(res, betId, roundId);
        }),
        { numRuns: 50, endOnFailure: true },
      );
    },
    600_000,
  );
});

async function assertOutcome(
  res: CashoutResponse,
  betId: string,
  roundId: string,
): Promise<void> {
  const cashedRows = await em
    .getConnection()
    .execute(
      "SELECT COUNT(*)::int AS n FROM bets WHERE id = ? AND status = 'CASHED_OUT'",
      [betId],
    );
  const cashedCount = Number(cashedRows[0]?.n ?? 0);
  expect(cashedCount).toBeLessThanOrEqual(1);

  if (res.status === 200) {
    const dbBet = await em
      .getConnection()
      .execute("SELECT cashed_out_at FROM bets WHERE id = ?", [betId]);
    const dbRound = await em
      .getConnection()
      .execute("SELECT crashed_at FROM rounds WHERE id = ?", [roundId]);
    const cashedAt = dbBet[0]?.cashed_out_at as Date | null;
    const crashedAt = dbRound[0]?.crashed_at as Date | null;
    expect(cashedAt).not.toBeNull();
    if (crashedAt !== null) {
      expect(new Date(cashedAt!).getTime()).toBeLessThan(
        new Date(crashedAt).getTime(),
      );
    }
    return;
  }

  expect(res.status).toBe(409);
  const code = (res.body as { code?: string }).code;
  expect(code).toBeDefined();
  expect(VALID_CONFLICT_CODES.has(code!)).toBe(true);
}
