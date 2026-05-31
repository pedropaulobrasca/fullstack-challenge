import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  buildEnvelope,
  EXCHANGES,
  OutboxRepository,
} from "@crash/messaging-spine";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter } from "prom-client";
import { BET_LOST_EVENT_TYPE, type BetLostEventV1 } from "@crash/contracts";
import { Round } from "../../domain/round.aggregate";
import { CrashPoint } from "../../domain/value-objects/crash-point";
import type { RoundRepository } from "../../domain/round.repository";
import type { BetRepository } from "../../domain/bet.repository";
import type { Bet } from "../../domain/bet.aggregate";
import { BET_REPOSITORY, ROUND_REPOSITORY } from "../tokens";
import { BET_VOLUME_TOTAL } from "../../observability/metrics/bet-volume.metric";

@Injectable()
export class CrashRoundUseCase {
  private readonly log = new Logger(CrashRoundUseCase.name);

  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxRepository,
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    @InjectMetric(BET_VOLUME_TOTAL) private readonly betVolume: Counter<string>,
  ) {}

  async execute(
    round: Round,
    crashPoint: CrashPoint,
    now: Date,
  ): Promise<Round> {
    let crashed: Round | null;
    if (round.status === "CRASHED") {
      crashed = round;
    } else {
      crashed = await this.rounds.transitionFromRunningToCrashed(
        round.id,
        crashPoint,
        now,
      );
      if (crashed === null) {
        const reloaded = await this.rounds.findById(round.id);
        if (reloaded === null || reloaded.status !== "CRASHED") {
          throw new Error(
            `Round ${round.id as unknown as string} not in RUNNING — crash transition rejected`,
          );
        }
        crashed = reloaded;
      }
    }

    await this.sweepActiveBetsToLost(crashed, now);
    return crashed;
  }

  private async sweepActiveBetsToLost(round: Round, settledAt: Date): Promise<void> {
    const activeBets = await this.bets.findActiveByRound(round.id);
    for (const bet of activeBets) {
      if (bet.status !== "ACTIVE") continue;
      await this.transitionAndPublishLost(bet, settledAt);
    }
  }

  private async transitionAndPublishLost(bet: Bet, settledAt: Date): Promise<void> {
    await this.em.transactional(async (txEm) => {
      const transitioned = await this.bets.tryTransition(
        bet.id,
        "ACTIVE",
        "LOST",
        {},
        txEm,
      );
      if (transitioned === null) {
        this.log.debug(
          `bet ${bet.id as unknown as string} no longer ACTIVE during sweep (race)`,
        );
        return;
      }

      const correlationId = randomUUID();
      const payload: BetLostEventV1 = {
        betId: bet.id as unknown as string,
        playerId: bet.playerId as unknown as string,
        roundId: bet.roundId as unknown as string,
        amount: bet.amount.toSnapshot(),
        settledAt: settledAt.toISOString(),
      };
      await this.outbox.add(
        buildEnvelope({
          type: BET_LOST_EVENT_TYPE,
          version: 1,
          messageId: correlationId,
          correlationId,
          causationId: correlationId,
          payload,
        }),
        {
          exchange: EXCHANGES.GAME_EVENTS,
          routingKey: BET_LOST_EVENT_TYPE,
          aggregateType: "Bet",
          aggregateId: bet.id as unknown as string,
        },
        txEm,
      );

      this.betVolume.inc({ status: "lost" }, Number(bet.amount.toCents()));
    });
  }
}
