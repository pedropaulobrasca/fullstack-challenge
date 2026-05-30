import type { Money, PlayerId } from "@crash/shared-kernel";

export type LeaderboardRow = {
  playerId: string;
  netProfitCents: bigint;
  winCount: number;
  totalBetCount: number;
  lastSettledAt: Date;
};

export type LeaderboardSnapshotEntry = {
  playerId: string;
  rank: number;
  netProfitCents: bigint;
};

export type ApplyCashedOutInput = {
  playerId: PlayerId;
  betAmount: Money;
  payout: Money;
  settledAt: Date;
};

export type ApplyRefundedInput = {
  playerId: PlayerId;
  betAmount: Money;
  settledAt: Date;
};

export type ApplySettledLossInput = {
  playerId: PlayerId;
  betAmount: Money;
  settledAt: Date;
};

export type LeaderboardWindowOptions = {
  windowHours: number;
};

export interface LeaderboardRepository {
  applyCashedOut(input: ApplyCashedOutInput, txEm: unknown): Promise<void>;
  applyRefunded(input: ApplyRefundedInput, txEm: unknown): Promise<void>;
  applySettledLoss(input: ApplySettledLossInput, txEm: unknown): Promise<void>;
  fetchTopN(
    size: number,
    opts: LeaderboardWindowOptions,
    txEm?: unknown,
  ): Promise<LeaderboardRow[]>;
  fetchSnapshot(
    size: number,
    opts: LeaderboardWindowOptions,
    txEm?: unknown,
  ): Promise<LeaderboardSnapshotEntry[]>;
}
