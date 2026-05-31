import { describe, expect, test } from "bun:test";
import { GetLeaderboardUseCase } from "../../src/application/use-cases/get-leaderboard.use-case";
import type {
  LeaderboardRepository,
  LeaderboardRow,
  LeaderboardSnapshotEntry,
} from "../../src/domain/leaderboard.repository";
import { PlayerId, maskPlayerId } from "@crash/shared-kernel";

class StubLeaderboardRepository implements LeaderboardRepository {
  constructor(private readonly rows: LeaderboardRow[]) {}
  lastSize = 0;
  lastWindowHours = 0;

  async applyCashedOut(): Promise<void> {}
  async applyRefunded(): Promise<void> {}
  async applySettledLoss(): Promise<void> {}

  async fetchTopN(
    size: number,
    opts: { windowHours: number },
  ): Promise<LeaderboardRow[]> {
    this.lastSize = size;
    this.lastWindowHours = opts.windowHours;
    return this.rows.slice(0, size);
  }

  async fetchSnapshot(): Promise<LeaderboardSnapshotEntry[]> {
    return [];
  }
}

describe("GetLeaderboardUseCase", () => {
  test("maps rows to wire entries with masked playerId, rank, MoneySnapshot, and counts", async () => {
    const playerA = "11111111-1111-1111-1111-111111111111";
    const playerB = "22222222-2222-2222-2222-222222222222";
    const repo = new StubLeaderboardRepository([
      {
        playerId: playerA,
        netProfitCents: 5000n,
        winCount: 4,
        totalBetCount: 6,
        lastSettledAt: new Date(),
      },
      {
        playerId: playerB,
        netProfitCents: 2500n,
        winCount: 2,
        totalBetCount: 3,
        lastSettledAt: new Date(),
      },
    ]);

    const useCase = new GetLeaderboardUseCase(repo);
    const result = await useCase.execute({ window: "24h" });

    expect(result.entries.length).toBe(2);
    expect(result.entries[0]!.playerIdMasked).toBe(maskPlayerId(PlayerId(playerA)));
    expect(result.entries[0]!.rank).toBe(1);
    expect(result.entries[0]!.netProfit.amount).toBe("5000");
    expect(result.entries[0]!.netProfit.currency).toBe("CRD");
    expect(result.entries[0]!.netProfit.scale).toBe(2);
    expect(result.entries[0]!.winCount).toBe(4);
    expect(result.entries[0]!.totalBetCount).toBe(6);

    expect(result.entries[1]!.rank).toBe(2);
    expect(result.entries[1]!.playerIdMasked).toBe(maskPlayerId(PlayerId(playerB)));
    expect(result.entries[1]!.netProfit.amount).toBe("2500");

    expect(typeof result.updatedAt).toBe("string");
    expect(() => new Date(result.updatedAt).toISOString()).not.toThrow();
  });

  test("calls repository with env.LEADERBOARD_TOP_N and env.LEADERBOARD_WINDOW_HOURS", async () => {
    const repo = new StubLeaderboardRepository([]);
    const useCase = new GetLeaderboardUseCase(repo);
    await useCase.execute({ window: "24h" });
    expect(repo.lastSize).toBeGreaterThan(0);
    expect(repo.lastWindowHours).toBeGreaterThan(0);
  });

  test("returns empty entries when repository is empty", async () => {
    const repo = new StubLeaderboardRepository([]);
    const useCase = new GetLeaderboardUseCase(repo);
    const result = await useCase.execute({ window: "24h" });
    expect(result.entries).toEqual([]);
  });

  test("preserves signed net profit (negative cents serialized as negative MoneySnapshot.amount)", async () => {
    const playerId = "33333333-3333-3333-3333-333333333333";
    const repo = new StubLeaderboardRepository([
      {
        playerId,
        netProfitCents: -1500n,
        winCount: 0,
        totalBetCount: 5,
        lastSettledAt: new Date(),
      },
    ]);
    const useCase = new GetLeaderboardUseCase(repo);
    const result = await useCase.execute({ window: "24h" });
    expect(result.entries[0]!.netProfit.amount).toBe("-1500");
  });
});
