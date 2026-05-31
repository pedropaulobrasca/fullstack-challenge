import { Inject, Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ClsService } from "nestjs-cls";
import type { ConsumeMessage } from "amqplib";
import { Money } from "@crash/shared-kernel";
import { PlayerId } from "@crash/shared-kernel/identity";
import {
  EXCHANGES,
  IdempotentSubscribe,
  InboxRepository,
} from "@crash/messaging-spine";
import {
  betCashedOutEventSchema,
  betLostEventSchema,
  betRefundedEventSchema,
} from "@crash/contracts";
import { env } from "../config/defaults";
import type { LeaderboardRepository } from "../domain/leaderboard.repository";
import { LeaderboardSnapshot } from "../domain/leaderboard-snapshot.value-object";
import { LEADERBOARD_REPOSITORY } from "./tokens";
import {
  GAME_EVENTS,
  type LeaderboardUpdatedPayload,
} from "./game-events";

type ProjectorEnvelope = {
  type: string;
  payload: unknown;
};

const LEADERBOARD_PROJECTOR_QUEUE = "leaderboard-projector.q";

@Injectable()
export class LeaderboardProjectorService {
  public readonly logger = new Logger(LeaderboardProjectorService.name);

  constructor(
    @Inject(LEADERBOARD_REPOSITORY)
    private readonly leaderboard: LeaderboardRepository,
    private readonly eventEmitter: EventEmitter2,
    public readonly em: EntityManager,
    public readonly cls: ClsService,
    public readonly inbox: InboxRepository,
  ) {}

  @IdempotentSubscribe({
    consumerName: "games.leaderboard-projector",
    exchange: EXCHANGES.GAME_EVENTS,
    routingKey: ["bet.cashed_out", "bet.refunded", "bet.lost"],
    queue: LEADERBOARD_PROJECTOR_QUEUE,
  })
  async handle(
    envelope: ProjectorEnvelope,
    msg: ConsumeMessage,
    txEm: EntityManager,
  ): Promise<void> {
    await this.handleEnvelope(envelope, msg, txEm);
  }

  async handleEnvelope(
    envelope: ProjectorEnvelope,
    _msg: ConsumeMessage,
    txEm: EntityManager,
  ): Promise<void> {
    const beforeTopN = await this.leaderboard.fetchSnapshot(
      env.LEADERBOARD_TOP_N,
      { windowHours: env.LEADERBOARD_WINDOW_HOURS },
      txEm,
    );

    switch (envelope.type) {
      case "bet.cashed_out": {
        const payload = betCashedOutEventSchema.parse(envelope.payload);
        await this.leaderboard.applyCashedOut(
          {
            playerId: PlayerId(payload.playerId),
            betAmount: Money.fromSnapshot(payload.amount),
            payout: Money.fromSnapshot(payload.payout),
            settledAt: new Date(payload.cashedOutAt),
          },
          txEm,
        );
        break;
      }
      case "bet.refunded": {
        const payload = betRefundedEventSchema.parse(envelope.payload);
        await this.leaderboard.applyRefunded(
          {
            playerId: PlayerId(payload.playerId),
            betAmount:
              payload.amount !== undefined
                ? Money.fromSnapshot(payload.amount)
                : Money.of(0n),
            settledAt: new Date(),
          },
          txEm,
        );
        break;
      }
      case "bet.lost": {
        const payload = betLostEventSchema.parse(envelope.payload);
        await this.leaderboard.applySettledLoss(
          {
            playerId: PlayerId(payload.playerId),
            betAmount: Money.fromSnapshot(payload.amount),
            settledAt: new Date(payload.settledAt),
          },
          txEm,
        );
        break;
      }
      default: {
        this.logger.warn(
          `unknown envelope type "${envelope.type}" — dropping without apply`,
        );
        return;
      }
    }

    const afterTopN = await this.leaderboard.fetchSnapshot(
      env.LEADERBOARD_TOP_N,
      { windowHours: env.LEADERBOARD_WINDOW_HOURS },
      txEm,
    );

    if (LeaderboardSnapshot.diff(beforeTopN, afterTopN).changed) {
      const payload: LeaderboardUpdatedPayload = {
        entries: afterTopN,
        updatedAt: new Date().toISOString(),
      };
      this.eventEmitter.emit(GAME_EVENTS.LEADERBOARD_UPDATED, payload);
    }
  }
}
