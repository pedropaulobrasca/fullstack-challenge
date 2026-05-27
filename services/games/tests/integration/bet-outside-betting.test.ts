// REQ-GAME-08 Phase 5 surface: POST /games/bet outside the BETTING phase ->
// 409 ROUND_NOT_IN_BETTING_PHASE { phase: 'RUNNING' | 'CRASHED' | 'COOLDOWN' }.
// The aggregate-level guard (Round.acceptBet) closes the doc drift identified
// in Phase 4 verification.
//
// We don't simulate NO_OPEN_ROUND here — forcing the loop into that state is
// fragile; the use-case unit test in plan 05-04 already covers it.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties */

import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "200",
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

async function provisionWallet(token: string): Promise<void> {
  const res = await fetch(`${KONG_BASE}/wallets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`wallet provision failed: ${res.status} ${await res.text()}`);
  }
}

describe("bet-outside-betting integration (REQ-GAME-08)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    await truncateGamesTables(booted.em);
    await booted.app.close();
    booted = await createTestGamesApp();

    playerToken = await fetchPlayerToken();
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "POST /games/bet during RUNNING -> 409 ROUND_NOT_IN_BETTING_PHASE",
    async () => {
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

      const placeRes = await fetch(`${booted.baseUrl}/games/bet`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${playerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amountCents: "10000" }),
      });
      expect(placeRes.status).toBe(409);
      const body = await placeRes.json();
      const code = body.message?.code ?? body.code;
      const phase = body.message?.phase ?? body.phase;
      expect(code).toBe("ROUND_NOT_IN_BETTING_PHASE");
      expect(["RUNNING", "CRASHED", "COOLDOWN", "SETTLED"]).toContain(phase);
    },
    30_000,
  );
});
