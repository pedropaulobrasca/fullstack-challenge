if (!process.env.INTEGRATION) {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";
import * as amqp from "amqplib";

import { buildEnvelope } from "../../src/envelope/build-envelope";
import { envelopeToAmqpHeaders } from "../../src/envelope/envelope-headers";
import { IdempotentSubscribe } from "../../src/inbox/idempotent-subscribe.decorator";
import { InboxRepository } from "../../src/inbox/inbox-repository";
import {
  MessagingProbe,
  MessagingProbeSchema,
} from "./_helpers/messaging-probe.entity";
import {
  bootHarness,
  shutdownHarness,
  waitFor,
  withPgClient,
  type TestHarness,
} from "./_helpers/harness";

@Injectable()
class KillRecoveryConsumer {
  readonly logger = new Logger(KillRecoveryConsumer.name);

  constructor(
    readonly em: EntityManager,
    readonly cls: ClsService,
    readonly inbox: InboxRepository,
  ) {}

  @IdempotentSubscribe({
    exchange: "wallet.events",
    routingKey: "test.kill9",
    queue: "test.q",
    consumerName: "test.probe.kill9",
  })
  async onProbe(envelope: {
    payload: { payload: { probeId: string } };
  }): Promise<void> {
    const probeId = envelope.payload.payload.probeId;
    await this.em
      .getConnection()
      .execute(
        "UPDATE messaging_probe SET side_effect_count = side_effect_count + 1 WHERE id = ?",
        [probeId],
      );
  }
}

describe("kill-9-recovery", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await bootHarness({
      extraProviders: [KillRecoveryConsumer],
      pollIntervalMs: 200,
    });
  }, 180_000);

  afterAll(async () => {
    if (harness) await shutdownHarness(harness);
  }, 60_000);

  test(
    "publisher crash mid-confirm → outbox row still PENDING → recovery republishes → dedup absorbs duplicate",
    async () => {
      const probeId = `kill9-${Date.now()}`;
      const em = harness.em.fork();
      await em.transactional(async (txEm) => {
        const probe = new MessagingProbe();
        probe.id = probeId;
        probe.label = "kill9-target";
        probe.sideEffectCount = 0;
        txEm.persist(probe);
      });

      const envelope = buildEnvelope({
        type: "test.kill9",
        payload: { probeId },
        causationId: `origin-kill9-${probeId}`,
      });
      const headers = envelopeToAmqpHeaders(envelope);
      const body = Buffer.from(JSON.stringify(envelope));

      await withPgClient(harness.databaseUrl, async (client) => {
        await client.query(
          `INSERT INTO outbox (message_id, aggregate_type, aggregate_id, event_type, event_version, exchange, routing_key, payload, headers, status, attempts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
          [
            envelope.messageId,
            "MessagingProbe",
            probeId,
            envelope.type,
            envelope.version,
            "wallet.events",
            "test.kill9",
            JSON.stringify(envelope.payload),
            JSON.stringify(headers),
            "PENDING",
            0,
          ],
        );
      });

      const conn = await amqp.connect(harness.amqpUrl);
      try {
        const channel = await conn.createConfirmChannel();
        channel.publish("wallet.events", "test.kill9", body, {
          messageId: envelope.messageId,
          type: envelope.type,
          contentType: "application/json",
          persistent: true,
          headers,
        });
        await channel.close();
      } finally {
        await conn.close();
      }

      await waitFor(async () => {
        const fresh = harness.em.fork();
        const row = await fresh.findOne(MessagingProbeSchema, { id: probeId });
        return row?.sideEffectCount === 1;
      }, 20_000);

      await new Promise((r) => setTimeout(r, 2000));

      await withPgClient(harness.databaseUrl, async (client) => {
        const probeRows = await client.query<{ side_effect_count: number }>(
          "SELECT side_effect_count FROM messaging_probe WHERE id = $1",
          [probeId],
        );
        expect(probeRows.rows[0]?.side_effect_count).toBe(1);

        const outboxRows = await client.query<{ status: string }>(
          "SELECT status FROM outbox WHERE message_id = $1",
          [envelope.messageId],
        );
        expect(outboxRows.rows[0]?.status).toBe("PUBLISHED");

        const inboxRows = await client.query<{ message_id: string }>(
          "SELECT message_id FROM inbox WHERE consumer_name = $1 AND message_id = $2",
          ["test.probe.kill9", envelope.messageId],
        );
        expect(inboxRows.rows.length).toBe(1);
      });
    },
    90_000,
  );
});
