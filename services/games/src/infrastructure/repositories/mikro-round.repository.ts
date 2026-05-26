import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { RoundId } from "@crash/shared-kernel";
import { Round, type RoundProps } from "../../domain/round.aggregate";
import type { RoundRepository } from "../../domain/round.repository";
import { CrashPoint } from "../../domain/value-objects/crash-point";
import { ROUND_STATUSES, type RoundStatus } from "../../domain/value-objects/round-status";
import { RoundEntitySchema, type RoundRow } from "../persistence/round.entity";

type RoundDbRow = {
  id: string;
  nonce: string;
  status: string;
  seed_hash: string;
  client_seed: string;
  server_seed: string | null;
  crash_point_centi_x: number | null;
  formula_version: number;
  betting_ends_at: Date;
  started_at: Date | null;
  crashed_at: Date | null;
  settled_at: Date | null;
  created_at: Date;
};

@Injectable()
export class MikroRoundRepository implements RoundRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: RoundId): Promise<Round | null> {
    const row = await this.em.findOne(RoundEntitySchema, { id });
    if (!row) return null;
    return this.mapRowToAggregate(row);
  }

  async findOpen(): Promise<Round | null> {
    const row = await this.em.findOne(RoundEntitySchema, {
      status: { $in: ["BETTING", "RUNNING", "CRASHED"] },
    });
    if (!row) return null;
    return this.mapRowToAggregate(row);
  }

  async findServerSeedByNonce(nonce: bigint): Promise<string | null> {
    const row = await this.em.findOne(RoundEntitySchema, { nonce });
    return row?.serverSeed ?? null;
  }

  async listSettledHistory(limit: number, offset: number): Promise<Round[]> {
    const rows = await this.em.find(
      RoundEntitySchema,
      { status: "SETTLED" },
      { orderBy: { settledAt: "desc" }, limit, offset },
    );
    return rows.map((row) => this.mapRowToAggregate(row));
  }

  async saveScheduled(round: Round): Promise<void> {
    const row: RoundRow = {
      id: round.id,
      nonce: round.nonce,
      status: round.status,
      seedHash: round.seedHash,
      clientSeed: round.clientSeed,
      serverSeed: round.serverSeed,
      crashPointCentiX: round.crashPoint?.toCentiX() ?? null,
      formulaVersion: round.formulaVersion,
      bettingEndsAt: round.bettingEndsAt,
      startedAt: round.startedAt,
      crashedAt: round.crashedAt,
      settledAt: round.settledAt,
      createdAt: round.createdAt,
    };
    this.em.persist(this.em.create(RoundEntitySchema, row));
    await this.em.flush();
  }

  async transitionFromBettingToRunning(
    id: RoundId,
    startedAt: Date,
    txEm?: unknown,
  ): Promise<Round | null> {
    const em = this.resolveEm(txEm);
    const rows = await em
      .getConnection()
      .execute<RoundDbRow[]>(
        `UPDATE rounds
         SET status = 'RUNNING', started_at = ?
         WHERE id = ? AND status = 'BETTING'
         RETURNING *`,
        [startedAt, id],
        "all",
        em.getTransactionContext(),
      );
    if (rows.length === 0) return null;
    return this.mapDbRowToAggregate(rows[0]!);
  }

  async transitionFromRunningToCrashed(
    id: RoundId,
    crashPoint: CrashPoint,
    crashedAt: Date,
    txEm?: unknown,
  ): Promise<Round | null> {
    const em = this.resolveEm(txEm);
    const rows = await em
      .getConnection()
      .execute<RoundDbRow[]>(
        `UPDATE rounds
         SET status = 'CRASHED', crash_point_centi_x = ?, crashed_at = ?
         WHERE id = ? AND status = 'RUNNING'
         RETURNING *`,
        [crashPoint.toCentiX(), crashedAt, id],
        "all",
        em.getTransactionContext(),
      );
    if (rows.length === 0) return null;
    return this.mapDbRowToAggregate(rows[0]!);
  }

  async transitionFromCrashedToSettled(
    id: RoundId,
    serverSeed: string,
    settledAt: Date,
    txEm?: unknown,
  ): Promise<Round | null> {
    const em = this.resolveEm(txEm);
    const rows = await em
      .getConnection()
      .execute<RoundDbRow[]>(
        `UPDATE rounds
         SET status = 'SETTLED', server_seed = ?, settled_at = ?
         WHERE id = ? AND status = 'CRASHED'
         RETURNING *`,
        [serverSeed, settledAt, id],
        "all",
        em.getTransactionContext(),
      );
    if (rows.length === 0) return null;
    return this.mapDbRowToAggregate(rows[0]!);
  }

  private resolveEm(txEm: unknown): EntityManager {
    if (txEm && txEm instanceof EntityManager) {
      return txEm;
    }
    return this.em;
  }

  private mapRowToAggregate(row: RoundRow): Round {
    const props: RoundProps = {
      id: RoundId(row.id),
      nonce: BigInt(row.nonce),
      status: this.narrowRoundStatus(row.status),
      seedHash: row.seedHash,
      clientSeed: row.clientSeed,
      serverSeed: row.serverSeed,
      crashPoint:
        row.crashPointCentiX === null
          ? null
          : CrashPoint.fromCentiX(row.crashPointCentiX),
      formulaVersion: row.formulaVersion,
      bettingEndsAt: row.bettingEndsAt,
      startedAt: row.startedAt,
      crashedAt: row.crashedAt,
      settledAt: row.settledAt,
      createdAt: row.createdAt,
    };
    return Round.rehydrate(props);
  }

  private mapDbRowToAggregate(row: RoundDbRow): Round {
    const props: RoundProps = {
      id: RoundId(row.id),
      nonce: BigInt(row.nonce),
      status: this.narrowRoundStatus(row.status),
      seedHash: row.seed_hash,
      clientSeed: row.client_seed,
      serverSeed: row.server_seed,
      crashPoint:
        row.crash_point_centi_x === null
          ? null
          : CrashPoint.fromCentiX(row.crash_point_centi_x),
      formulaVersion: row.formula_version,
      bettingEndsAt: row.betting_ends_at,
      startedAt: row.started_at,
      crashedAt: row.crashed_at,
      settledAt: row.settled_at,
      createdAt: row.created_at,
    };
    return Round.rehydrate(props);
  }

  private narrowRoundStatus(raw: string): RoundStatus {
    if (!ROUND_STATUSES.includes(raw as RoundStatus)) {
      throw new Error(`Unknown round status from DB: ${raw}`);
    }
    return raw as RoundStatus;
  }
}
