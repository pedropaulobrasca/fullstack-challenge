import type { BetId, PlayerId, RoundId } from "@crash/shared-kernel/identity";
import type { Bet, BetProps } from "./bet.aggregate";
import type { BetStatus } from "./value-objects/bet-status";

export interface BetRepository {
  findById(id: BetId): Promise<Bet | null>;
  findActiveByRoundAndPlayer(roundId: RoundId, playerId: PlayerId): Promise<Bet | null>;
  findActiveByRound(roundId: RoundId): Promise<Bet[]>;
  /**
   * Returns ALL bets for the round regardless of status.
   * Used by Phase 8 Replay overlays — PENDING/ACTIVE/CASHED_OUT/LOST/REFUNDED
   * are all rendered so the replay reproduces the full live experience.
   */
  findByRound(roundId: RoundId): Promise<Bet[]>;
  /**
   * Returns ACTIVE bets in the given round whose autoCashoutTarget is non-null
   * and <= ceilingCentiX. Consumed at 30Hz by Phase 9 Plan 05 AutoCashoutTickService
   * — backed by the partial index `idx_bets_auto_cashout_candidates`.
   */
  findAutoCashoutCandidates(roundId: RoundId, ceilingCentiX: number): Promise<Bet[]>;
  countByRoundId(roundId: RoundId): Promise<number>;
  listByPlayer(playerId: PlayerId, limit: number, offset: number): Promise<Bet[]>;
  save(bet: Bet, txEm?: unknown): Promise<void>;
  /**
   * Returns aggregated bet/payout totals across all bets attached to the most
   * recent `windowRounds` SETTLED rounds. Used by Phase 10 plan 05 to expose
   * the `crash_rtp_window` Prometheus gauge — rolling RTP = payout / bet.
   * Returns zero totals when no settled rounds exist yet.
   */
  getRollingRtp(windowRounds: number, txEm?: unknown): Promise<{
    payoutTotalCents: bigint;
    betTotalCents: bigint;
  }>;
  tryTransition(
    id: BetId,
    fromStatus: BetStatus,
    toStatus: BetStatus,
    patch: Partial<BetProps>,
    txEm?: unknown,
  ): Promise<Bet | null>;
}
