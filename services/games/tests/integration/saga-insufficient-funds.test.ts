// REQ-SAGA-01 rejection branch: place bet exceeding wallet balance ->
// wallet.debit.rejected{INSUFFICIENT_FUNDS} -> bet.REFUNDED + saga.REFUNDED.
//
// Wallet is provisioned then debited down via direct AMQP-side debits is not
// possible here, so we set INITIAL_BALANCE assumptions and bet ABOVE the
// available balance. The default initial balance is 100000 cents; we burn the
// balance first via a single 100% bet then place a second bet larger than
// what remains. Simpler: bet bigger than INITIAL_BALANCE_CENTS in one shot.
// REQ default initial balance is 1000.00 (100000 cents); we bet 2000.00.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties */

import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "200",
  BET_MAX_CENTS: "10000000",
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

async function clearPlayerBetState(em: any, pid: string): Promise<void> {
  const conn = em.getConnection();
  await conn.execute(
    "DELETE FROM bet_saga_state WHERE bet_id IN (SELECT id FROM bets WHERE player_id = ?)",
    [pid],
  );
  await conn.execute("DELETE FROM bets WHERE player_id = ?", [pid]);
}

describe("saga-insufficient-funds integration (REQ-SAGA-01 rejection)", () => {
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
    "bet > balance -> bet.REFUNDED w/ INSUFFICIENT_FUNDS + saga.REFUNDED + balance unchanged",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
      const balanceBefore = await getBalance(playerToken);
      const huge = (BigInt(balanceBefore) + 100000n).toString();

      await waitForBetting(booted.em);

      const placeRes = await fetch(`${booted.baseUrl}/games/bet`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${playerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amountCents: huge }),
      });
      expect(placeRes.status).toBe(202);
      const placeBody = (await placeRes.json()) as {
        betId: string;
        status: string;
      };
      expect(placeBody.status).toBe("PENDING");
      const betId = placeBody.betId;

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute(
              "SELECT status, refund_reason FROM bets WHERE id = ?",
              [betId],
            );
          return rows[0]?.status === "REFUNDED";
        },
        15_000,
      );

      const betRows = await booted.em
        .getConnection()
        .execute(
          "SELECT status, refund_reason FROM bets WHERE id = ?",
          [betId],
        );
      expect(betRows[0]?.status).toBe("REFUNDED");
      expect(String(betRows[0]?.refund_reason ?? "")).toContain(
        "INSUFFICIENT_FUNDS",
      );

      const sagaRows = await booted.em
        .getConnection()
        .execute(
          "SELECT status FROM bet_saga_state WHERE bet_id = ?",
          [betId],
        );
      expect(sagaRows[0]?.status).toBe("REFUNDED");

      const balanceAfter = await getBalance(playerToken);
      expect(balanceAfter).toBe(balanceBefore);
    },
    45_000,
  );
});
