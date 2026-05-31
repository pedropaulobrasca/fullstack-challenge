import { Injectable, Logger } from "@nestjs/common";
import { RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import type { ConsumeMessage } from "amqplib";
import { z } from "zod";
import {
  EXCHANGES,
  QUEUES,
  buildQuorumArgs,
} from "@crash/messaging-spine";
import { moneySnapshotSchema } from "@crash/contracts";
import { PlayerId, maskPlayerId } from "@crash/shared-kernel/identity";
import { env } from "../../config/defaults";
import { GameWsGateway } from "../../presentation/gateways/game-ws.gateway";

const betActiveInboundSchema = z
  .object({
    betId: z.string().min(1),
    playerId: z.string().min(1),
    roundId: z.string().min(1),
    amount: moneySnapshotSchema.optional(),
  })
  .passthrough();

const betRefundedInboundSchema = z
  .object({
    betId: z.string().min(1),
    playerId: z.string().min(1),
    roundId: z.string().min(1),
    reason: z.string().min(1),
    amount: moneySnapshotSchema.optional(),
  })
  .passthrough();

const betCashedOutInboundSchema = z
  .object({
    betId: z.string().min(1),
    playerId: z.string().min(1),
    roundId: z.string().min(1),
    multiplier: z.number().positive(),
    payout: moneySnapshotSchema,
    cashedOutAt: z.string().min(1).optional(),
  })
  .passthrough();

const betPlacedInboundSchema = z
  .object({
    betId: z.string().min(1),
    playerId: z.string().min(1),
    roundId: z.string().min(1),
    amount: moneySnapshotSchema,
  })
  .passthrough();

type IncomingEnvelope = {
  type: string;
  payload: unknown;
  correlationId?: string;
};

const FALLBACK_MONEY = { amount: "0", currency: env.CURRENCY_CODE, scale: 0 };

@Injectable()
export class WsBridgeConsumer {
  private readonly log = new Logger(WsBridgeConsumer.name);

  constructor(private readonly gateway: GameWsGateway) {}

  @RabbitSubscribe({
    exchange: EXCHANGES.GAME_EVENTS,
    routingKey: ["bet.placed", "bet.active", "bet.refunded", "bet.cashed_out"],
    queue: QUEUES.GAMES_WS_BRIDGE,
    queueOptions: {
      durable: true,
      arguments: buildQuorumArgs(
        env.RMQ_DELIVERY_LIMIT_MAIN,
        EXCHANGES.GAME_DLX,
      ),
    },
  })
  async handle(envelope: IncomingEnvelope, _msg: ConsumeMessage): Promise<void> {
    switch (envelope.type) {
      case "bet.active":
        this.onBetActive(envelope.payload);
        return;
      case "bet.placed":
        this.onBetPlaced(envelope.payload);
        return;
      case "bet.refunded":
        this.onBetRefunded(envelope.payload);
        return;
      case "bet.cashed_out":
        this.onBetCashedOut(envelope.payload);
        return;
      default:
        this.log.warn(`unknown routing key ${envelope.type} — dropping`);
        return;
    }
  }

  private onBetActive(rawPayload: unknown): void {
    const payload = betActiveInboundSchema.parse(rawPayload);
    const playerIdMasked = maskPlayerId(PlayerId(payload.playerId));
    const maskedAmount = payload.amount
      ? { amount: "0", currency: payload.amount.currency, scale: payload.amount.scale }
      : FALLBACK_MONEY;

    this.gateway.server.to("lobby").emit("bet:placed", {
      roundId: payload.roundId,
      betId: payload.betId,
      playerIdMasked,
      amount: maskedAmount,
    });

    this.gateway.server.to(`user:${payload.playerId}`).emit("bet:my_active", {
      roundId: payload.roundId,
      betId: payload.betId,
      amount: payload.amount ?? FALLBACK_MONEY,
    });
  }

  private onBetPlaced(rawPayload: unknown): void {
    const payload = betPlacedInboundSchema.parse(rawPayload);
    const playerIdMasked = maskPlayerId(PlayerId(payload.playerId));

    this.gateway.server.to("lobby").emit("bet:placed", {
      roundId: payload.roundId,
      betId: payload.betId,
      playerIdMasked,
      amount: payload.amount,
    });
  }

  private onBetRefunded(rawPayload: unknown): void {
    const payload = betRefundedInboundSchema.parse(rawPayload);

    this.gateway.server.to(`user:${payload.playerId}`).emit("bet:my_refunded", {
      roundId: payload.roundId,
      betId: payload.betId,
      amount: payload.amount ?? FALLBACK_MONEY,
      reason: payload.reason,
    });
  }

  private onBetCashedOut(rawPayload: unknown): void {
    const payload = betCashedOutInboundSchema.parse(rawPayload);
    const playerIdMasked = maskPlayerId(PlayerId(payload.playerId));

    this.gateway.server.to("lobby").emit("bet:cashed_out", {
      roundId: payload.roundId,
      betId: payload.betId,
      playerIdMasked,
      multiplier: payload.multiplier,
    });

    this.gateway.server
      .to(`user:${payload.playerId}`)
      .emit("bet:my_cashed_out", {
        roundId: payload.roundId,
        betId: payload.betId,
        multiplier: payload.multiplier,
        payout: payload.payout,
      });
  }
}
