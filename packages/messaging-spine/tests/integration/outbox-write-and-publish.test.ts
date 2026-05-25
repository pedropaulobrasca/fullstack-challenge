if (!process.env.INTEGRATION) {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";

import { buildEnvelope } from "../../src/envelope/build-envelope";
import { IdempotentSubscribe } from "../../src/inbox/idempotent-subscribe.decorator";
import { InboxRepository } from "../../src/inbox/inbox-repository";
import { OutboxRepository } from "../../src/outbox/outbox-repository";
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
class CounterProbeConsumer {
  readonly logger = new Logger(CounterProbeConsumer.name);

  constructor(
    readonly em: EntityManager,
    readonly cls: ClsService,
    readonly inbox: InboxRepository,
  ) {}

  @IdempotentSubscribe({
    exchange: "wallet.events",
    routingKey: "test.probe",
    queue: "test.q",
    consumerName: "test.probe.counter",
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

describe("outbox-write-and-publish", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await bootHarness({
      extraProviders: [CounterProbeConsumer],
      pollIntervalMs: 200,
    });
  }, 180_000);

  afterAll(async () => {
    if (harness) await shutdownHarness(harness);
  }, 60_000);

  test(
    "writes probe + outbox row in same TX, publishes, consumer dedups via inbox",
    async () => {
      const em = harness.em.fork();
      const probeId = `p-${Date.now()}`;

      await em.transactional(async (txEm) => {
        const probe = new MessagingProbe();
        probe.id = probeId;
        probe.label = "hello";
        probe.sideEffectCount = 0;
        txEm.persist(probe);

        const envelope = buildEnvelope({
          type: "test.probe",
          payload: { probeId },
          causationId: "origin-1",
        });
        const repo = new OutboxRepository(txEm);
        await repo.add(envelope, {
          exchange: "wallet.events",
          routingKey: "test.probe",
          aggregateType: "MessagingProbe",
          aggregateId: probeId,
        });
      });

      await waitFor(async () => {
        const fresh = harness.em.fork();
        const row = await fresh.findOne(MessagingProbeSchema, { id: probeId });
        return row?.sideEffectCount === 1;
      }, 15_000);

      await withPgClient(harness.databaseUrl, async (client) => {
        const outboxRows = await client.query<{
          status: string;
          aggregate_id: string;
        }>("SELECT status, aggregate_id FROM outbox WHERE aggregate_id = $1", [
          probeId,
        ]);
        expect(outboxRows.rows.length).toBe(1);
        expect(outboxRows.rows[0]?.status).toBe("PUBLISHED");

        const inboxRows = await client.query<{ consumer_name: string }>(
          "SELECT consumer_name FROM inbox WHERE consumer_name = $1",
          ["test.probe.counter"],
        );
        expect(inboxRows.rows.length).toBeGreaterThanOrEqual(1);
      });
    },
    60_000,
  );
});
