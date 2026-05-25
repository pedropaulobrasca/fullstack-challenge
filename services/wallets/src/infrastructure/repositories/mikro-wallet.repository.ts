import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { Money, PlayerId, WalletId } from "@crash/shared-kernel";
import { Wallet } from "../../domain/wallet.aggregate";
import type {
  ApplyCreditResult,
  ApplyDebitResult,
  WalletRepository,
} from "../../domain/wallet.repository";
import { WalletEntitySchema, WalletRow } from "../persistence/wallet.entity";
import { env } from "../../config/defaults";

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

  applyDebitAtomically(): Promise<ApplyDebitResult> {
    throw new Error("not yet implemented — see Plan 03-06");
  }

  applyCreditAtomically(): Promise<ApplyCreditResult> {
    throw new Error("not yet implemented — see Plan 03-06");
  }
}
