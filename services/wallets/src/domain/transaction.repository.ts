// Domain layer: zero infra imports — do not add @nestjs/*, @mikro-orm/*, or zod here.
// Exception: `txEm` is typed as `unknown` so the handler layer can thread its
// transactional EntityManager without leaking @mikro-orm/* into the domain.
import type { PlayerId } from "@crash/shared-kernel/identity";
import type { Transaction } from "./transaction.aggregate";

export interface AppendTransactionContext {
  playerId: PlayerId;
  txEm?: unknown;
}

export interface TransactionRepository {
  append(tx: Transaction, ctx: AppendTransactionContext): Promise<void>;
}
