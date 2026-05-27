import { Inject, Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";
import type { ConsumeMessage } from "amqplib";
import { walletDebitRejectedPayloadSchema } from "@crash/contracts";
import {
  buildEnvelope,
  EXCHANGES,
  IdempotentSubscribe,
  InboxRepository,
  OutboxRepository,
  QUEUES,
} from "@crash/messaging-spine";
import type { BetRepository } from "../../domain/bet.repository";
import type { BetSagaStateRepository } from "../../domain/bet-saga-state.repository";
import { BET_REPOSITORY, BET_SAGA_REPOSITORY } from "../tokens";
import type { WalletDebitRejectedEnvelope } from "./envelope-types";

@Injectable()
export class WalletDebitRejectedHandler {
  public readonly logger = new Logger(WalletDebitRejectedHandler.name);

  constructor(
    public readonly em: EntityManager,
    public readonly cls: ClsService,
    public readonly inbox: InboxRepository,
    private readonly outbox: OutboxRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    @Inject(BET_SAGA_REPOSITORY) private readonly sagas: BetSagaStateRepository,
  ) {}

  @IdempotentSubscribe({
    consumerName: "games.wallet-debit-rejected",
    exchange: EXCHANGES.WALLET_EVENTS,
    routingKey: "wallet.debit.rejected",
    queue: QUEUES.GAMES_WALLET_EVENTS,
  })
  async handle(
    envelope: WalletDebitRejectedEnvelope,
    msg: ConsumeMessage,
    txEm: EntityManager,
  ): Promise<void> {
    await this.handleEnvelope(envelope, msg, txEm);
  }

  async handleEnvelope(
    envelope: WalletDebitRejectedEnvelope,
    _msg: ConsumeMessage,
    txEm: EntityManager,
  ): Promise<void> {
    const payload = walletDebitRejectedPayloadSchema.parse(envelope.payload);
    const saga = await this.sagas.findByCorrelationId(envelope.correlationId, txEm);

    if (saga === null) {
      this.logger.warn(
        `wallet.debit.rejected received for unknown correlationId=${envelope.correlationId} — dropping`,
      );
      return;
    }

    if (saga.status !== "DEBIT_PENDING") {
      this.logger.debug(
        `wallet.debit.rejected for saga ${saga.betId} in non-pending state ${saga.status} — skipping`,
      );
      return;
    }

    const refunded = await this.bets.tryTransition(
      saga.betId,
      "PENDING",
      "REFUNDED",
      { refundReason: payload.reason },
      txEm,
    );
    if (refunded === null) {
      this.logger.warn(
        `bet ${saga.betId} not PENDING during reject (raced with sweeper?)`,
      );
      return;
    }

    await this.sagas.transition(saga.betId, "DEBIT_PENDING", "REFUNDED", txEm);

    await this.outbox.add(
      buildEnvelope({
        type: "bet.refunded",
        version: 1,
        correlationId: envelope.correlationId,
        causationId: envelope.messageId,
        payload: {
          betId: saga.betId as unknown as string,
          playerId: payload.playerId,
          reason: payload.reason,
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
}
