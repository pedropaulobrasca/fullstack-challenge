import { Inject, Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";
import type { ConsumeMessage } from "amqplib";
import { Money } from "@crash/shared-kernel";
import { CorrelationId, PlayerId, WalletId } from "@crash/shared-kernel/identity";
import { walletDebitPayloadSchema } from "@crash/contracts";
import {
  buildEnvelope,
  EXCHANGES,
  IdempotentSubscribe,
  InboxRepository,
  OutboxRepository,
  QUEUES,
} from "@crash/messaging-spine";
import { Transaction } from "../../domain/transaction.aggregate";
import type { WalletRepository } from "../../domain/wallet.repository";
import type { TransactionRepository } from "../../domain/transaction.repository";
import {
  TRANSACTION_REPOSITORY,
  WALLET_REPOSITORY,
} from "../use-cases/tokens";
import type { WalletDebitEnvelope } from "./envelope-types";

@Injectable()
export class WalletDebitHandler {
  public readonly logger = new Logger(WalletDebitHandler.name);

  constructor(
    public readonly em: EntityManager,
    public readonly cls: ClsService,
    public readonly inbox: InboxRepository,
    private readonly outbox: OutboxRepository,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: WalletRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly txRepo: TransactionRepository,
  ) {}

  @IdempotentSubscribe({
    consumerName: "wallets.debit",
    exchange: EXCHANGES.WALLET_COMMANDS,
    routingKey: "wallet.debit",
    queue: QUEUES.WALLET_DEBIT,
  })
  async handle(
    envelope: WalletDebitEnvelope,
    _msg: ConsumeMessage,
    txEm: EntityManager,
  ): Promise<void> {
    const payload = walletDebitPayloadSchema.parse(envelope.payload);
    const amount = Money.fromSnapshot(payload.amount);
    const playerId = PlayerId(payload.playerId);

    const result = await this.walletRepo.applyDebitAtomically(
      playerId,
      amount,
      txEm,
    );

    if (result.kind === "NOT_FOUND") {
      await this.outbox.add(
        buildEnvelope({
          type: "wallet.debit.rejected",
          version: 1,
          correlationId: envelope.correlationId,
          causationId: envelope.messageId,
          payload: {
            playerId: payload.playerId,
            reason: "WALLET_NOT_FOUND",
            requested: payload.amount,
          },
        }),
        {
          exchange: EXCHANGES.WALLET_EVENTS,
          routingKey: "wallet.debit.rejected",
          aggregateType: "Wallet",
          aggregateId: payload.playerId,
        },
        txEm,
      );
      return;
    }

    if (result.kind === "INSUFFICIENT_FUNDS") {
      await this.outbox.add(
        buildEnvelope({
          type: "wallet.debit.rejected",
          version: 1,
          correlationId: envelope.correlationId,
          causationId: envelope.messageId,
          payload: {
            playerId: payload.playerId,
            reason: "INSUFFICIENT_FUNDS",
            requested: payload.amount,
            available: result.available.toSnapshot(),
          },
        }),
        {
          exchange: EXCHANGES.WALLET_EVENTS,
          routingKey: "wallet.debit.rejected",
          aggregateType: "Wallet",
          aggregateId: payload.playerId,
        },
        txEm,
      );
      return;
    }

    const transaction = Transaction.record({
      walletId: WalletId(result.walletId),
      kind: "DEBIT",
      amount,
      correlationId: CorrelationId(envelope.correlationId),
      messageId: envelope.messageId,
      previousBalance: result.previousBalance,
      newBalance: result.newBalance,
      appliedAt: new Date(),
    });
    await this.txRepo.append(transaction, { playerId, txEm });

    await this.outbox.add(
      buildEnvelope({
        type: "wallet.debited",
        version: 1,
        correlationId: envelope.correlationId,
        causationId: envelope.messageId,
        payload: {
          walletId: result.walletId,
          playerId: payload.playerId,
          newBalance: result.newBalance.toSnapshot(),
        },
      }),
      {
        exchange: EXCHANGES.WALLET_EVENTS,
        routingKey: "wallet.debited",
        aggregateType: "Wallet",
        aggregateId: result.walletId,
      },
      txEm,
    );
  }
}
