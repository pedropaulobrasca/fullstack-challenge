import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Money } from "@crash/shared-kernel";
import { BetId, PlayerId, RoundId } from "@crash/shared-kernel/identity";
import { deriveCrashPoint } from "@crash/contracts";
import { env } from "../../src/config/defaults";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { Round } from "../../src/domain/round.aggregate";
import type { Bet } from "../../src/domain/bet.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";
import { Multiplier } from "../../src/domain/value-objects/multiplier";

type AnyArgs = unknown[];

type UseCaseCtor = typeof import("../../src/application/use-cases/verify-round.use-case")["VerifyRoundUseCase"];

let VerifyRoundUseCase: UseCaseCtor;
let RoundAggregate: typeof import("../../src/domain/round.aggregate")["Round"];
let BetAggregate: typeof import("../../src/domain/bet.aggregate")["Bet"];

beforeAll(async () => {
  ({ VerifyRoundUseCase } = await import(
    "../../src/application/use-cases/verify-round.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
  ({ Bet: BetAggregate } = await import("../../src/domain/bet.aggregate"));
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

class FakeBetRepo implements Partial<BetRepository> {
  constructor(private readonly bets: Bet[] = []) {}
  async findByRound(): Promise<Bet[]> {
    return this.bets;
  }
  async findActiveByRound(): Promise<Bet[]> {
    return this.bets;
  }
  async countByRoundId(): Promise<number> {
    return this.bets.length;
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

function buildBet(
  betIdRaw: string,
  roundId: ReturnType<typeof RoundId>,
  playerIdRaw: string,
  amountCents: bigint,
  status: "CASHED_OUT" | "LOST" | "REFUNDED",
): Bet {
  const now = new Date("2026-01-01T00:00:00Z");
  const placed = BetAggregate.place(
    BetId(betIdRaw),
    roundId,
    PlayerId(playerIdRaw),
    Money.of(amountCents),
    now,
  );
  if (status === "REFUNDED") {
    return placed.refund("test-refund");
  }
  const active = placed.confirm();
  if (status === "LOST") {
    return active.lose();
  }
  return active.cashOut(Multiplier.fromTenThousandths(15_000n), now).next;
}

describe("VerifyRoundUseCase (REQ-FAIR-02 gate)", () => {
  test("throws NotFoundException when round does not exist", async () => {
    const useCase = new VerifyRoundUseCase(
      new FakeRoundRepo(null) as unknown as RoundRepository,
      new FakeBetRepo() as unknown as BetRepository,
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
      new FakeBetRepo() as unknown as BetRepository,
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
      new FakeBetRepo() as unknown as BetRepository,
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
      new FakeBetRepo() as unknown as BetRepository,
    );

    const result = await useCase.execute(round.id);
    expect(result.previousServerSeed).toBeNull();
  });

  test(
    "Phase 4 locked-byte oracle: serverSeed=0...01, clientSeed=test, nonce=0 -> 2.94 with matches=true",
    async () => {
      const serverSeed =
        "0000000000000000000000000000000000000000000000000000000000000001";
      const clientSeed = "test";
      const round = buildSettledRound(serverSeed, clientSeed, 0n);
      const useCase = new VerifyRoundUseCase(
        new FakeRoundRepo(round) as unknown as RoundRepository,
        new FakeBetRepo() as unknown as BetRepository,
      );

      const result = await useCase.execute(round.id);
      expect(result.crashPoint).toBe(2.94);
      expect(result.recomputedCrashPoint).toBe(2.94);
      expect(result.matches).toBe(true);
    },
  );

  test(
    "bets[] mirrors findByRound output with mixed statuses, masked playerIds and money snapshots",
    async () => {
      const round = buildSettledRound("c".repeat(64), "client-seed", 7n);
      const playerAlice = "player-alice";
      const playerBob = "player-bob";
      const playerCarol = "player-carol";
      const bets = [
        buildBet(
          "11111111-1111-1111-1111-111111111111",
          round.id,
          playerAlice,
          500n,
          "CASHED_OUT",
        ),
        buildBet(
          "22222222-2222-2222-2222-222222222222",
          round.id,
          playerBob,
          1_000n,
          "LOST",
        ),
        buildBet(
          "33333333-3333-3333-3333-333333333333",
          round.id,
          playerCarol,
          250n,
          "REFUNDED",
        ),
      ];
      const useCase = new VerifyRoundUseCase(
        new FakeRoundRepo(round) as unknown as RoundRepository,
        new FakeBetRepo(bets) as unknown as BetRepository,
      );

      const result = await useCase.execute(round.id);
      expect(result.bets).toHaveLength(3);

      const statuses = result.bets.map((bet) => bet.status).sort();
      expect(statuses).toEqual(["CASHED_OUT", "LOST", "REFUNDED"]);

      const cashedOut = result.bets.find((bet) => bet.status === "CASHED_OUT")!;
      expect(cashedOut.playerIdMasked).toMatch(/^[0-9a-f]{8}$/);
      expect(cashedOut.playerIdMasked).not.toContain(playerAlice);
      expect(cashedOut.amount.amount).toBe("500");
      expect(cashedOut.amount.currency).toBe("CRD");
      expect(typeof cashedOut.amount.scale).toBe("number");
      expect(typeof cashedOut.amount).toBe("object");
      expect(cashedOut.cashedOutMultiplier).toBeCloseTo(1.5, 5);
      expect(cashedOut.payout).not.toBeNull();
      expect(cashedOut.payout!.amount).toBe("750");

      const lost = result.bets.find((bet) => bet.status === "LOST")!;
      expect(lost.playerIdMasked).not.toContain(playerBob);
      expect(lost.cashedOutMultiplier).toBeNull();
      expect(lost.payout).toBeNull();

      const refunded = result.bets.find((bet) => bet.status === "REFUNDED")!;
      expect(refunded.playerIdMasked).not.toContain(playerCarol);
      expect(refunded.amount.amount).toBe("250");
    },
  );

  test("growthRate equals env.GROWTH_RATE and is a positive number", async () => {
    const round = buildSettledRound("c".repeat(64), "client-seed", 1n);
    const useCase = new VerifyRoundUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
      new FakeBetRepo() as unknown as BetRepository,
    );

    const result = await useCase.execute(round.id);
    expect(result.growthRate).toBe(env.GROWTH_RATE);
    expect(typeof result.growthRate).toBe("number");
    expect(result.growthRate).toBeGreaterThan(0);
  });

  test("bet.status is the string enum, never a database integer", async () => {
    const round = buildSettledRound("c".repeat(64), "client-seed", 2n);
    const bet = buildBet(
      "44444444-4444-4444-4444-444444444444",
      round.id,
      "player-dave",
      300n,
      "LOST",
    );
    const useCase = new VerifyRoundUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
      new FakeBetRepo([bet]) as unknown as BetRepository,
    );

    const result = await useCase.execute(round.id);
    expect(result.bets).toHaveLength(1);
    const status = result.bets[0]!.status;
    expect(["PENDING", "ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"]).toContain(
      status,
    );
    expect(typeof status).toBe("string");
  });
});
