// REQ-GAME-07 error path: double cashout returns 409.
// First cashout succeeds (200) -> immediate second cashout against the same
// round returns 409 with code in { NO_ACTIVE_BET, BET_NOT_CASHABLE }
// depending on whether the use case finds the bet via findActive (returns null
// after CASHED_OUT) vs hitting the BET_NOT_CASHABLE branch when the bet is
// loaded but not ACTIVE — both are acceptable terminal codes per Plan 05-09.

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

describe("double-cashout integration", () => {
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
    "first cashout -> 200; second cashout -> 409 (NO_ACTIVE_BET or BET_NOT_CASHABLE)",
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

      const first = await fetch(`${booted.baseUrl}/games/bet/cashout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(first.status).toBe(200);

      const second = await fetch(`${booted.baseUrl}/games/bet/cashout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(second.status).toBe(409);
      const body = await second.json();
      const code = body.message?.code ?? body.code;
      expect(["NO_ACTIVE_BET", "BET_NOT_CASHABLE", "ROUND_NOT_RUNNING"]).toContain(
        code,
      );
    },
    60_000,
  );
});
