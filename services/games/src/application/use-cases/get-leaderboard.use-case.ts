import { Inject, Injectable } from "@nestjs/common";
import { PlayerId } from "@crash/shared-kernel/identity";
import type {
  LeaderboardEntryWire,
  LeaderboardUpdatedPayload,
} from "@crash/contracts/ws";
import { env } from "../../config/defaults";
import { LEADERBOARD_REPOSITORY } from "../tokens";
import type {
  LeaderboardRepository,
  LeaderboardSnapshotEntry,
} from "../../domain/leaderboard.repository";
import { maskPlayerId } from "@crash/shared-kernel/identity";
export type GetLeaderboardInput = {
  window: "24h";
};

export function leaderboardSnapshotEntryToWire(
  entry: LeaderboardSnapshotEntry,
): LeaderboardEntryWire {
  return {
    playerIdMasked: maskPlayerId(PlayerId(entry.playerId)),
    rank: entry.rank,
    netProfit: {
      amount: entry.netProfitCents.toString(),
      currency: "CRD",
      scale: 2,
    },
    winCount: entry.winCount,
    totalBetCount: entry.totalBetCount,
  };
}

@Injectable()
export class GetLeaderboardUseCase {
  constructor(
    @Inject(LEADERBOARD_REPOSITORY)
    private readonly leaderboard: LeaderboardRepository,
  ) {}

  async execute(_input: GetLeaderboardInput): Promise<LeaderboardUpdatedPayload> {
    const rows = await this.leaderboard.fetchTopN(env.LEADERBOARD_TOP_N, {
      windowHours: env.LEADERBOARD_WINDOW_HOURS,
    });

    const entries = rows.map((row, index) =>
      leaderboardSnapshotEntryToWire({
        playerId: row.playerId,
        rank: index + 1,
        netProfitCents: row.netProfitCents,
        winCount: row.winCount,
        totalBetCount: row.totalBetCount,
      }),
    );

    return {
      entries,
      updatedAt: new Date().toISOString(),
    };
  }
}
