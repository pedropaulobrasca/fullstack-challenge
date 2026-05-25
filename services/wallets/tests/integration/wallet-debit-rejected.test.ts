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
): Promise<void> {
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

describe("wallet-debit-rejected integration", () => {
  test(
    "publish wallet.debit for 200000 against 100000 balance → balance unchanged + wallet.debit.rejected{INSUFFICIENT_FUNDS} + no Transaction row",
    async () => {
      const playerId = "p-debit-reject";
      await provision(playerId);
      const correlationId = "cor-debit-reject-1";
      await publishDebit(playerId, 200000n, correlationId);

      await waitFor(async () => {
        const rows = await em.getConnection().execute(
          "SELECT count(*)::int AS n FROM outbox WHERE event_type = 'wallet.debit.rejected' AND headers->>'x-correlation-id' = ?",
          [correlationId],
        );
        return rows[0]?.n === 1;
      });

      const balance = await em.getConnection().execute(
        "SELECT balance_cents FROM wallets WHERE player_id = ?",
        [playerId],
      );
      expect(balance[0]?.balance_cents?.toString()).toBe("100000");

      const tx = await em.getConnection().execute(
        "SELECT count(*)::int AS n FROM transactions WHERE wallet_id = (SELECT id FROM wallets WHERE player_id = ?)",
        [playerId],
      );
      expect(tx[0]?.n).toBe(0);

      const out = await em.getConnection().execute(
        "SELECT payload FROM outbox WHERE event_type = 'wallet.debit.rejected' AND headers->>'x-correlation-id' = ?",
        [correlationId],
      );
      const payload = out[0]?.payload;
      const reason =
        typeof payload === "string" ? JSON.parse(payload).reason : payload?.reason;
      expect(reason).toBe("INSUFFICIENT_FUNDS");
    },
    30_000,
  );
});
