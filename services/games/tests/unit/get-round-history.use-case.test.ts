import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { RoundId } from "@crash/shared-kernel";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { Round } from "../../src/domain/round.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";

type AnyArgs = unknown[];

type UseCaseCtor = typeof import("../../src/application/use-cases/get-round-history.use-case")["GetRoundHistoryUseCase"];

let GetRoundHistoryUseCase: UseCaseCtor;
let RoundAggregate: typeof import("../../src/domain/round.aggregate")["Round"];

beforeAll(async () => {
  ({ GetRoundHistoryUseCase } = await import(
    "../../src/application/use-cases/get-round-history.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
});

class FakeRoundRepo implements Partial<RoundRepository> {
  capturedLimit: number | null = null;
  capturedOffset: number | null = null;
  constructor(private readonly rounds: Round[]) {}
  async listSettledHistory(limit: number, offset: number): Promise<Round[]> {
    this.capturedLimit = limit;
    this.capturedOffset = offset;
    return this.rounds;
  }
  async findById(): Promise<Round | null> {
    return null;
  }
  async findOpen(): Promise<Round | null> {
    return null;
  }
  async findServerSeedByNonce(): Promise<string | null> {
    return null;
  }
  async saveScheduled(): Promise<void> {}
  async transitionFromBettingToRunning(..._args: AnyArgs): Promise<Round | null> {
    return null;
  }
  async transitionFromRunningToCrashed(..._args: AnyArgs): Promise<Round | null> {
    return null;
  }
  async transitionFromCrashedToSettled(..._args: AnyArgs): Promise<Round | null> {
    return null;
  }
}

class FakeBetRepo implements Partial<BetRepository> {
  constructor(private readonly counts: Map<string, number>) {}
  async countByRoundId(roundId: { toString(): string }): Promise<number> {
    return this.counts.get(String(roundId)) ?? 0;
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
  async listByPlayer(): Promise<[]> {
    return [];
  }
  async save(): Promise<void> {}
  async tryTransition(): Promise<null> {
    return null;
  }
}

function buildSettledRound(idHex: string, nonce: bigint, crashCenti: number): Round {
  const now = new Date("2026-01-01T00:00:00Z");
  return RoundAggregate.rehydrate({
    id: RoundId(idHex),
    nonce,
    status: "SETTLED",
    seedHash: "0".repeat(64),
    clientSeed: "client-seed",
    serverSeed: "1".repeat(64),
    crashPoint: CrashPoint.fromCentiX(crashCenti),
    formulaVersion: 1,
    bettingEndsAt: now,
    startedAt: now,
    crashedAt: now,
    settledAt: now,
    createdAt: now,
  });
}

describe("GetRoundHistoryUseCase", () => {
  test("clamps limit to [1, 100] and offset to >= 0", async () => {
    const repo = new FakeRoundRepo([]);
    const useCase = new GetRoundHistoryUseCase(
      repo as unknown as RoundRepository,
      new FakeBetRepo(new Map()) as unknown as BetRepository,
    );

    await useCase.execute(500, -5);
    expect(repo.capturedLimit).toBe(100);
    expect(repo.capturedOffset).toBe(0);

    await useCase.execute(0, 10);
    expect(repo.capturedLimit).toBe(1);
    expect(repo.capturedOffset).toBe(10);
  });

  test("maps rounds to history view with bet counts", async () => {
    const round = buildSettledRound("33333333-3333-3333-3333-333333333333", 7n, 234);
    const repo = new FakeRoundRepo([round]);
    const counts = new Map<string, number>([
      [round.id as unknown as string, 5],
    ]);

    const useCase = new GetRoundHistoryUseCase(
      repo as unknown as RoundRepository,
      new FakeBetRepo(counts) as unknown as BetRepository,
    );
    const result = await useCase.execute(20, 0);

    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
    expect(result.rounds).toHaveLength(1);
    const entry = result.rounds[0]!;
    expect(entry.nonce).toBe("7");
    expect(entry.crashPoint).toBe(2.34);
    expect(entry.totalBetCount).toBe(5);
  });
});
