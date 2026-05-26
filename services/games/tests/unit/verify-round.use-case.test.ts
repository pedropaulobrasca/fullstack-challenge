import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RoundId } from "@crash/shared-kernel";
import { deriveCrashPoint } from "@crash/contracts";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { Round } from "../../src/domain/round.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";

type AnyArgs = unknown[];

type UseCaseCtor = typeof import("../../src/application/use-cases/verify-round.use-case")["VerifyRoundUseCase"];

let VerifyRoundUseCase: UseCaseCtor;
let RoundAggregate: typeof import("../../src/domain/round.aggregate")["Round"];

beforeAll(async () => {
  ({ VerifyRoundUseCase } = await import(
    "../../src/application/use-cases/verify-round.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
});

class FakeRoundRepo implements Partial<RoundRepository> {
  constructor(
    private readonly round: Round | null,
    private readonly previousSeed: string | null = null,
  ) {}
  async findById(): Promise<Round | null> {
    return this.round;
  }
  async findServerSeedByNonce(): Promise<string | null> {
    return this.previousSeed;
  }
  async findOpen(): Promise<Round | null> {
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

function buildSettledRound(serverSeed: string, clientSeed: string, nonce: bigint): Round {
  const now = new Date("2026-01-01T00:00:00Z");
  const crash = deriveCrashPoint({
    serverSeed,
    clientSeed,
    nonce,
    instantCrashBucket: 101,
  });
  return RoundAggregate.rehydrate({
    id: RoundId("44444444-4444-4444-4444-444444444444"),
    nonce,
    status: "SETTLED",
    seedHash: "a".repeat(64),
    clientSeed,
    serverSeed,
    crashPoint: CrashPoint.of(crash),
    formulaVersion: 1,
    bettingEndsAt: now,
    startedAt: now,
    crashedAt: now,
    settledAt: now,
    createdAt: now,
  });
}

describe("VerifyRoundUseCase (REQ-FAIR-02 gate)", () => {
  test("throws NotFoundException when round does not exist", async () => {
    const useCase = new VerifyRoundUseCase(
      new FakeRoundRepo(null) as unknown as RoundRepository,
    );
    await expect(
      useCase.execute(RoundId("55555555-5555-5555-5555-555555555555")),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test("throws BadRequestException when round is not yet SETTLED (REQ-FAIR-02)", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const round = RoundAggregate.schedule(
      RoundId("66666666-6666-6666-6666-666666666666"),
      0n,
      "b".repeat(64),
      "client-seed",
      1,
      new Date(now.getTime() + 5000),
      now,
    );
    const useCase = new VerifyRoundUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
    );
    await expect(useCase.execute(round.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  test("returns verify view with matches=true and previousServerSeed lookup", async () => {
    const serverSeed = "c".repeat(64);
    const clientSeed = "client-seed";
    const round = buildSettledRound(serverSeed, clientSeed, 3n);
    const previousSeed = "d".repeat(64);
    const useCase = new VerifyRoundUseCase(
      new FakeRoundRepo(round, previousSeed) as unknown as RoundRepository,
    );

    const result = await useCase.execute(round.id);
    expect(result.matches).toBe(true);
    expect(result.recomputedCrashPoint).toBe(result.crashPoint);
    expect(result.serverSeed).toBe(serverSeed);
    expect(result.previousServerSeed).toBe(previousSeed);
    expect(result.nonce).toBe("3");
    expect(result.formulaVersion).toBe(1);
  });

  test("nonce 0 returns previousServerSeed=null without querying", async () => {
    const round = buildSettledRound("e".repeat(64), "client-seed", 0n);
    const useCase = new VerifyRoundUseCase(
      new FakeRoundRepo(round, "should-not-be-returned") as unknown as RoundRepository,
    );

    const result = await useCase.execute(round.id);
    expect(result.previousServerSeed).toBeNull();
  });
});
