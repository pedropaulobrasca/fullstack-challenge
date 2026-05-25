import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Client as PgClient } from "pg";
import { MESSAGING_OPTIONS, type MessagingOptions } from "./messaging-options";

const DEFAULT_NOTIFY_CHANNEL = "outbox_new_message";
const WATCHDOG_INTERVAL_MS = 30_000;
const RECONNECT_BACKOFF_MS = 2_000;

@Injectable()
export class OutboxListenerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxListenerService.name);
  private client: PgClient | undefined;
  private listeners: Array<() => void> = [];
  private running = false;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    @Inject(MESSAGING_OPTIONS) private readonly opts: MessagingOptions,
  ) {}

  onNotification(cb: () => void): void {
    this.listeners.push(cb);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.running = true;
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = undefined;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const client = this.client;
    this.client = undefined;
    if (client) {
      await client.end().catch(() => undefined);
    }
    this.listeners = [];
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const channel = this.opts.outbox.notifyChannel ?? DEFAULT_NOTIFY_CHANNEL;
    const client = new PgClient({ connectionString: this.opts.databaseUrl });
    try {
      await client.connect();
      await client.query(`LISTEN "${channel}"`);
    } catch (err) {
      this.logger.warn(
        `LISTEN connect failed, scheduling reconnect: ${(err as Error).message}`,
      );
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
      return;
    }

    client.on('notification', () => {
      for (const cb of this.listeners) {
        try {
          cb();
        } catch (err) {
          this.logger.error("listener cb threw", err as Error);
        }
      }
    });
    client.on('error', (err) => {
      this.logger.warn(
        `LISTEN client error, reconnecting: ${err.message}`,
      );
      this.scheduleReconnect();
    });
    client.on('end', () => {
      if (this.running) {
        this.logger.warn("LISTEN client ended, reconnecting");
        this.scheduleReconnect();
      }
    });

    this.client = client;
    if (!this.watchdog) {
      this.watchdog = setInterval(() => {
        void this.ping();
      }, WATCHDOG_INTERVAL_MS);
    }
  }

  private async ping(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await client.query("SELECT 1");
    } catch (err) {
      this.logger.warn(
        `LISTEN watchdog ping failed, reconnecting: ${(err as Error).message}`,
      );
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimer) return;
    const stale = this.client;
    this.client = undefined;
    if (stale) {
      void stale.end().catch(() => undefined);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, RECONNECT_BACKOFF_MS);
  }
}
