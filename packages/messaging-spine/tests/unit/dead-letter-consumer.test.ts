import { describe, test, expect, mock } from "bun:test";
import type { ConsumeMessage } from "amqplib";
import type { Logger } from "@nestjs/common";

import {
  DeadLetterConsumer,
  DeadLetterRepository,
  type DeadLetterRecord,
} from "../../src/index";

class TestDlqConsumer extends DeadLetterConsumer {
  protected readonly consumerName = "test.dlq";

  invoke(payload: unknown, msg: ConsumeMessage): Promise<undefined> {
    return this.handleDeadLetter(payload, msg);
  }
}

function makeFakeLogger(): {
  logger: Logger;
  warn: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;
} {
  const warn = mock(() => {});
  const error = mock(() => {});
  const log = mock(() => {});
  const logger = { warn, error, log } as unknown as Logger;
  return { logger, warn, error };
}

function makeFakeRepo(
  persistImpl: (record: DeadLetterRecord) => Promise<void> = async () => {},
): {
  repo: DeadLetterRepository;
  persist: ReturnType<typeof mock>;
} {
  const persist = mock(persistImpl);
  const repo = { persist } as unknown as DeadLetterRepository;
  return { repo, persist };
}

function buildMessage(
  headers: Record<string, unknown>,
  messageId = "mid-1",
): ConsumeMessage {
  return {
    content: Buffer.from(""),
    fields: {
      consumerTag: "ct",
      deliveryTag: 1,
      redelivered: false,
      exchange: "wallet.dlx",
      routingKey: "wallet.commands.q",
    },
    properties: {
      contentType: "application/json",
      contentEncoding: undefined,
      headers,
      deliveryMode: 2,
      priority: undefined,
      correlationId: undefined,
      replyTo: undefined,
      expiration: undefined,
      messageId,
      timestamp: undefined,
      type: undefined,
      userId: undefined,
      appId: undefined,
      clusterId: undefined,
    },
  } as unknown as ConsumeMessage;
}

describe("DeadLetterConsumer.handleDeadLetter", () => {
  test("extracts x-death metadata into the DeadLetterRecord", async () => {
    const { repo, persist } = makeFakeRepo();
    const { logger } = makeFakeLogger();
    const consumer = new TestDlqConsumer(repo, logger);

    const headers = {
      "x-death": [
        {
          count: 3,
          queue: "wallet.commands.q",
          exchange: "wallet.commands",
          "routing-keys": ["wallet.debit"],
        },
      ],
      "x-first-death-reason": "rejected",
    };
    const msg = buildMessage(headers, "mid-7");
    const payload = { amount: "100" };

    const result = await consumer.invoke(payload, msg);

    expect(result).toBeUndefined();
    expect(persist.mock.calls.length).toBe(1);

    const record = persist.mock.calls[0]?.[0] as DeadLetterRecord;
    expect(record.originalMessageId).toBe("mid-7");
    expect(record.originalQueue).toBe("wallet.commands.q");
    expect(record.originalExchange).toBe("wallet.commands");
    expect(record.originalRoutingKey).toBe("wallet.debit");
    expect(record.redeliveryCount).toBe(3);
    expect(record.consumerName).toBe("test.dlq");
    expect(record.errorClass).toBe("rejected");
    expect(record.payload).toEqual(payload as Record<string, unknown>);
  });

  test("returns undefined (acks) on success", async () => {
    const { repo } = makeFakeRepo();
    const { logger } = makeFakeLogger();
    const consumer = new TestDlqConsumer(repo, logger);

    const result = await consumer.invoke(
      {},
      buildMessage({ "x-death": [{ count: 1, queue: "q", exchange: "e", "routing-keys": ["r"] }] }),
    );

    expect(result).toBeUndefined();
  });

  test("returns undefined (acks) even when repository.persist throws", async () => {
    const { repo } = makeFakeRepo(async () => {
      throw new Error("postgres down");
    });
    const { logger, error } = makeFakeLogger();
    const consumer = new TestDlqConsumer(repo, logger);

    const result = await consumer.invoke(
      {},
      buildMessage({ "x-death": [{ count: 2, queue: "q", exchange: "e", "routing-keys": ["r"] }] }),
    );

    expect(result).toBeUndefined();
    expect(error.mock.calls.length).toBe(1);
  });

  test("defaults redeliveryCount to 1 and originalQueue to 'unknown' when x-death missing", async () => {
    const { repo, persist } = makeFakeRepo();
    const { logger } = makeFakeLogger();
    const consumer = new TestDlqConsumer(repo, logger);

    const msg = {
      content: Buffer.from(""),
      fields: {
        consumerTag: "ct",
        deliveryTag: 1,
        redelivered: false,
        exchange: "",
        routingKey: "",
      },
      properties: {
        headers: {},
        messageId: "mid-bare",
      },
    } as unknown as ConsumeMessage;

    await consumer.invoke({}, msg);

    const record = persist.mock.calls[0]?.[0] as DeadLetterRecord;
    expect(record.redeliveryCount).toBe(1);
    expect(record.originalQueue).toBe("unknown");
    expect(record.originalExchange).toBe("unknown");
    expect(record.errorClass).toBeUndefined();
  });

  test("emits a warn log on successful persist", async () => {
    const { repo } = makeFakeRepo();
    const { logger, warn } = makeFakeLogger();
    const consumer = new TestDlqConsumer(repo, logger);

    await consumer.invoke(
      {},
      buildMessage({
        "x-death": [
          { count: 5, queue: "q", exchange: "e", "routing-keys": ["r"] },
        ],
      }),
    );

    expect(warn.mock.calls.length).toBe(1);
  });
});
