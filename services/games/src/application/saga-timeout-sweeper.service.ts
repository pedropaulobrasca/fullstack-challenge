import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  buildEnvelope,
  EXCHANGES,
  OutboxRepository,
} from "@crash/messaging-spine";
import { randomUUID } from "node:crypto";
import { env } from "../config/defaults";
import type { BetRepository } from "../domain/bet.repository";
import type { BetSagaStateRepository } from "../domain/bet-saga-state.repository";
import { BET_REPOSITORY, BET_SAGA_REPOSITORY } from "./tokens";

const CLAIM_LIMIT = 100;

@Injectable()
export class SagaTimeoutSweeper
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger(SagaTimeoutSweeper.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxRepository,
    @Inject(BET_SAGA_REPOSITORY) private readonly sagas: BetSagaStateRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.running = true;
    this.scheduleAt(env.SAGA_SWEEP_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async sweep(): Promise<void> {
    await this.em.transactional(async (txEm) => {
      const expired = await this.sagas.claimExpired(CLAIM_LIMIT, new Date(), txEm);
      for (const saga of expired) {
        const refunded = await this.bets.tryTransition(
          saga.betId,
          "PENDING",
          "REFUNDED",
          { refundReason: "SAGA_TIMEOUT" },
          txEm,
        );
        if (refunded === null) {
          this.log.warn(
            `saga ${saga.betId as unknown as string}: bet no longer PENDING during timeout sweep — skipping`,
          );
          continue;
        }

        const transitioned = await this.sagas.transition(
          saga.betId,
          "DEBIT_PENDING",
          "TIMED_OUT",
          txEm,
        );
        if (transitioned === null) {
          this.log.warn(
            `saga ${saga.betId as unknown as string}: saga no longer DEBIT_PENDING during sweep — skipping outbox`,
          );
          continue;
        }

        await this.outbox.add(
          buildEnvelope({
            type: "bet.refunded",
            version: 1,
            correlationId: saga.correlationId,
            causationId: randomUUID(),
            payload: {
              betId: saga.betId as unknown as string,
              playerId: refunded.playerId as unknown as string,
              reason: "SAGA_TIMEOUT",
            },
          }),
          {
            exchange: EXCHANGES.GAME_EVENTS,
            routingKey: "bet.refunded",
            aggregateType: "Bet",
            aggregateId: saga.betId as unknown as string,
          },
          txEm,
        );
      }
    });
  }

  private scheduleAt(ms: number): void {
    if (!this.running) return;
    const delay = Math.max(0, ms);
    this.timer = setTimeout(() => {
      if (!this.running) return;
      this.sweep()
        .catch((err) =>
          this.log.error(
            "saga sweep failed; will retry next tick",
            err instanceof Error ? err.stack : String(err),
          ),
        )
        .finally(() => this.scheduleAt(env.SAGA_SWEEP_INTERVAL_MS));
    }, delay);
  }
}
