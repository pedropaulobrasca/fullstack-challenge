export type LeaderboardEntry = {
  playerId: string;
  rank: number;
  netProfitCents: bigint;
};

export type LeaderboardDiffResult = {
  changed: boolean;
  before: LeaderboardEntry[];
  after: LeaderboardEntry[];
};

export class LeaderboardSnapshot {
  private constructor() {}

  static diff(before: LeaderboardEntry[], after: LeaderboardEntry[]): LeaderboardDiffResult {
    return {
      changed: !LeaderboardSnapshot.sameOrderedPlayerIds(before, after),
      before,
      after,
    };
  }

  private static sameOrderedPlayerIds(
    before: LeaderboardEntry[],
    after: LeaderboardEntry[],
  ): boolean {
    if (before.length !== after.length) return false;
    for (let i = 0; i < before.length; i++) {
      if (before[i]!.playerId !== after[i]!.playerId) return false;
    }
    return true;
  }
}
