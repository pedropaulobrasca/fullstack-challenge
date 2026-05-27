import { Inject, Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";
import type { ConsumeMessage } from "amqplib";
import { walletDebitedPayloadSchema } from "@crash/contracts";
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
import type { WalletDebitedEnvelope } from "./envelope-types";

@Injectable()
export class WalletDebitedHandler {
  public readonly logger = new Logger(WalletDebitedHandler.name);

  constructor(
    public readonly em: EntityManager,
    public readonly cls: ClsService,
    public readonly inbox: InboxRepository,
    private readonly outbox: OutboxRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    @Inject(BET_SAGA_REPOSITORY) private readonly sagas: BetSagaStateRepository,
  ) {}

  @IdempotentSubscribe({
    consumerName: "games.wallet-debited",
    exchange: EXCHANGES.WALLET_EVENTS,
    routingKey: "wallet.debited",
    queue: QUEUES.GAMES_WALLET_EVENTS,
  })
  async handle(
    envelope: WalletDebitedEnvelope,
    msg: ConsumeMessage,
    txEm: EntityManager,
  ): Promise<void> {
    await this.handleEnvelope(envelope, msg, txEm);
  }

  async handleEnvelope(
    envelope: WalletDebitedEnvelope,
    _msg: ConsumeMessage,
    txEm: EntityManager,
  ): Promise<void> {
    const payload = walletDebitedPayloadSchema.parse(envelope.payload);
    const saga = await this.sagas.findByCorrelationId(envelope.correlationId, txEm);

    if (saga === null) {
      this.logger.warn(
        `wallet.debited received for unknown correlationId=${envelope.correlationId} — dropping`,
      );
      return;
    }

    switch (saga.status) {
      case "DEBIT_PENDING": {
        const confirmed = await this.bets.tryTransition(
          saga.betId,
          "PENDING",
          "ACTIVE",
          {},
          txEm,
        );
        if (confirmed === null) {
          this.logger.warn(
            `bet ${saga.betId} not PENDING during confirm (raced with sweeper?)`,
          );
          return;
        }
        await this.sagas.transition(saga.betId, "DEBIT_PENDING", "CONFIRMED", txEm);
        await this.outbox.add(
          buildEnvelope({
            type: "bet.active",
            version: 1,
            correlationId: envelope.correlationId,
            causationId: envelope.messageId,
            payload: {
              betId: saga.betId as unknown as string,
              playerId: payload.playerId,
              roundId: confirmed.roundId as unknown as string,
            },
          }),
          {
            exchange: EXCHANGES.GAME_EVENTS,
            routingKey: "bet.active",
            aggregateType: "Bet",
            aggregateId: saga.betId as unknown as string,
          },
          txEm,
        );
        return;
      }

      case "TIMED_OUT": {
        const bet = await this.bets.findById(saga.betId);
        if (bet === null) {
          this.logger.error(
            `compensation requested but bet ${saga.betId} not found — saga state inconsistent`,
          );
          return;
        }
        await this.outbox.add(
          buildEnvelope({
            type: "wallet.credit",
            version: 1,
            correlationId: envelope.correlationId,
            causationId: envelope.messageId,
            payload: {
              playerId: payload.playerId,
              amount: bet.amount.toSnapshot(),
            },
          }),
          {
            exchange: EXCHANGES.WALLET_COMMANDS,
            routingKey: "wallet.credit",
            aggregateType: "Bet",
            aggregateId: saga.betId as unknown as string,
          },
          txEm,
        );
        await this.sagas.transition(saga.betId, "TIMED_OUT", "COMPENSATED", txEm);
        return;
      }

      case "CONFIRMED":
      case "REFUNDED":
      case "COMPENSATED": {
        this.logger.debug(
          `wallet.debited duplicate delivery for saga ${saga.betId} in terminal state ${saga.status}`,
        );
        return;
      }
    }
  }
}
