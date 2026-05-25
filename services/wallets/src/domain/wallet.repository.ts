// Domain layer: zero infra imports — do not add @nestjs/*, @mikro-orm/*, or zod here.
import type { Money, PlayerId, WalletId } from "@crash/shared-kernel";
import type { Wallet } from "./wallet.aggregate";

export type ApplyDebitResult =
  | { kind: "OK"; walletId: WalletId; newBalance: Money }
  | { kind: "INSUFFICIENT_FUNDS" }
  | { kind: "NOT_FOUND" };

export type ApplyCreditResult =
  | { kind: "OK"; walletId: WalletId; newBalance: Money }
  | { kind: "NOT_FOUND" };

export interface WalletRepository {
  findByPlayerId(playerId: PlayerId): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
  applyDebitAtomically(playerId: PlayerId, amount: Money): Promise<ApplyDebitResult>;
  applyCreditAtomically(playerId: PlayerId, amount: Money): Promise<ApplyCreditResult>;
}
