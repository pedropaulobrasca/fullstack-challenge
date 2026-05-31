import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { Money } from "@crash/shared-kernel";
import { PlayerId, BetId, RoundId } from "@crash/shared-kernel/identity";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { Bet } from "../../src/domain/bet.aggregate";

type UseCaseCtor = typeof import("../../src/application/use-cases/get-player-bets.use-case")["GetPlayerBetsUseCase"];

let GetPlayerBetsUseCase: UseCaseCtor;
let BetAggregate: typeof import("../../src/domain/bet.aggregate")["Bet"];

beforeAll(async () => {
  ({ GetPlayerBetsUseCase } = await import(
    "../../src/application/use-cases/get-player-bets.use-case"
  ));
  ({ Bet: BetAggregate } = await import("../../src/domain/bet.aggregate"));
});

class FakeBetRepo implements Partial<BetRepository> {
  capturedLimit: number | null = null;
  capturedOffset: number | null = null;
  capturedPlayerId: PlayerId | null = null;

  constructor(private readonly bets: Bet[]) {}
  async listByPlayer(
    playerId: PlayerId,
    limit: number,
    offset: number,
  ): Promise<Bet[]> {
    this.capturedPlayerId = playerId;
    this.capturedLimit = limit;
    this.capturedOffset = offset;
    return this.bets;
  }
  async findById(): Promise<null> {
    return null;
  }
  async findActiveByRound(): Promise<[]> {
    return [];
  }
  async findActiveByRoundAndPlayer(): Promise<null> {
    return null;
  }
  async countByRoundId(): Promise<number> {
    return 0;
  }
  async save(): Promise<void> {}
  async tryTransition(): Promise<null> {
    return null;
  }
}

describe("GetPlayerBetsUseCase", () => {
  test("clamps limit/offset and forwards playerId to repo", async () => {
    const repo = new FakeBetRepo([]);
    const useCase = new GetPlayerBetsUseCase(repo as unknown as BetRepository);

    const result = await useCase.execute(PlayerId("p-1"), 9999, -3);
    expect(repo.capturedPlayerId).toBe(PlayerId("p-1"));
    expect(repo.capturedLimit).toBe(100);
    expect(repo.capturedOffset).toBe(0);
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
  });

  test("maps Bet aggregates to view entries with Money snapshots", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const bet = BetAggregate.place(
      BetId("77777777-7777-7777-7777-777777777777"),
      RoundId("88888888-8888-8888-8888-888888888888"),
      PlayerId("p-2"),
      Money.of(2500n),
      now,
    );
    const useCase = new GetPlayerBetsUseCase(
      new FakeBetRepo([bet]) as unknown as BetRepository,
    );

    const result = await useCase.execute(PlayerId("p-2"), 20, 0);
    expect(result.bets).toHaveLength(1);
    const entry = result.bets[0]!;
    expect(entry.amount.amount).toBe("2500");
    expect(entry.status).toBe("PENDING");
    expect(entry.payout).toBeNull();
    expect(entry.cashedOutMultiplier).toBeNull();
    expect(entry.createdAt).toBe(now.toISOString());
  });
});
