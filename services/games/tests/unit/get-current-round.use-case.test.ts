import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { Money, PlayerId, BetId, RoundId } from "@crash/shared-kernel";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { Round } from "../../src/domain/round.aggregate";
import type { Bet } from "../../src/domain/bet.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";

type AnyArgs = unknown[];

type UseCaseCtor = typeof import("../../src/application/use-cases/get-current-round.use-case")["GetCurrentRoundUseCase"];

let GetCurrentRoundUseCase: UseCaseCtor;
let RoundAggregate: typeof import("../../src/domain/round.aggregate")["Round"];
let BetAggregate: typeof import("../../src/domain/bet.aggregate")["Bet"];

beforeAll(async () => {
  ({ GetCurrentRoundUseCase } = await import(
    "../../src/application/use-cases/get-current-round.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
  ({ Bet: BetAggregate } = await import("../../src/domain/bet.aggregate"));
});

class FakeRoundRepo implements Partial<RoundRepository> {
  constructor(private readonly open: Round | null) {}
  async findOpen(): Promise<Round | null> {
    return this.open;
  }
  async findById(): Promise<Round | null> {
    return null;
  }
  async findServerSeedByNonce(): Promise<string | null> {
    return null;
  }
  async listSettledHistory(): Promise<Round[]> {
    return [];
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
  constructor(private readonly active: Bet[]) {}
  async findActiveByRound(): Promise<Bet[]> {
    return this.active;
  }
  async countByRoundId(): Promise<number> {
    return this.active.length;
  }
  async findById(): Promise<Bet | null> {
    return null;
  }
  async findActiveByRoundAndPlayer(): Promise<Bet | null> {
    return null;
  }
  async listByPlayer(): Promise<Bet[]> {
    return [];
  }
  async save(): Promise<void> {}
  async tryTransition(): Promise<Bet | null> {
    return null;
  }
}

function buildBettingRound(now: Date): Round {
  return RoundAggregate.schedule(
    RoundId("11111111-1111-1111-1111-111111111111"),
    0n,
    "0".repeat(64),
    "client-seed",
    1,
    new Date(now.getTime() + 5000),
    now,
  );
}

describe("GetCurrentRoundUseCase", () => {
  test("returns null when no open round exists", async () => {
    const useCase = new GetCurrentRoundUseCase(
      new FakeRoundRepo(null) as unknown as RoundRepository,
      new FakeBetRepo([]) as unknown as BetRepository,
    );
    const result = await useCase.execute(new Date());
    expect(result).toBeNull();
  });

  test("returns BETTING round view with seedHash exposed and serverSeed null", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const round = buildBettingRound(now);
    const useCase = new GetCurrentRoundUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
      new FakeBetRepo([]) as unknown as BetRepository,
    );

    const result = await useCase.execute(now);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("BETTING");
    expect(result!.seedHash).toBe("0".repeat(64));
    expect(result!.serverSeed).toBeNull();
    expect(result!.currentMultiplier).toBeNull();
    expect(result!.crashPoint).toBeNull();
    expect(result!.nonce).toBe("0");
  });

  test("masks playerId to 8-char sha256 prefix in bets list", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const round = buildBettingRound(now);
    const bet = BetAggregate.place(
      BetId("22222222-2222-2222-2222-222222222222"),
      round.id,
      PlayerId("player-alice"),
      Money.of(500n),
      now,
    );

    const useCase = new GetCurrentRoundUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
      new FakeBetRepo([bet]) as unknown as BetRepository,
    );
    const result = await useCase.execute(now);

    expect(result!.bets).toHaveLength(1);
    const entry = result!.bets[0]!;
    expect(entry.playerIdMasked).toMatch(/^[0-9a-f]{8}$/);
    expect(entry.playerIdMasked).not.toContain("player-alice");
    expect(entry.amount.amount).toBe("500");
  });

  test("computes currentMultiplier when round is RUNNING", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const scheduled = buildBettingRound(now);
    const running = scheduled.start(now);
    const later = new Date(now.getTime() + 1000);

    const useCase = new GetCurrentRoundUseCase(
      new FakeRoundRepo(running) as unknown as RoundRepository,
      new FakeBetRepo([]) as unknown as BetRepository,
    );
    const result = await useCase.execute(later);
    expect(result!.status).toBe("RUNNING");
    expect(result!.currentMultiplier).toBeGreaterThan(1);
    expect(result!.serverSeed).toBeNull();
  });

  test("nullifies serverSeed pre-SETTLED even if aggregate would expose it (defensive)", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const crashed = buildBettingRound(now)
      .start(now)
      .crash(CrashPoint.of(2.5), new Date(now.getTime() + 500));

    const useCase = new GetCurrentRoundUseCase(
      new FakeRoundRepo(crashed) as unknown as RoundRepository,
      new FakeBetRepo([]) as unknown as BetRepository,
    );
    const result = await useCase.execute(now);
    expect(result!.status).toBe("CRASHED");
    expect(result!.serverSeed).toBeNull();
    expect(result!.crashPoint).toBe(2.5);
  });
});
