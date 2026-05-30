import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import type { DomainEventEnvelope } from "@crash/shared-kernel/events";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { BetSagaStateRepository } from "../../src/domain/bet-saga-state.repository";
import type { Round } from "../../src/domain/round.aggregate";
import type { Bet, BetProps } from "../../src/domain/bet.aggregate";
import type { BetStatus } from "../../src/domain/value-objects/bet-status";
import type {
  BetSagaState,
  BetSagaStateCreateInput,
} from "../../src/domain/bet-saga-state.aggregate";

type UseCaseCtor = typeof import("../../src/application/use-cases/place-bet.use-case")["PlaceBetUseCase"];
type RoundAggregateExport = typeof import("../../src/domain/round.aggregate")["Round"];

let PlaceBetUseCase: UseCaseCtor;
let RoundAggregate: RoundAggregateExport;

beforeAll(async () => {
  ({ PlaceBetUseCase } = await import(
    "../../src/application/use-cases/place-bet.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
});

class FakeOutboxRepository {
  async add<TPayload>(
    _envelope: DomainEventEnvelope<TPayload>,
    _route: { exchange: string; routingKey: string; aggregateType: string; aggregateId: string },
    _em: unknown,
  ): Promise<void> {}
}

class StubEntityManager {
  async transactional<T>(cb: (em: this) => Promise<T>): Promise<T> {
    return cb(this);
  }
}

class FakeRoundRepo implements Partial<RoundRepository> {
  constructor(private readonly open: Round | null) {}
  async findOpen(): Promise<Round | null> {
    return this.open;
  }
}

class FakeBetRepo implements Partial<BetRepository> {
  public readonly saveCalls: Array<{ bet: Bet }> = [];

  async findActiveByRoundAndPlayer(): Promise<Bet | null> {
    return null;
  }

  async save(bet: Bet): Promise<void> {
    this.saveCalls.push({ bet });
  }

  async findById(): Promise<Bet | null> {
    return null;
  }
  async findActiveByRound(): Promise<Bet[]> {
    return [];
  }
  async findByRound(): Promise<Bet[]> {
    return [];
  }
  async countByRoundId(): Promise<number> {
    return 0;
  }
  async listByPlayer(): Promise<Bet[]> {
    return [];
  }
  async findAutoCashoutCandidates(): Promise<Bet[]> {
    return [];
  }
  async tryTransition(
    _id: BetId,
    _from: BetStatus,
    _to: BetStatus,
    _patch: Partial<BetProps>,
  ): Promise<Bet | null> {
    return null;
  }
}

class FakeBetSagaRepo implements Partial<BetSagaStateRepository> {
  async create(_input: BetSagaStateCreateInput, _txEm: unknown): Promise<void> {}
  async findByCorrelationId(): Promise<BetSagaState | null> {
    return null;
  }
  async findByBetId(): Promise<BetSagaState | null> {
    return null;
  }
  async transition(): Promise<BetSagaState | null> {
    return null;
  }
  async claimExpired(): Promise<BetSagaState[]> {
    return [];
  }
}

function buildBettingRound(now: Date): Round {
  return RoundAggregate.schedule(
    RoundId(randomUUID()),
    0n,
    "a".repeat(64),
    "client-seed-hex",
    1,
    new Date(now.getTime() + 5000),
    now,
  );
}

function buildHarness(open: Round): {
  useCase: InstanceType<UseCaseCtor>;
  bets: FakeBetRepo;
} {
  const em = new StubEntityManager();
  const outbox = new FakeOutboxRepository();
  const bets = new FakeBetRepo();
  const sagas = new FakeBetSagaRepo();
  const rounds = new FakeRoundRepo(open);
  const useCase = new PlaceBetUseCase(
    em as unknown as never,
    outbox as unknown as never,
    rounds as unknown as RoundRepository,
    bets as unknown as BetRepository,
    sagas as unknown as BetSagaStateRepository,
  );
  return { useCase, bets };
}

describe("PlaceBetUseCase — autoCashoutTarget centi-X conversion (Phase 9 Plan 02)", () => {
  test("input without autoCashoutTarget → saved Bet has null target", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const h = buildHarness(buildBettingRound(now));
    await h.useCase.execute({
      playerId: PlayerId("player-1"),
      amount: Money.of(1000n),
      now,
    });
    expect(h.bets.saveCalls[0]!.bet.autoCashoutTarget).toBeNull();
  });

  test("input autoCashoutTarget = 2.0 → saved Bet target.toCentiX() === 200", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const h = buildHarness(buildBettingRound(now));
    await h.useCase.execute({
      playerId: PlayerId("player-1"),
      amount: Money.of(1000n),
      now,
      autoCashoutTarget: 2.0,
    });
    const bet = h.bets.saveCalls[0]!.bet;
    expect(bet.autoCashoutTarget).not.toBeNull();
    expect(bet.autoCashoutTarget!.toCentiX()).toBe(200);
  });

  test("input autoCashoutTarget = 1.01 → saved Bet target.toCentiX() === 101 (floor)", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const h = buildHarness(buildBettingRound(now));
    await h.useCase.execute({
      playerId: PlayerId("player-1"),
      amount: Money.of(1000n),
      now,
      autoCashoutTarget: 1.01,
    });
    expect(h.bets.saveCalls[0]!.bet.autoCashoutTarget!.toCentiX()).toBe(101);
  });

  test("input autoCashoutTarget = 3.14 → centiX rounds to 314", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const h = buildHarness(buildBettingRound(now));
    await h.useCase.execute({
      playerId: PlayerId("player-1"),
      amount: Money.of(1000n),
      now,
      autoCashoutTarget: 3.14,
    });
    expect(h.bets.saveCalls[0]!.bet.autoCashoutTarget!.toCentiX()).toBe(314);
  });
});
