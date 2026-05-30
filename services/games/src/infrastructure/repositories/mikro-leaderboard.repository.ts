import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type {
  ApplyCashedOutInput,
  ApplyRefundedInput,
  ApplySettledLossInput,
  LeaderboardRepository,
  LeaderboardRow,
  LeaderboardSnapshotEntry,
  LeaderboardWindowOptions,
} from "../../domain/leaderboard.repository";

type LeaderboardDbRow = {
  player_id: string;
  net_profit_cents: string;
  win_count: number;
  total_bet_count: number;
  last_settled_at: Date | string;
};

@Injectable()
export class MikroLeaderboardRepository implements LeaderboardRepository {
  constructor(private readonly em: EntityManager) {}

  async applyCashedOut(input: ApplyCashedOutInput, txEm: unknown): Promise<void> {
    const em = this.resolveEm(txEm);
    const delta = input.payout.toCents() - input.betAmount.toCents();
    await em.getConnection().execute(
      `INSERT INTO leaderboard_24h (
         player_id, net_profit_cents, win_count, total_bet_count, last_settled_at
       )
       VALUES (?, ?, 1, 1, ?)
       ON CONFLICT (player_id) DO UPDATE SET
         net_profit_cents = leaderboard_24h.net_profit_cents + EXCLUDED.net_profit_cents,
         win_count = leaderboard_24h.win_count + 1,
         total_bet_count = leaderboard_24h.total_bet_count + 1,
         last_settled_at = EXCLUDED.last_settled_at`,
      [input.playerId as unknown as string, delta.toString(), input.settledAt],
      "run",
      em.getTransactionContext(),
    );
  }

  async applyRefunded(_input: ApplyRefundedInput, _txEm: unknown): Promise<void> {
    return;
  }

  async applySettledLoss(input: ApplySettledLossInput, txEm: unknown): Promise<void> {
    const em = this.resolveEm(txEm);
    const delta = -input.betAmount.toCents();
    await em.getConnection().execute(
      `INSERT INTO leaderboard_24h (
         player_id, net_profit_cents, win_count, total_bet_count, last_settled_at
       )
       VALUES (?, ?, 0, 1, ?)
       ON CONFLICT (player_id) DO UPDATE SET
         net_profit_cents = leaderboard_24h.net_profit_cents + EXCLUDED.net_profit_cents,
         total_bet_count = leaderboard_24h.total_bet_count + 1,
         last_settled_at = EXCLUDED.last_settled_at`,
      [input.playerId as unknown as string, delta.toString(), input.settledAt],
      "run",
      em.getTransactionContext(),
    );
  }

  async fetchTopN(
    size: number,
    opts: LeaderboardWindowOptions,
    txEm?: unknown,
  ): Promise<LeaderboardRow[]> {
    const em = this.resolveEm(txEm);
    const rows = await em
      .getConnection()
      .execute<LeaderboardDbRow[]>(
        `SELECT player_id, net_profit_cents, win_count, total_bet_count, last_settled_at
           FROM leaderboard_24h
          WHERE last_settled_at > NOW() - ((? || ' hours')::INTERVAL)
          ORDER BY net_profit_cents DESC, player_id
          LIMIT ?`,
        [String(opts.windowHours), size],
        "all",
        em.getTransactionContext(),
      );
    return rows.map((row) => this.mapRow(row));
  }

  async fetchSnapshot(
    size: number,
    opts: LeaderboardWindowOptions,
    txEm?: unknown,
  ): Promise<LeaderboardSnapshotEntry[]> {
    const top = await this.fetchTopN(size, opts, txEm);
    return top.map((row, index) => ({
      playerId: row.playerId,
      rank: index + 1,
      netProfitCents: row.netProfitCents,
    }));
  }

  private mapRow(row: LeaderboardDbRow): LeaderboardRow {
    return {
      playerId: row.player_id,
      netProfitCents: BigInt(row.net_profit_cents),
      winCount: Number(row.win_count),
      totalBetCount: Number(row.total_bet_count),
      lastSettledAt: this.toDate(row.last_settled_at),
    };
  }

  private toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  private resolveEm(txEm: unknown): EntityManager {
    if (txEm && txEm instanceof EntityManager) {
      return txEm;
    }
    return this.em;
  }
}
