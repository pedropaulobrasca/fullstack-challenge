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
class DedupProbeConsumer {
  readonly logger = new Logger(DedupProbeConsumer.name);

  constructor(
    readonly em: EntityManager,
    readonly cls: ClsService,
    readonly inbox: InboxRepository,
  ) {}

  @IdempotentSubscribe({
    exchange: "wallet.events",
    routingKey: "test.dedup",
    queue: "test.q",
    consumerName: "test.probe.dedup",
  })
  async onProbe(envelope: {
    payload: { probeId: string };
  }): Promise<void> {
    const probeId = envelope.payload.probeId;
    await this.em
      .getConnection()
      .execute(
        "UPDATE messaging_probe SET side_effect_count = side_effect_count + 1 WHERE id = ?",
        [probeId],
      );
  }
}

describe("inbox-dedup", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await bootHarness({
      extraProviders: [DedupProbeConsumer],
      pollIntervalMs: 200,
    });
  }, 120_000);

  afterAll(async () => {
    if (harness) await shutdownHarness(harness);
  }, 60_000);

  test(
    "same messageId redelivered twice → handler invoked exactly once",
    async () => {
      const probeId = `dedup-${Date.now()}`;
      const em = harness.em.fork();
      await em.transactional(async (txEm) => {
        const probe = new MessagingProbe();
        probe.id = probeId;
        probe.label = "dedup-target";
        probe.sideEffectCount = 0;
        txEm.persist(probe);
      });

      const envelope = buildEnvelope({
        type: "test.dedup",
        payload: { probeId },
        causationId: "origin-dedup",
      });
      const headers = envelopeToAmqpHeaders(envelope);
      const body = Buffer.from(JSON.stringify(envelope));

      const conn = await amqp.connect(harness.amqpUrl);
      try {
        const channel = await conn.createConfirmChannel();
        for (let i = 0; i < 2; i += 1) {
          channel.publish("wallet.events", "test.dedup", body, {
            messageId: envelope.messageId,
            type: envelope.type,
            contentType: "application/json",
            persistent: true,
            headers,
          });
        }
        await channel.waitForConfirms();
        await channel.close();
      } finally {
        await conn.close();
      }

      await waitFor(async () => {
        const fresh = harness.em.fork();
        const row = await fresh.findOne(MessagingProbeSchema, { id: probeId });
        return row?.sideEffectCount === 1;
      }, 15_000);

      await new Promise((r) => setTimeout(r, 1500));

      await withPgClient(harness.databaseUrl, async (client) => {
        const fresh = harness.em.fork();
        const row = await fresh.findOne(MessagingProbeSchema, { id: probeId });
        expect(row?.sideEffectCount).toBe(1);

        const inboxRows = await client.query<{ message_id: string }>(
          "SELECT message_id FROM inbox WHERE consumer_name = $1 AND message_id = $2",
          ["test.probe.dedup", envelope.messageId],
        );
        expect(inboxRows.rows.length).toBe(1);
      });
    },
    60_000,
  );
});
