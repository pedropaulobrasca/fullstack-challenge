if (!process.env.INTEGRATION) {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";

import { buildEnvelope } from "../../src/envelope/build-envelope";
import { CORRELATION_ID_KEY } from "../../src/context/correlation-tokens";
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
class HeaderProbeConsumer {
  readonly logger = new Logger(HeaderProbeConsumer.name);

  constructor(
    readonly em: EntityManager,
    readonly cls: ClsService,
    readonly inbox: InboxRepository,
    readonly outbox: OutboxRepository,
  ) {}

  @IdempotentSubscribe({
    exchange: "wallet.events",
    routingKey: "test.headers",
    queue: "test.q",
    consumerName: "test.probe.headers",
  })
  async onProbe(envelope: {
    messageId: string;
    payload: { probeId: string };
  }): Promise<void> {
    const observedCorrelationId = this.cls.get<string>(CORRELATION_ID_KEY);
    const probeId = envelope.payload.probeId;
    await this.em
      .getConnection()
      .execute(
        "UPDATE messaging_probe SET label = ?, side_effect_count = side_effect_count + 1 WHERE id = ?",
        [`obs-${observedCorrelationId}`, probeId],
      );

    const downstream = buildEnvelope({
      type: "test.echo",
      payload: { fromProbe: probeId },
      causationId: envelope.messageId,
      correlationId: observedCorrelationId,
    });
    await this.outbox.add(downstream, {
      exchange: "wallet.events",
      routingKey: "test.echo",
      aggregateType: "MessagingProbe",
      aggregateId: probeId,
    });
    await this.em.flush();
  }
}

describe("envelope-headers", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await bootHarness({
      extraProviders: [HeaderProbeConsumer],
      pollIntervalMs: 200,
    });
  }, 120_000);

  afterAll(async () => {
    if (harness) await shutdownHarness(harness);
  }, 60_000);

  test(
    "correlationId propagates via CLS and downstream causationId chains to upstream messageId",
    async () => {
      const probeId = `hdr-${Date.now()}`;
      const correlationId = `corr-xyz-${Date.now()}`;

      const upstream = buildEnvelope({
        type: "test.headers",
        payload: { probeId },
        causationId: "origin-xyz",
        correlationId,
      });

      const em = harness.em.fork();
      await em.transactional(async (txEm) => {
        const probe = new MessagingProbe();
        probe.id = probeId;
        probe.label = "pending";
        probe.sideEffectCount = 0;
        txEm.persist(probe);

        const repo = new OutboxRepository(txEm);
        await repo.add(upstream, {
          exchange: "wallet.events",
          routingKey: "test.headers",
          aggregateType: "MessagingProbe",
          aggregateId: probeId,
        });
      });

      await waitFor(async () => {
        const fresh = harness.em.fork();
        const row = await fresh.findOne(MessagingProbeSchema, { id: probeId });
        return row?.label === `obs-${correlationId}`;
      }, 20_000);

      const fresh = harness.em.fork();
      const probeRow = await fresh.findOne(MessagingProbeSchema, { id: probeId });
      expect(probeRow?.label).toBe(`obs-${correlationId}`);

      await withPgClient(harness.databaseUrl, async (client) => {
        const echoRows = await client.query<{
          headers: Record<string, unknown>;
          event_type: string;
        }>(
          "SELECT headers, event_type FROM outbox WHERE event_type = $1 AND aggregate_id = $2",
          ["test.echo", probeId],
        );
        expect(echoRows.rows.length).toBe(1);
        const echo = echoRows.rows[0];
        expect(echo?.headers["x-causation-id"]).toBe(upstream.messageId);
        expect(echo?.headers["x-correlation-id"]).toBe(correlationId);
      });
    },
    60_000,
  );
});
