import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { Money } from "@crash/shared-kernel";
import { PlayerId, BetId, RoundId } from "@crash/shared-kernel/identity";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { Round } from "../../src/domain/round.aggregate";
import type { Bet } from "../../src/domain/bet.aggregate";
import { roundSnapshotPayloadSchema } from "../../src/presentation/dtos/ws-event.payloads";

type AnyArgs = unknown[];

type UseCaseCtor = typeof import("../../src/application/use-cases/get-ws-snapshot.use-case")["GetWsSnapshotUseCase"];

let GetWsSnapshotUseCase: UseCaseCtor;
let RoundAggregate: typeof import("../../src/domain/round.aggregate")["Round"];
let BetAggregate: typeof import("../../src/domain/bet.aggregate")["Bet"];

beforeAll(async () => {
  ({ GetWsSnapshotUseCase } = await import(
    "../../src/application/use-cases/get-ws-snapshot.use-case"
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
  constructor(
    private readonly active: Bet[],
    private readonly playerBet: Bet | null = null,
  ) {}
  async findActiveByRound(): Promise<Bet[]> {
    return this.active;
  }
  async findActiveByRoundAndPlayer(): Promise<Bet | null> {
    return this.playerBet;
  }
  async countByRoundId(): Promise<number> {
    return this.active.length;
  }
  async findById(): Promise<Bet | null> {
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

const fixedClock = (at: Date) => ({ now: () => at });

describe("GetWsSnapshotUseCase", () => {
  test("snapshot during BETTING with no bets", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const round = buildBettingRound(now);
    const useCase = new GetWsSnapshotUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
      new FakeBetRepo([]) as unknown as BetRepository,
      fixedClock(now),
    );

    const snapshot = await useCase.execute(null);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.round.status).toBe("BETTING");
    expect(snapshot!.round.startedAt).toBeNull();
    expect(snapshot!.activeBets).toEqual([]);
    expect(snapshot!.myBet).toBeNull();
    expect(snapshot!.serverTime).toBe(now.getTime());
    expect(() => roundSnapshotPayloadSchema.parse(snapshot)).not.toThrow();
  });

  test("snapshot during RUNNING with two active bets, one belonging to caller", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const running = buildBettingRound(now).start(now);
    const callerId = PlayerId("player-alice");
    const otherId = PlayerId("player-bob");

    const callerBet = BetAggregate.place(
      BetId("22222222-2222-2222-2222-222222222222"),
      running.id,
      callerId,
      Money.of(500n),
      now,
    ).confirm();
    const otherBet = BetAggregate.place(
      BetId("33333333-3333-3333-3333-333333333333"),
      running.id,
      otherId,
      Money.of(1000n),
      now,
    ).confirm();

    const useCase = new GetWsSnapshotUseCase(
      new FakeRoundRepo(running) as unknown as RoundRepository,
      new FakeBetRepo([callerBet, otherBet], callerBet) as unknown as BetRepository,
      fixedClock(now),
    );

    const snapshot = await useCase.execute(callerId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.round.status).toBe("RUNNING");
    expect(snapshot!.round.startedAt).not.toBeNull();
    expect(snapshot!.activeBets).toHaveLength(2);
    expect(snapshot!.activeBets[0]!.playerIdMasked).toMatch(/^[0-9a-f]{8}$/);
    expect(snapshot!.activeBets[0]!.playerIdMasked).not.toContain("player");
    expect(snapshot!.myBet).not.toBeNull();
    expect(snapshot!.myBet!.status).toBe("ACTIVE");
    expect(snapshot!.myBet!.amount.amount).toBe("500");
    expect(() => roundSnapshotPayloadSchema.parse(snapshot)).not.toThrow();
  });

  test("snapshot with playerId=null returns myBet=null", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const round = buildBettingRound(now);
    const useCase = new GetWsSnapshotUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
      new FakeBetRepo([]) as unknown as BetRepository,
      fixedClock(now),
    );

    const snapshot = await useCase.execute(null);
    expect(snapshot!.myBet).toBeNull();
  });

  test("playerId masking is consistent across calls", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const round = buildBettingRound(now);
    const playerId = PlayerId("player-alice");
    const bet = BetAggregate.place(
      BetId("44444444-4444-4444-4444-444444444444"),
      round.id,
      playerId,
      Money.of(500n),
      now,
    );

    const useCase = new GetWsSnapshotUseCase(
      new FakeRoundRepo(round) as unknown as RoundRepository,
      new FakeBetRepo([bet]) as unknown as BetRepository,
      fixedClock(now),
    );

    const first = await useCase.execute(null);
    const second = await useCase.execute(null);
    expect(first!.activeBets[0]!.playerIdMasked).toBe(
      second!.activeBets[0]!.playerIdMasked,
    );
    expect(first!.activeBets[0]!.playerIdMasked).toMatch(/^[0-9a-f]{8}$/);
  });

  test("returns null when no open round", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const useCase = new GetWsSnapshotUseCase(
      new FakeRoundRepo(null) as unknown as RoundRepository,
      new FakeBetRepo([]) as unknown as BetRepository,
      fixedClock(now),
    );
    const snapshot = await useCase.execute(null);
    expect(snapshot).toBeNull();
  });
});
