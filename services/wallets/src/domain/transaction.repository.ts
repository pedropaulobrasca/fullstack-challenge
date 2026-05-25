// Domain layer: zero infra imports — do not add @nestjs/*, @mikro-orm/*, or zod here.
import type { Transaction } from "./transaction.aggregate";

export interface TransactionRepository {
  append(tx: Transaction): Promise<void>;
}
