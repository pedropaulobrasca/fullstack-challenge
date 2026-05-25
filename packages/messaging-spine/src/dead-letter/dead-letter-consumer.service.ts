import { Injectable, Logger } from "@nestjs/common";
import type { ConsumeMessage } from "amqplib";

import {
  DeadLetterRepository,
  type DeadLetterRecord,
} from "./dead-letter-repository";

@Injectable()
export abstract class DeadLetterConsumer {
  constructor(
    protected readonly repo: DeadLetterRepository,
    protected readonly logger: Logger,
  ) {}

  protected abstract get consumerName(): string;

  protected async handleDeadLetter(
    rawPayload: unknown,
    msg: ConsumeMessage,
  ): Promise<undefined> {
    const headers = (msg?.properties?.headers ?? {}) as Record<string, unknown>;
    const xDeath = Array.isArray(headers["x-death"])
      ? (headers["x-death"] as Array<Record<string, unknown>>)
      : [];
    const firstDeath = xDeath[0] ?? {};

    const originalQueue = String(
      firstDeath.queue ?? msg?.fields?.routingKey ?? "unknown",
    );
    const originalExchange = String(
      firstDeath.exchange ?? msg?.fields?.exchange ?? "unknown",
    );
    const routingKeysRaw = firstDeath["routing-keys"];
    const firstRoutingKey = Array.isArray(routingKeysRaw)
      ? (routingKeysRaw[0] as string | undefined)
      : undefined;
    const originalRoutingKey = String(
      firstRoutingKey ?? msg?.fields?.routingKey ?? "",
    );

    const countRaw = firstDeath.count;
    const redeliveryCount =
      typeof countRaw === "number"
        ? countRaw
        : countRaw != null
          ? Number(countRaw)
          : 1;

    const messageIdRaw =
      msg?.properties?.messageId ?? headers["x-message-id"] ?? "";
    const originalMessageId = String(messageIdRaw);

    const firstDeathReason = headers["x-first-death-reason"];
    const record: DeadLetterRecord = {
      originalMessageId,
      originalExchange,
      originalRoutingKey,
      originalQueue,
      consumerName: this.consumerName,
      headers,
      payload: (rawPayload ?? {}) as Record<string, unknown>,
      redeliveryCount: Number.isFinite(redeliveryCount) ? redeliveryCount : 1,
      ...(typeof firstDeathReason === "string"
        ? { errorClass: firstDeathReason }
        : {}),
    };

    try {
      await this.repo.persist(record);
      this.logger.warn(
        `dead-lettered messageId=${originalMessageId} originalQueue=${originalQueue} count=${record.redeliveryCount}`,
      );
    } catch (err) {
      this.logger.error(
        "failed to persist dead letter — acking anyway to avoid poison loop",
        err as Error,
      );
    }

    return undefined;
  }
}
