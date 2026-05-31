import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { BetId } from "@crash/shared-kernel/identity";
import {
  BetSagaState,
  type BetSagaStatus,
  type BetSagaStateCreateInput,
} from "../../domain/bet-saga-state.aggregate";
import type { BetSagaStateRepository } from "../../domain/bet-saga-state.repository";
import {
  BetSagaStateEntitySchema,
  type BetSagaStateRow,
} from "../persistence/bet-saga-state.entity";

type BetSagaStateDbRow = {
  bet_id: string;
  correlation_id: string;
  status: string;
  deadline_at: Date;
  updated_at: Date;
};

const VALID_STATUSES: readonly BetSagaStatus[] = [
  "DEBIT_PENDING",
  "CONFIRMED",
  "REFUNDED",
  "TIMED_OUT",
  "COMPENSATED",
];

@Injectable()
export class MikroBetSagaStateRepository implements BetSagaStateRepository {
  constructor(private readonly em: EntityManager) {}

  async create(input: BetSagaStateCreateInput, txEm: unknown): Promise<void> {
    const em = this.resolveEm(txEm);
    const now = new Date();
    const row: BetSagaStateRow = {
      betId: input.betId,
      correlationId: input.correlationId,
      status: "DEBIT_PENDING",
      deadlineAt: input.deadlineAt,
      updatedAt: now,
    };
    await em.insert(BetSagaStateEntitySchema, row);
  }

  async findByCorrelationId(
    correlationId: string,
    txEm?: unknown,
  ): Promise<BetSagaState | null> {
    const em = this.resolveEm(txEm);
    const row = await em.findOne(BetSagaStateEntitySchema, { correlationId });
    if (!row) return null;
    return this.mapRowToAggregate(row);
  }

  async findByBetId(betId: BetId, txEm?: unknown): Promise<BetSagaState | null> {
    const em = this.resolveEm(txEm);
    const row = await em.findOne(BetSagaStateEntitySchema, { betId });
    if (!row) return null;
    return this.mapRowToAggregate(row);
  }

  async transition(
    betId: BetId,
    fromStatus: BetSagaStatus,
    toStatus: BetSagaStatus,
    txEm: unknown,
  ): Promise<BetSagaState | null> {
    const em = this.resolveEm(txEm);
    const rows = await em
      .getConnection()
      .execute<BetSagaStateDbRow[]>(
        `UPDATE bet_saga_state
         SET status = ?, updated_at = now()
         WHERE bet_id = ? AND status = ?
         RETURNING bet_id, correlation_id, status, deadline_at, updated_at`,
        [toStatus, betId, fromStatus],
        "all",
        em.getTransactionContext(),
      );
    if (rows.length === 0) return null;
    return this.mapDbRowToAggregate(rows[0]!);
  }

  async claimExpired(limit: number, now: Date, txEm: unknown): Promise<BetSagaState[]> {
    const em = this.resolveEm(txEm);
    const rows = await em
      .getConnection()
      .execute<BetSagaStateDbRow[]>(
        `SELECT bet_id, correlation_id, status, deadline_at, updated_at
         FROM bet_saga_state
         WHERE status = 'DEBIT_PENDING' AND deadline_at < ?
         ORDER BY deadline_at
         LIMIT ?
         FOR UPDATE SKIP LOCKED`,
        [now, limit],
        "all",
        em.getTransactionContext(),
      );
    return rows.map((row) => this.mapDbRowToAggregate(row));
  }

  private resolveEm(txEm: unknown): EntityManager {
    if (txEm && txEm instanceof EntityManager) {
      return txEm;
    }
    return this.em;
  }

  private narrowStatus(raw: string): BetSagaStatus {
    if (!VALID_STATUSES.includes(raw as BetSagaStatus)) {
      throw new Error(`Unknown bet_saga_state status from DB: ${raw}`);
    }
    return raw as BetSagaStatus;
  }

  private mapRowToAggregate(row: BetSagaStateRow): BetSagaState {
    return BetSagaState.rehydrate({
      betId: BetId(row.betId),
      correlationId: row.correlationId,
      status: this.narrowStatus(row.status),
      deadlineAt: row.deadlineAt,
      updatedAt: row.updatedAt,
    });
  }

  private mapDbRowToAggregate(row: BetSagaStateDbRow): BetSagaState {
    return BetSagaState.rehydrate({
      betId: BetId(row.bet_id),
      correlationId: row.correlation_id,
      status: this.narrowStatus(row.status),
      deadlineAt: row.deadline_at,
      updatedAt: row.updated_at,
    });
  }
}
