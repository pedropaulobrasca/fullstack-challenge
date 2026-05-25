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

interface DebitEnvelope {
  messageId: string;
  correlationId: string;
  causationId: string;
  type: "wallet.debit";
  version: number;
  occurredAt: string;
  payload: { playerId: string; amount: ReturnType<Money["toSnapshot"]> };
}

async function publishEnvelope(envelope: DebitEnvelope): Promise<void> {
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

describe("inbox-replay integration", () => {
  test(
    "same messageId published twice → handler runs once; Transaction count = 1; inbox row count = 1",
    async () => {
      const playerId = "p-replay";
      await provision(playerId);

      const envelope = buildEnvelope({
        type: "wallet.debit",
        version: 1,
        correlationId: "cor-replay-1",
        causationId: "origin-replay",
        payload: {
          playerId,
          amount: Money.of(10000n).toSnapshot(),
        },
      }) as unknown as DebitEnvelope;

      await publishEnvelope(envelope);
      await waitFor(async () => {
        const rows = await em.getConnection().execute(
          "SELECT balance_cents FROM wallets WHERE player_id = ?",
          [playerId],
        );
        return rows[0]?.balance_cents?.toString() === "90000";
      });

      await publishEnvelope(envelope);
      await new Promise((r) => setTimeout(r, 2000));

      const balance = await em.getConnection().execute(
        "SELECT balance_cents FROM wallets WHERE player_id = ?",
        [playerId],
      );
      expect(balance[0]?.balance_cents?.toString()).toBe("90000");

      const tx = await em.getConnection().execute(
        "SELECT count(*)::int AS n FROM transactions WHERE message_id = ?",
        [envelope.messageId],
      );
      expect(tx[0]?.n).toBe(1);

      const inbox = await em.getConnection().execute(
        "SELECT count(*)::int AS n FROM inbox WHERE message_id = ? AND consumer_name = 'wallets.debit'",
        [envelope.messageId],
      );
      expect(inbox[0]?.n).toBe(1);
    },
    45_000,
  );
});
