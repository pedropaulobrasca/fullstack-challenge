// REQ-SAGA-03 + compensation branch: THE critical correctness test.
//
// Technique — AMQP binding manipulation (Option A from the plan):
//   Before placing the bet we DETACH the wallets-service consumer from
//   `wallet.commands` exchange by unbinding `wallet.debit.q` from the
//   exchange. wallet.debit messages still land somewhere (queue retains the
//   binding until removed) but new envelopes published by the games outbox
//   never reach the wallets handler. After the timeout fires we restore the
//   binding; the queued message is then processed and the late wallet.debited
//   arrives at games-service, which routes through the WalletDebitedHandler
//   TIMED_OUT branch -> wallet.credit compensation + saga.COMPENSATED.
//
// Timing budget:
//   SAGA_TIMEOUT_MS=2000 (override below)
//   sweep interval = 1000 (default)
//   grace = 3000 -> total waitFor = 6000 for the timeout branch
//   compensation = same again -> 6000

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties */

import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "200",
  SAGA_TIMEOUT_MS: "2000",
  SAGA_SWEEP_INTERVAL_MS: "1000",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as amqp from "amqplib";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";

const KONG_BASE = process.env.KONG_BASE_URL ?? "http://localhost:8000";
const RMQ_URL = process.env.RABBITMQ_URL ?? "amqp://admin:admin@localhost:5672";

const WALLET_COMMANDS_EXCHANGE = "wallet.commands";
const WALLET_DEBIT_QUEUE = "wallet.debit.q";
const WALLET_DEBIT_ROUTING_KEY = "wallet.debit";

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

async function unbindWalletDebitQueue(): Promise<void> {
  const conn = await amqp.connect(RMQ_URL);
  const ch = await conn.createChannel();
  try {
    await ch.unbindQueue(
      WALLET_DEBIT_QUEUE,
      WALLET_COMMANDS_EXCHANGE,
      WALLET_DEBIT_ROUTING_KEY,
    );
  } finally {
    await ch.close();
    await conn.close();
  }
}

async function rebindWalletDebitQueue(): Promise<void> {
  const conn = await amqp.connect(RMQ_URL);
  const ch = await conn.createChannel();
  try {
    await ch.bindQueue(
      WALLET_DEBIT_QUEUE,
      WALLET_COMMANDS_EXCHANGE,
      WALLET_DEBIT_ROUTING_KEY,
    );
  } finally {
    await ch.close();
    await conn.close();
  }
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

describe("saga-timeout-and-compensation integration (REQ-SAGA-03 + compensation)", () => {
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
    try {
      await rebindWalletDebitQueue();
    } catch {
      // best-effort restore — afterAll must not throw
    }
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "timeout: wallets consumer detached -> sweeper refunds -> bet.REFUNDED + saga.TIMED_OUT",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
      await unbindWalletDebitQueue();
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
      expect(String(betRows[0]?.refund_reason ?? "")).toContain("SAGA_TIMEOUT");

      const sagaRows = await booted.em
        .getConnection()
        .execute(
          "SELECT status FROM bet_saga_state WHERE bet_id = ?",
          [betId],
        );
      expect(sagaRows[0]?.status).toBe("TIMED_OUT");
    },
    45_000,
  );

  test(
    "compensation: rebind queue after timeout -> late wallet.debited -> saga.COMPENSATED + wallet.credit outbox",
    async () => {
      const rows = await booted.em
        .getConnection()
        .execute(
          "SELECT id, correlation_id FROM bets b JOIN bet_saga_state s ON s.bet_id = b.id WHERE b.player_id = ? AND s.status = 'TIMED_OUT' ORDER BY b.created_at DESC LIMIT 1",
          [playerId],
        );
      expect(rows.length).toBeGreaterThan(0);
      const betId = rows[0].id as string;
      const correlationId = rows[0].correlation_id as string;

      const balanceBeforeRebind = await getBalance(playerToken);

      await rebindWalletDebitQueue();

      await waitFor(
        async () => {
          const sagaRows = await booted.em
            .getConnection()
            .execute(
              "SELECT status FROM bet_saga_state WHERE bet_id = ?",
              [betId],
            );
          return sagaRows[0]?.status === "COMPENSATED";
        },
        20_000,
      );

      const compensationRows = await booted.em
        .getConnection()
        .execute(
          "SELECT type, routing_key FROM outbox WHERE correlation_id = ? AND type = 'wallet.credit'",
          [correlationId],
        );
      expect(compensationRows.length).toBeGreaterThan(0);
      expect(compensationRows[0].routing_key).toBe("wallet.credit");

      await waitFor(
        async () => {
          const current = await getBalance(playerToken);
          return BigInt(current) >= BigInt(balanceBeforeRebind);
        },
        20_000,
      );
    },
    60_000,
  );
});
