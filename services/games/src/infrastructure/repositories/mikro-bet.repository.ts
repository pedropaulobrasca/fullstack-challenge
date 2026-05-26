import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import { Bet, type BetProps } from "../../domain/bet.aggregate";
import type { BetRepository } from "../../domain/bet.repository";
import { Multiplier } from "../../domain/value-objects/multiplier";
import { BET_STATUSES, type BetStatus } from "../../domain/value-objects/bet-status";
import { BetEntitySchema, type BetRow } from "../persistence/bet.entity";
import { env } from "../../config/defaults";

type BetDbRow = {
  id: string;
  round_id: string;
  player_id: string;
  amount_cents: string;
  currency_code: string;
  status: string;
  cashed_out_at: Date | null;
  cashed_out_multiplier_centi_x: number | null;
  payout_cents: string | null;
  refund_reason: string | null;
  created_at: Date;
};

@Injectable()
export class MikroBetRepository implements BetRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: BetId): Promise<Bet | null> {
    const row = await this.em.findOne(BetEntitySchema, { id });
    if (!row) return null;
    return this.mapRowToAggregate(row);
  }

  async findActiveByRoundAndPlayer(
    roundId: RoundId,
    playerId: PlayerId,
  ): Promise<Bet | null> {
    const row = await this.em.findOne(BetEntitySchema, {
      roundId,
      playerId,
      status: { $in: ["PENDING", "ACTIVE"] },
    });
    if (!row) return null;
    return this.mapRowToAggregate(row);
  }

  async findActiveByRound(roundId: RoundId): Promise<Bet[]> {
    const rows = await this.em.find(BetEntitySchema, {
      roundId,
      status: { $in: ["PENDING", "ACTIVE"] },
    });
    return rows.map((row) => this.mapRowToAggregate(row));
  }

  async listByPlayer(
    playerId: PlayerId,
    limit: number,
    offset: number,
  ): Promise<Bet[]> {
    const rows = await this.em.find(
      BetEntitySchema,
      { playerId },
      { orderBy: { createdAt: "desc" }, limit, offset },
    );
    return rows.map((row) => this.mapRowToAggregate(row));
  }

  async save(bet: Bet, txEm?: unknown): Promise<void> {
    const em = this.resolveEm(txEm);
    const row: BetRow = {
      id: bet.id,
      roundId: bet.roundId,
      playerId: bet.playerId,
      amountCents: bet.amount.toCents(),
      currencyCode: env.CURRENCY_CODE,
      status: bet.status,
      cashedOutAt: bet.cashedOutAt,
      cashedOutMultiplierCentiX: bet.cashedOutMultiplier?.toCentiX() ?? null,
      payoutCents: bet.payout?.toCents() ?? null,
      refundReason: bet.refundReason,
      createdAt: bet.createdAt,
    };
    await em.upsert(BetEntitySchema, row);
    await em.flush();
  }

  async tryTransition(
    id: BetId,
    fromStatus: BetStatus,
    toStatus: BetStatus,
    patch: Partial<BetProps>,
    txEm?: unknown,
  ): Promise<Bet | null> {
    const em = this.resolveEm(txEm);
    const cashedOutAt = patch.cashedOutAt ?? null;
    const cashedOutMultiplierCentiX = patch.cashedOutMultiplier?.toCentiX() ?? null;
    const payoutCents = patch.payout?.toCents()?.toString() ?? null;
    const refundReason = patch.refundReason ?? null;

    const rows = await em
      .getConnection()
      .execute<BetDbRow[]>(
        `UPDATE bets
         SET status = ?,
             cashed_out_at = ?,
             cashed_out_multiplier_centi_x = ?,
             payout_cents = ?,
             refund_reason = ?
         WHERE id = ? AND status = ?
         RETURNING *`,
        [
          toStatus,
          cashedOutAt,
          cashedOutMultiplierCentiX,
          payoutCents,
          refundReason,
          id,
          fromStatus,
        ],
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

  private mapRowToAggregate(row: BetRow): Bet {
    const props: BetProps = {
      id: BetId(row.id),
      roundId: RoundId(row.roundId),
      playerId: PlayerId(row.playerId),
      amount: Money.of(BigInt(row.amountCents)),
      status: this.narrowBetStatus(row.status),
      cashedOutAt: row.cashedOutAt,
      cashedOutMultiplier:
        row.cashedOutMultiplierCentiX === null
          ? null
          : Multiplier.fromTenThousandths(BigInt(row.cashedOutMultiplierCentiX) * 100n),
      payout: row.payoutCents === null ? null : Money.of(BigInt(row.payoutCents)),
      refundReason: row.refundReason,
      createdAt: row.createdAt,
    };
    return Bet.rehydrate(props);
  }

  private mapDbRowToAggregate(row: BetDbRow): Bet {
    const props: BetProps = {
      id: BetId(row.id),
      roundId: RoundId(row.round_id),
      playerId: PlayerId(row.player_id),
      amount: Money.of(BigInt(row.amount_cents)),
      status: this.narrowBetStatus(row.status),
      cashedOutAt: row.cashed_out_at,
      cashedOutMultiplier:
        row.cashed_out_multiplier_centi_x === null
          ? null
          : Multiplier.fromTenThousandths(
              BigInt(row.cashed_out_multiplier_centi_x) * 100n,
            ),
      payout: row.payout_cents === null ? null : Money.of(BigInt(row.payout_cents)),
      refundReason: row.refund_reason,
      createdAt: row.created_at,
    };
    return Bet.rehydrate(props);
  }

  private narrowBetStatus(raw: string): BetStatus {
    if (!BET_STATUSES.includes(raw as BetStatus)) {
      throw new Error(`Unknown bet status from DB: ${raw}`);
    }
    return raw as BetStatus;
  }
}
