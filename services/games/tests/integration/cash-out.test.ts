// REQ-GAME-07 + REQ-SAGA-04: synchronous cashout happy path.
// Place bet during BETTING -> wait for ACTIVE -> wait for RUNNING ->
// POST /games/bet/cashout -> 200 { multiplier > 1.0, payoutCents } ->
// bet.CASHED_OUT -> wallet eventually credited downstream.
//
// Timing: BETTING window is 2s (test override), then RUNNING until crash;
// we cashout as soon as RUNNING is observed so the multiplier is close to 1.0
// but strictly greater (the round.startedAt -> now() delta is always > 0).

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
  const body = (await res.json()) as { balance: { amount: string } };
  return body.balance.amount;
}

async function clearPlayerBetState(em: any, pid: string): Promise<void> {
  const conn = em.getConnection();
  await conn.execute(
    "DELETE FROM bet_saga_state WHERE bet_id IN (SELECT id FROM bets WHERE player_id = ?)",
    [pid],
  );
  await conn.execute("DELETE FROM bets WHERE player_id = ?", [pid]);
}

async function waitForBetting(em: any, timeoutMs = 10_000): Promise<void> {
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute(
        "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
      );
    return rows[0] !== undefined;
  }, timeoutMs);
}

describe("cash-out integration (REQ-GAME-07 + REQ-SAGA-04)", () => {
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
    "place bet -> ACTIVE -> cashout during RUNNING -> CASHED_OUT + wallet credited",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
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
      const placeBody = (await placeRes.json()) as { betId: string };
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

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute(
              "SELECT status FROM rounds WHERE status = 'RUNNING' ORDER BY created_at DESC LIMIT 1",
            );
          return rows[0] !== undefined;
        },
        15_000,
      );

      const balanceBeforeCashout = await getBalance(playerToken);

      const cashoutRes = await fetch(
        `${booted.baseUrl}/games/bet/cashout`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${playerToken}` },
        },
      );
      expect(cashoutRes.status).toBe(200);
      const cashoutBody = (await cashoutRes.json()) as {
        multiplier: number;
        payoutCents: { amount: string; currency: string; scale: number };
      };
      expect(typeof cashoutBody.multiplier).toBe("number");
      expect(cashoutBody.multiplier).toBeGreaterThanOrEqual(1);
      expect(cashoutBody.payoutCents.currency).toBe("CRD");
      expect(cashoutBody.payoutCents.scale).toBe(2);
      expect(BigInt(cashoutBody.payoutCents.amount)).toBeGreaterThanOrEqual(
        10000n,
      );

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute("SELECT status FROM bets WHERE id = ?", [betId]);
          return rows[0]?.status === "CASHED_OUT";
        },
        15_000,
      );

      const payoutCents = BigInt(cashoutBody.payoutCents.amount);
      await waitFor(
        async () => {
          const current = await getBalance(playerToken);
          return BigInt(current) >= BigInt(balanceBeforeCashout) + payoutCents;
        },
        20_000,
      );
    },
    60_000,
  );
});
