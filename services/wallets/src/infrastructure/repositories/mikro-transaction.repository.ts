import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { Transaction } from "../../domain/transaction.aggregate";
import type {
  AppendTransactionContext,
  TransactionRepository,
} from "../../domain/transaction.repository";
import {
  TransactionEntitySchema,
  TransactionRow,
} from "../persistence/transaction.entity";
import { env } from "../../config/defaults";

@Injectable()
export class MikroTransactionRepository implements TransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async append(tx: Transaction, ctx: AppendTransactionContext): Promise<void> {
    const em = this.resolveEm(ctx.txEm);
    const row: TransactionRow = {
      id: crypto.randomUUID(),
      walletId: tx.walletId,
      playerId: ctx.playerId,
      kind: tx.kind,
      amountCents: tx.amount.toCents(),
      currencyCode: env.CURRENCY_CODE,
      previousBalanceCents: tx.previousBalance.toCents(),
      newBalanceCents: tx.newBalance.toCents(),
      correlationId: String(tx.correlationId),
      messageId: tx.messageId,
      appliedAt: tx.appliedAt,
    };
    em.persist(em.create(TransactionEntitySchema, row));
    await em.flush();
  }

  private resolveEm(txEm: unknown): EntityManager {
    if (txEm && txEm instanceof EntityManager) {
      return txEm;
    }
    return this.em;
  }
}
