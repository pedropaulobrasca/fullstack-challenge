if (!process.env.INTEGRATION) {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as amqp from "amqplib";
import {
  buildEnvelope,
  envelopeToAmqpHeaders,
  EXCHANGES,
} from "@crash/messaging-spine";
import { Money } from "@crash/shared-kernel";
import {
  bootstrapWalletsApp,
  mintTestJwt,
  resetWalletsSchema,
  stopJwksServer,
} from "./setup";

let app: { stop: () => Promise<void> };
let baseUrl: string;
let em: any;

beforeAll(async () => {
  const booted = await bootstrapWalletsApp();
  app = booted;
  baseUrl = booted.baseUrl;
  em = booted.em;
  await resetWalletsSchema(em);
}, 60_000);

afterEach(async () => {
  await resetWalletsSchema(em);
});

afterAll(async () => {
  if (app) await app.stop();
  await stopJwksServer();
}, 30_000);

async function provision(playerId: string): Promise<void> {
  const token = await mintTestJwt(playerId);
  const res = await fetch(`${baseUrl}/wallets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`provision failed: ${res.status} ${await res.text()}`);
  }
}

async function publishDebit(
  playerId: string,
  cents: bigint,
  correlationId: string,
): Promise<{ messageId: string }> {
  const envelope = buildEnvelope({
    type: "wallet.debit",
    version: 1,
    correlationId,
    causationId: "test-origin",
    payload: {
      playerId,
      amount: Money.of(cents).toSnapshot(),
    },
  });
  const headers = envelopeToAmqpHeaders(envelope);
  const body = Buffer.from(JSON.stringify(envelope));
  const conn = await amqp.connect(process.env.RABBITMQ_URL!);
  try {
    const ch = await conn.createConfirmChannel();
    ch.publish(EXCHANGES.WALLET_COMMANDS, "wallet.debit", body, {
      messageId: envelope.messageId,
      type: envelope.type,
      contentType: "application/json",
      persistent: true,
      headers,
    });
    await ch.waitForConfirms();
    await ch.close();
  } finally {
    await conn.close();
  }
  return { messageId: envelope.messageId };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 8000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("wallet-debit integration", () => {
  test(
    "publish wallet.debit for 50000 against 100000 balance → balance becomes 50000 + Transaction + wallet.debited outbox",
    async () => {
      const playerId = "p-debit-happy";
      await provision(playerId);
      const correlationId = "cor-debit-happy-1";
      await publishDebit(playerId, 50000n, correlationId);

      await waitFor(async () => {
        const rows = await em.getConnection().execute(
          "SELECT balance_cents FROM wallets WHERE player_id = ?",
          [playerId],
        );
        return rows[0]?.balance_cents?.toString() === "50000";
      });

      const txRows = await em.getConnection().execute(
        "SELECT count(*)::int AS n FROM transactions WHERE wallet_id = (SELECT id FROM wallets WHERE player_id = ?) AND kind = 'DEBIT'",
        [playerId],
      );
      expect(txRows[0]?.n).toBe(1);

      const outRows = await em.getConnection().execute(
        "SELECT count(*)::int AS n FROM outbox WHERE event_type = 'wallet.debited' AND headers->>'x-correlation-id' = ?",
        [correlationId],
      );
      expect(outRows[0]?.n).toBe(1);

      const balanceRows = await em.getConnection().execute(
        "SELECT balance_cents FROM wallets WHERE player_id = ?",
        [playerId],
      );
      expect(balanceRows[0]?.balance_cents?.toString()).toBe("50000");
    },
    30_000,
  );
});
