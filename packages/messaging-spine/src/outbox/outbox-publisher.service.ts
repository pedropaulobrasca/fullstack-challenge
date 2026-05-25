import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { AmqpConnection } from "@golevelup/nestjs-rabbitmq";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import { MESSAGING_OPTIONS, type MessagingOptions } from "./messaging-options";
import { OutboxListenerService } from "./outbox-listener.service";

interface PendingOutboxRow {
  id: string;
  message_id: string;
  exchange: string;
  routing_key: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  event_type: string;
  event_version: number;
}

function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

@Injectable()
export class OutboxPublisher
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxPublisher.name);
  private channel: ConfirmChannel | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private wakeRequested = false;

  constructor(
    private readonly em: EntityManager,
    private readonly amqp: AmqpConnection,
    private readonly listener: OutboxListenerService,
    @Inject(MESSAGING_OPTIONS) private readonly opts: MessagingOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureChannel();
    const connection = this.amqp.connection as unknown as ChannelModel;
    connection.on("disconnect", () => {
      this.logger.warn("AMQP disconnect — dropping confirm channel");
      this.channel = undefined;
    });
    connection.on("connect", () => {
      this.logger.log("AMQP reconnect — recreating confirm channel");
      void this.ensureChannel();
    });
    this.listener.onNotification(() => {
      this.wakeRequested = true;
    });
    this.running = true;
    this.scheduleNext(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const channel = this.channel;
    this.channel = undefined;
    if (channel) {
      await channel.waitForConfirms().catch(() => undefined);
      await channel.close().catch(() => undefined);
    }
  }

  private async ensureChannel(): Promise<void> {
    try {
      const connection = this.amqp.connection as unknown as ChannelModel;
      this.channel = await connection.createConfirmChannel();
    } catch (err) {
      this.logger.error(
        "failed to create confirm channel",
        err as Error,
      );
      this.channel = undefined;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.tick().catch((err) =>
        this.logger.error("publisher tick failed", err as Error),
      );
    }, delayMs);
  }

  private async tick(): Promise<void> {
    const batchSize = this.opts.outbox.batchSize;
    const baseDelay = this.opts.outbox.pollIntervalMs;

    if (!this.channel) {
      this.logger.warn("tick skipped: no channel");
      this.scheduleNext(baseDelay);
      return;
    }

    const channel = this.channel;

    try {
      const published = await this.em.transactional(async (txEm) => {
        const conn = txEm.getConnection();
        const rows = await conn.execute<PendingOutboxRow[]>(
          "SELECT id, message_id, exchange, routing_key, payload, headers, event_type, event_version FROM outbox WHERE status = ? ORDER BY created_at LIMIT ? FOR UPDATE SKIP LOCKED",
          ["PENDING", batchSize],
        );
        if (rows.length === 0) return 0;

        for (const row of rows) {
          const body = {
            messageId: row.message_id,
            type: row.event_type,
            version: row.event_version,
            correlationId: row.headers["x-correlation-id"],
            causationId: row.headers["x-causation-id"],
            occurredAt: row.headers["x-occurred-at"],
            payload: row.payload,
          };
          channel.publish(
            row.exchange,
            row.routing_key,
            Buffer.from(JSON.stringify(body, bigintSafeReplacer)),
            {
              messageId: row.message_id,
              type: row.event_type,
              contentType: "application/json",
              persistent: true,
              headers: row.headers,
            },
          );
        }

        await channel.waitForConfirms();

        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => "?").join(",");
        await conn.execute(
          `UPDATE outbox SET status = ?, published_at = now() WHERE id IN (${placeholders})`,
          ["PUBLISHED", ...ids],
        );

        return rows.length;
      });

      const wakeOrFollowup =
        this.wakeRequested || published === batchSize;
      this.wakeRequested = false;
      this.scheduleNext(wakeOrFollowup ? 0 : baseDelay);
    } catch (err) {
      this.logger.error("outbox publish cycle failed", err as Error);
      this.scheduleNext(baseDelay);
    }
  }
}
