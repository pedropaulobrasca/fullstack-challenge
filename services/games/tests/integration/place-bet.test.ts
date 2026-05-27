// Happy bet placement: REQ-GAME-06 + REQ-SAGA-01 (confirm branch).
//
// Drives the saga end-to-end against the live docker stack:
//   POST /games/bet (in-process app) -> outbox -> RMQ wallet.commands ->
//   wallets-service WalletDebitHandler -> outbox wallet.events.wallet.debited ->
//   games WalletDebitedHandler -> bet.PENDING -> bet.ACTIVE, saga.CONFIRMED.
//
// Wallet provisioning goes through Kong at :8000 because wallets is a separate
// process in the docker stack; games is bootstrapped in-process so that the
// in-process EntityManager can directly observe bet + saga rows.
//
// Timing budget: SAGA_TIMEOUT_MS (5s) + sweep interval + cross-service round
// trip grace; waitFor budgets default to 15s for confirm assertions.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties */

import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "200",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";

const KONG_BASE = process.env.KONG_BASE_URL ?? "http://localhost:8000";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;
let playerToken: string;
let playerId: string;

async function provisionWallet(token: string): Promise<void> {
  const res = await fetch(`${KONG_BASE}/wallets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`wallet provision failed: ${res.status} ${await res.text()}`);
  }
}

async function getBalance(token: string): Promise<string> {
  const res = await fetch(`${KONG_BASE}/wallets/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`wallet me failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    balance: { amount: string };
  };
  return body.balance.amount;
}

async function waitForBetting(em: any, timeoutMs = 10_000): Promise<string> {
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute(
        "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
      );
    return rows[0] !== undefined;
  }, timeoutMs);
  const rows = await em
    .getConnection()
    .execute(
      "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
    );
  return rows[0].id as string;
}

async function clearPlayerBetState(em: any, pid: string): Promise<void> {
  const conn = em.getConnection();
  await conn.execute(
    "DELETE FROM bet_saga_state WHERE bet_id IN (SELECT id FROM bets WHERE player_id = ?)",
    [pid],
  );
  await conn.execute("DELETE FROM bets WHERE player_id = ?", [pid]);
}

describe("place-bet integration (REQ-GAME-06 + REQ-SAGA-01 happy path)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    await truncateGamesTables(booted.em);
    await booted.app.close();
    booted = await createTestGamesApp();

    playerToken = await fetchPlayerToken();
    const payload = JSON.parse(
      Buffer.from(playerToken.split(".")[1]!, "base64").toString("utf-8"),
    );
    playerId = payload.sub as string;
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "place bet 100.00 -> saga.CONFIRMED, bet.ACTIVE, wallet debited",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
      const balanceBefore = await getBalance(playerToken);

      await waitForBetting(booted.em);

      const placeRes = await fetch(`${booted.baseUrl}/games/bet`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${playerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amountCents: "10000" }),
      });
      expect(placeRes.status).toBe(202);
      const placeBody = (await placeRes.json()) as {
        betId: string;
        status: string;
      };
      expect(placeBody.betId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(placeBody.status).toBe("PENDING");
      const betId = placeBody.betId;

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute("SELECT status FROM bets WHERE id = ?", [betId]);
          return rows[0]?.status === "ACTIVE";
        },
        15_000,
      );

      const sagaRows = await booted.em
        .getConnection()
        .execute("SELECT status FROM bet_saga_state WHERE bet_id = ?", [betId]);
      expect(sagaRows[0]?.status).toBe("CONFIRMED");

      await waitFor(
        async () => {
          const current = await getBalance(playerToken);
          return BigInt(current) === BigInt(balanceBefore) - 10000n;
        },
        15_000,
      );

      const outboxRows = await booted.em
        .getConnection()
        .execute(
          "SELECT type FROM outbox WHERE aggregate_id = ? ORDER BY created_at ASC",
          [betId],
        );
      const types = outboxRows.map((r: any) => r.type);
      expect(types).toContain("wallet.debit");
      expect(types).toContain("bet.active");
    },
    45_000,
  );
});
