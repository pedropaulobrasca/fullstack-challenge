if (!process.env.INTEGRATION) {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";
import { RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import type { ConsumeMessage } from "amqplib";

import { buildEnvelope } from "../../src/envelope/build-envelope";
import { DeadLetterConsumer } from "../../src/dead-letter/dead-letter-consumer.service";
import { DeadLetterRepository } from "../../src/dead-letter/dead-letter-repository";
import { IdempotentSubscribe } from "../../src/inbox/idempotent-subscribe.decorator";
import { InboxRepository } from "../../src/inbox/inbox-repository";
import { OutboxRepository } from "../../src/outbox/outbox-repository";
import { buildQuorumArgs } from "../../src/topology/topology-defaults";
import {
  bootHarness,
  shutdownHarness,
  waitFor,
  withPgClient,
  type TestHarness,
} from "./_helpers/harness";

@Injectable()
class PoisonConsumer {
  readonly logger = new Logger(PoisonConsumer.name);

  constructor(
    readonly em: EntityManager,
    readonly cls: ClsService,
    readonly inbox: InboxRepository,
  ) {}

  @IdempotentSubscribe({
    exchange: "wallet.events",
    routingKey: "test.poison",
    queue: "test.q",
    consumerName: "test.probe.poison",
  })
  async onProbe(): Promise<void> {
    throw new Error("poison");
  }
}

@Injectable()
class TestDeadLetterConsumer extends DeadLetterConsumer {
  protected readonly consumerName = "test.dlq";

  constructor(repo: DeadLetterRepository) {
    super(repo, new Logger(TestDeadLetterConsumer.name));
  }

  @RabbitSubscribe({
    exchange: "wallet.dlx",
    routingKey: "",
    queue: "test.dlq",
    queueOptions: {
      durable: true,
      arguments: buildQuorumArgs(3),
    },
  })
  async handle(
    rawPayload: unknown,
    msg: ConsumeMessage,
  ): Promise<undefined> {
    return this.handleDeadLetter(rawPayload, msg);
  }
}

describe("poison-message", () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await bootHarness({
      extraProviders: [PoisonConsumer, TestDeadLetterConsumer],
      pollIntervalMs: 200,
    });
  }, 180_000);

  afterAll(async () => {
    if (harness) await shutdownHarness(harness);
  }, 60_000);

  test(
    "handler that always throws → message dead-lettered after delivery-limit exhaustion → dead_letter_messages row written",
    async () => {
      const probeId = `poison-${Date.now()}`;
      const envelope = buildEnvelope({
        type: "test.poison",
        payload: { probeId },
        causationId: `origin-poison-${probeId}`,
      });

      const em = harness.em.fork();
      await em.transactional(async (txEm) => {
        const repo = new OutboxRepository(txEm);
        await repo.add(envelope, {
          exchange: "wallet.events",
          routingKey: "test.poison",
          aggregateType: "MessagingProbe",
          aggregateId: probeId,
        });
      });

      await waitFor(async () => {
        return await withPgClient(harness.databaseUrl, async (client) => {
          const rows = await client.query<{ count: string }>(
            "SELECT COUNT(*)::text as count FROM dead_letter_messages WHERE original_message_id = $1",
            [envelope.messageId],
          );
          return Number(rows.rows[0]?.count ?? "0") >= 1;
        });
      }, 45_000);

      await withPgClient(harness.databaseUrl, async (client) => {
        const dlqRows = await client.query<{
          consumer_name: string;
          redelivery_count: number;
        }>(
          "SELECT consumer_name, redelivery_count FROM dead_letter_messages WHERE original_message_id = $1",
          [envelope.messageId],
        );
        expect(dlqRows.rows.length).toBe(1);
        expect(dlqRows.rows[0]?.consumer_name).toBe("test.dlq");
        expect(dlqRows.rows[0]?.redelivery_count).toBeGreaterThanOrEqual(1);

        const inboxProcessed = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text as count FROM inbox WHERE consumer_name = $1 AND processed_at IS NOT NULL",
          ["test.probe.poison"],
        );
        expect(Number(inboxProcessed.rows[0]?.count ?? "0")).toBe(0);
      });
    },
    120_000,
  );
});
