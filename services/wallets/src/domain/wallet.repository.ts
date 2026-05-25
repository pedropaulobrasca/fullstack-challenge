// Domain layer: zero infra imports — do not add @nestjs/*, @mikro-orm/*, or zod here.
// Exception: the atomic UPDATE methods accept an opaque `txEm` token typed as
// `unknown` so the application/handler layer can thread its transactional
// EntityManager through without leaking @mikro-orm/* into the domain.
import type { Money, PlayerId, WalletId } from "@crash/shared-kernel";
import type { Wallet } from "./wallet.aggregate";

export type ApplyDebitResult =
  | {
      kind: "OK";
      walletId: WalletId;
      newBalance: Money;
      previousBalance: Money;
    }
  | { kind: "INSUFFICIENT_FUNDS"; available: Money }
  | { kind: "NOT_FOUND" };

export type ApplyCreditResult =
  | {
      kind: "OK";
      walletId: WalletId;
      newBalance: Money;
      previousBalance: Money;
    }
  | { kind: "NOT_FOUND" };

export interface WalletRepository {
  findByPlayerId(playerId: PlayerId): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
  applyDebitAtomically(
    playerId: PlayerId,
    amount: Money,
    txEm?: unknown,
  ): Promise<ApplyDebitResult>;
  applyCreditAtomically(
    playerId: PlayerId,
    amount: Money,
    txEm?: unknown,
  ): Promise<ApplyCreditResult>;
}
