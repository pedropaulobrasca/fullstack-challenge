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
  type TestHarness,
} from "./_helpers/harness";

const LATENCY_THRESHOLD_MS = 500;
const ITERATIONS = 5;
const POLL_INTERVAL_MS = 100;

@Injectable()
class WakeProbeConsumer {
  readonly logger = new Logger(WakeProbeConsumer.name);

  constructor(
    readonly em: EntityManager,
    readonly cls: ClsService,
    readonly inbox: InboxRepository,
  ) {}

  @IdempotentSubscribe({
    exchange: "wallet.events",
    routingKey: "test.wake",
    queue: "test.q",
    consumerName: "test.probe.wake",
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

describe("listen-notify-wake", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await bootHarness({
      extraProviders: [WakeProbeConsumer],
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  }, 180_000);

  afterAll(async () => {
    if (harness) await shutdownHarness(harness);
  }, 60_000);

  test(
    "outbox row insert triggers LISTEN/NOTIFY wake; publish + consume latency below threshold",
    async () => {
      const latencies: number[] = [];

      for (let i = 0; i < ITERATIONS; i += 1) {
        const probeId = `wake-${Date.now()}-${i}`;
        const em = harness.em.fork();

        await em.transactional(async (txEm) => {
          const probe = new MessagingProbe();
          probe.id = probeId;
          probe.label = `wake-${i}`;
          probe.sideEffectCount = 0;
          txEm.persist(probe);
        });

        const envelope = buildEnvelope({
          type: "test.wake",
          payload: { probeId },
          causationId: `origin-wake-${i}`,
        });

        const startedAt = performance.now();
        await em.transactional(async (txEm) => {
          const repo = new OutboxRepository(txEm);
          await repo.add(envelope, {
            exchange: "wallet.events",
            routingKey: "test.wake",
            aggregateType: "MessagingProbe",
            aggregateId: probeId,
          });
        });

        await waitFor(async () => {
          const fresh = harness.em.fork();
          const row = await fresh.findOne(MessagingProbeSchema, {
            id: probeId,
          });
          return row?.sideEffectCount === 1;
        }, 15_000);

        const elapsedMs = performance.now() - startedAt;
        latencies.push(elapsedMs);
      }

      latencies.sort((a, b) => a - b);
      const median = latencies[Math.floor(latencies.length / 2)] ?? 0;
      const max = latencies[latencies.length - 1] ?? 0;
      console.log(
        `[listen-notify-wake] latencies (ms): ${latencies
          .map((n) => n.toFixed(1))
          .join(", ")} — median=${median.toFixed(1)} max=${max.toFixed(1)}`,
      );

      expect(median).toBeLessThan(LATENCY_THRESHOLD_MS);
    },
    180_000,
  );
});
