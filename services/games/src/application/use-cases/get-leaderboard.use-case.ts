import { Inject, Injectable } from "@nestjs/common";
import { PlayerId } from "@crash/shared-kernel";
import type { LeaderboardUpdatedPayload } from "@crash/contracts/ws";
import { env } from "../../config/defaults";
import { LEADERBOARD_REPOSITORY } from "../tokens";
import type { LeaderboardRepository } from "../../domain/leaderboard.repository";
import { maskPlayerId } from "./mask-player-id";

export type GetLeaderboardInput = {
  window: "24h";
};

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

    const entries = rows.map((row, index) => ({
      playerIdMasked: maskPlayerId(PlayerId(row.playerId)),
      rank: index + 1,
      netProfit: {
        amount: row.netProfitCents.toString(),
        currency: "CRD",
        scale: 2,
      },
      winCount: row.winCount,
      totalBetCount: row.totalBetCount,
    }));

    return {
      entries,
      updatedAt: new Date().toISOString(),
    };
  }
}
