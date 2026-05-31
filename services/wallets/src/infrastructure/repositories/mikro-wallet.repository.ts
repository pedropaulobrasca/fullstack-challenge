import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { Money } from "@crash/shared-kernel";
import { PlayerId, WalletId } from "@crash/shared-kernel/identity";
import { Wallet } from "../../domain/wallet.aggregate";
import type {
  ApplyCreditResult,
  ApplyDebitResult,
  WalletRepository,
} from "../../domain/wallet.repository";
import { WalletEntitySchema, WalletRow } from "../persistence/wallet.entity";
import { env } from "../../config/defaults";

type UpdateReturningRow = {
  id: string;
  balance_cents: string;
  previous_balance_cents: string;
};

type SelectBalanceRow = {
  id: string;
  balance_cents: string;
};

@Injectable()
export class MikroWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findByPlayerId(playerId: PlayerId): Promise<Wallet | null> {
    const row = await this.em.findOne(WalletEntitySchema, { playerId });
    if (!row) return null;
    return Wallet.rehydrate({
      id: WalletId(row.id),
      playerId: PlayerId(row.playerId),
      balance: Money.of(BigInt(row.balanceCents)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  async save(wallet: Wallet): Promise<void> {
    const row: WalletRow = {
      id: wallet.id,
      playerId: wallet.playerId,
      balanceCents: wallet.balance.toCents(),
      currencyCode: env.CURRENCY_CODE,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
    await this.em.upsert(WalletEntitySchema, row);
    await this.em.flush();
  }

  async applyDebitAtomically(
    playerId: PlayerId,
    amount: Money,
    txEm?: unknown,
  ): Promise<ApplyDebitResult> {
    const em = this.resolveEm(txEm);
    const cents = amount.toCents().toString();
    const rows = await em
      .getConnection()
      .execute<UpdateReturningRow[]>(
        `UPDATE wallets
         SET balance_cents = balance_cents - ?, updated_at = now()
         WHERE player_id = ? AND balance_cents >= ?
         RETURNING id, balance_cents, (balance_cents + ?) AS previous_balance_cents`,
        [cents, playerId, cents, cents],
        "all",
        em.getTransactionContext(),
      );

    if (rows.length === 0) {
      return this.resolveDebitMiss(em, playerId);
    }

    const row = rows[0]!;
    return {
      kind: "OK",
      walletId: WalletId(row.id),
      newBalance: Money.of(BigInt(row.balance_cents)),
      previousBalance: Money.of(BigInt(row.previous_balance_cents)),
    };
  }

  async applyCreditAtomically(
    playerId: PlayerId,
    amount: Money,
    txEm?: unknown,
  ): Promise<ApplyCreditResult> {
    const em = this.resolveEm(txEm);
    const cents = amount.toCents().toString();
    const rows = await em
      .getConnection()
      .execute<UpdateReturningRow[]>(
        `UPDATE wallets
         SET balance_cents = balance_cents + ?, updated_at = now()
         WHERE player_id = ?
         RETURNING id, balance_cents, (balance_cents - ?) AS previous_balance_cents`,
        [cents, playerId, cents],
        "all",
        em.getTransactionContext(),
      );

    if (rows.length === 0) {
      return { kind: "NOT_FOUND" };
    }

    const row = rows[0]!;
    return {
      kind: "OK",
      walletId: WalletId(row.id),
      newBalance: Money.of(BigInt(row.balance_cents)),
      previousBalance: Money.of(BigInt(row.previous_balance_cents)),
    };
  }

  private resolveEm(txEm: unknown): EntityManager {
    if (txEm && txEm instanceof EntityManager) {
      return txEm;
    }
    return this.em;
  }

  private async resolveDebitMiss(
    em: EntityManager,
    playerId: PlayerId,
  ): Promise<ApplyDebitResult> {
    const rows = await em
      .getConnection()
      .execute<SelectBalanceRow[]>(
        `SELECT id, balance_cents FROM wallets WHERE player_id = ?`,
        [playerId],
        "all",
        em.getTransactionContext(),
      );
    if (rows.length === 0) {
      return { kind: "NOT_FOUND" };
    }
    const row = rows[0]!;
    return {
      kind: "INSUFFICIENT_FUNDS",
      available: Money.of(BigInt(row.balance_cents)),
    };
  }
}
