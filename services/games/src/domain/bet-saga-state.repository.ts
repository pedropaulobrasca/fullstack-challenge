import type { BetId } from "@crash/shared-kernel";
import type { BetSagaState, BetSagaStatus, BetSagaStateCreateInput } from "./bet-saga-state.aggregate";

export interface BetSagaStateRepository {
  /** Inserts a new saga row. txEm is required so the insert participates in the caller TX. */
  create(input: BetSagaStateCreateInput, txEm: unknown): Promise<void>;

  /** Reads by correlation_id. txEm optional; when omitted the default EM is used. */
  findByCorrelationId(correlationId: string, txEm?: unknown): Promise<BetSagaState | null>;

  /** Reads by bet_id (primary key). txEm optional. */
  findByBetId(betId: BetId, txEm?: unknown): Promise<BetSagaState | null>;

  /** Atomic UPDATE ... WHERE status=$from RETURNING ... — returns null on losing race. txEm required. */
  transition(
    betId: BetId,
    fromStatus: BetSagaStatus,
    toStatus: BetSagaStatus,
    txEm: unknown,
  ): Promise<BetSagaState | null>;

  /** SELECT ... FOR UPDATE SKIP LOCKED — claims expired DEBIT_PENDING rows for the sweeper. txEm required. */
  claimExpired(limit: number, now: Date, txEm: unknown): Promise<BetSagaState[]>;
}
