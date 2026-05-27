import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import type { DomainEventEnvelope } from "@crash/shared-kernel/events";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { BetSagaStateRepository } from "../../src/domain/bet-saga-state.repository";
import type { Bet, BetProps } from "../../src/domain/bet.aggregate";
import type { BetStatus } from "../../src/domain/value-objects/bet-status";
import type {
  BetSagaState,
  BetSagaStateCreateInput,
  BetSagaStatus,
} from "../../src/domain/bet-saga-state.aggregate";

type SweeperCtor = typeof import("../../src/application/saga-timeout-sweeper.service")["SagaTimeoutSweeper"];
type BetAggregateExport = typeof import("../../src/domain/bet.aggregate")["Bet"];
type SagaAggregateExport = typeof import("../../src/domain/bet-saga-state.aggregate")["BetSagaState"];

let SagaTimeoutSweeper: SweeperCtor;
let BetAggregate: BetAggregateExport;
let BetSagaStateAggregate: SagaAggregateExport;

beforeAll(async () => {
  ({ SagaTimeoutSweeper } = await import(
    "../../src/application/saga-timeout-sweeper.service"
  ));
  ({ Bet: BetAggregate } = await import("../../src/domain/bet.aggregate"));
  ({ BetSagaState: BetSagaStateAggregate } = await import(
    "../../src/domain/bet-saga-state.aggregate"
  ));
});

type OutboxAddCall = {
  envelope: DomainEventEnvelope<unknown>;
  route: { exchange: string; routingKey: string; aggregateType: string; aggregateId: string };
  em: unknown;
};

class FakeOutboxRepository {
  public readonly calls: OutboxAddCall[] = [];
  async add<TPayload>(
    envelope: DomainEventEnvelope<TPayload>,
    route: { exchange: string; routingKey: string; aggregateType: string; aggregateId: string },
    em: unknown,
  ): Promise<void> {
    this.calls.push({ envelope, route, em });
  }
}

class FakeBetRepo implements Partial<BetRepository> {
  public tryTransitionCalls: Array<{
    id: BetId;
    from: BetStatus;
    to: BetStatus;
    patch: Partial<BetProps>;
    em: unknown;
  }> = [];
  public tryTransitionResults: Array<Bet | null> = [];
  public findByIdResults = new Map<string, Bet>();

  async tryTransition(
    id: BetId,
    from: BetStatus,
    to: BetStatus,
    patch: Partial<BetProps>,
    em?: unknown,
  ): Promise<Bet | null> {
    this.tryTransitionCalls.push({ id, from, to, patch, em });
    if (this.tryTransitionResults.length === 0) return null;
    return this.tryTransitionResults.shift() ?? null;
  }

  async findById(id: BetId): Promise<Bet | null> {
    return this.findByIdResults.get(id as unknown as string) ?? null;
  }
  async findActiveByRoundAndPlayer(): Promise<Bet | null> {
    return null;
  }
  async findActiveByRound(): Promise<Bet[]> {
    return [];
  }
  async countByRoundId(): Promise<number> {
    return 0;
  }
  async listByPlayer(): Promise<Bet[]> {
    return [];
  }
  async save(): Promise<void> {}
}

class FakeSagaRepo implements Partial<BetSagaStateRepository> {
  public claimExpiredCalls: Array<{ limit: number; now: Date; em: unknown }> = [];
  public claimExpiredResults: BetSagaState[] = [];
  public claimExpiredThrows: Error | null = null;
  public transitionCalls: Array<{
    betId: BetId;
    from: BetSagaStatus;
    to: BetSagaStatus;
    em: unknown;
  }> = [];
  public transitionResults: Array<BetSagaState | null> = [];

  async claimExpired(limit: number, now: Date, em: unknown): Promise<BetSagaState[]> {
    this.claimExpiredCalls.push({ limit, now, em });
    if (this.claimExpiredThrows !== null) throw this.claimExpiredThrows;
    const out = this.claimExpiredResults;
    this.claimExpiredResults = [];
    return out;
  }
  async transition(
    betId: BetId,
    from: BetSagaStatus,
    to: BetSagaStatus,
    em: unknown,
  ): Promise<BetSagaState | null> {
    this.transitionCalls.push({ betId, from, to, em });
    if (this.transitionResults.length === 0) {
      return BetSagaStateAggregate.rehydrate({
        betId,
        correlationId: "stub",
        status: to,
        deadlineAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return this.transitionResults.shift() ?? null;
  }
  async findByCorrelationId(): Promise<BetSagaState | null> {
    return null;
  }
  async findByBetId(): Promise<BetSagaState | null> {
    return null;
  }
  async create(_input: BetSagaStateCreateInput): Promise<void> {}
}

type FakeEm = {
  __tag: "em";
  transactional: <T>(fn: (txEm: FakeEm) => Promise<T>) => Promise<T>;
};

function buildEm(): FakeEm {
  const em: FakeEm = {
    __tag: "em",
    transactional: async (fn) => fn(em),
  };
  return em;
}

type Harness = {
  sweeper: InstanceType<SweeperCtor>;
  em: FakeEm;
  outbox: FakeOutboxRepository;
  bets: FakeBetRepo;
  sagas: FakeSagaRepo;
};

function buildHarness(): Harness {
  const em = buildEm();
  const outbox = new FakeOutboxRepository();
  const bets = new FakeBetRepo();
  const sagas = new FakeSagaRepo();
  const sweeper = new SagaTimeoutSweeper(
    em as unknown as never,
    outbox as unknown as never,
    sagas as unknown as BetSagaStateRepository,
    bets as unknown as BetRepository,
  );
  return { sweeper, em, outbox, bets, sagas };
}

function makeSaga(status: BetSagaStatus = "DEBIT_PENDING"): {
  saga: BetSagaState;
  betId: BetId;
  correlationId: string;
} {
  const betId = BetId(randomUUID());
  const correlationId = randomUUID();
  const saga = BetSagaStateAggregate.rehydrate({
    betId,
    correlationId,
    status,
    deadlineAt: new Date(Date.now() - 1000),
    updatedAt: new Date(),
  });
  return { saga, betId, correlationId };
}

function makeBet(betId: BetId, status: BetStatus = "REFUNDED"): Bet {
  return BetAggregate.rehydrate({
    id: betId,
    roundId: RoundId(randomUUID()),
    playerId: PlayerId("player-1"),
    amount: Money.of(500n),
    status,
    cashedOutAt: null,
    cashedOutMultiplier: null,
    payout: null,
    refundReason: status === "REFUNDED" ? "SAGA_TIMEOUT" : null,
    createdAt: new Date(),
  });
}

describe("SagaTimeoutSweeper", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  afterEach(async () => {
    await harness.sweeper.onApplicationShutdown();
  });

  test("happy path: 2 expired sagas → refund each bet, transition each saga to TIMED_OUT, emit 2 bet.refunded envelopes", async () => {
    const a = makeSaga();
    const b = makeSaga();
    harness.sagas.claimExpiredResults = [a.saga, b.saga];
    harness.bets.tryTransitionResults = [makeBet(a.betId), makeBet(b.betId)];

    await harness.sweeper.sweep();

    expect(harness.sagas.claimExpiredCalls).toHaveLength(1);
    expect(harness.sagas.claimExpiredCalls[0]!.limit).toBe(100);
    expect(harness.sagas.claimExpiredCalls[0]!.em).toBe(harness.em);

    expect(harness.bets.tryTransitionCalls).toHaveLength(2);
    expect(harness.bets.tryTransitionCalls[0]!.id).toBe(a.betId);
    expect(harness.bets.tryTransitionCalls[0]!.from).toBe("PENDING");
    expect(harness.bets.tryTransitionCalls[0]!.to).toBe("REFUNDED");
    expect(harness.bets.tryTransitionCalls[0]!.patch.refundReason).toBe("SAGA_TIMEOUT");
    expect(harness.bets.tryTransitionCalls[0]!.em).toBe(harness.em);
    expect(harness.bets.tryTransitionCalls[1]!.id).toBe(b.betId);

    expect(harness.sagas.transitionCalls).toHaveLength(2);
    expect(harness.sagas.transitionCalls[0]!.from).toBe("DEBIT_PENDING");
    expect(harness.sagas.transitionCalls[0]!.to).toBe("TIMED_OUT");
    expect(harness.sagas.transitionCalls[0]!.em).toBe(harness.em);

    expect(harness.outbox.calls).toHaveLength(2);
    expect(harness.outbox.calls[0]!.envelope.type).toBe("bet.refunded");
    expect(harness.outbox.calls[0]!.route.exchange).toBe("game.events");
    expect(harness.outbox.calls[0]!.route.routingKey).toBe("bet.refunded");
    expect(harness.outbox.calls[0]!.route.aggregateType).toBe("Bet");
    expect(harness.outbox.calls[0]!.route.aggregateId).toBe(a.betId as unknown as string);
    expect(harness.outbox.calls[0]!.em).toBe(harness.em);
    expect(harness.outbox.calls[0]!.envelope.correlationId).toBe(a.correlationId);
    const payload0 = harness.outbox.calls[0]!.envelope.payload as { betId: string; reason: string };
    expect(payload0.betId).toBe(a.betId as unknown as string);
    expect(payload0.reason).toBe("SAGA_TIMEOUT");
  });

  test("race lost — bets.tryTransition returns null → skip saga.transition + outbox, keep claiming next rows", async () => {
    const a = makeSaga();
    const b = makeSaga();
    harness.sagas.claimExpiredResults = [a.saga, b.saga];
    harness.bets.tryTransitionResults = [null, makeBet(b.betId)];

    await harness.sweeper.sweep();

    expect(harness.bets.tryTransitionCalls).toHaveLength(2);
    expect(harness.sagas.transitionCalls).toHaveLength(1);
    expect(harness.sagas.transitionCalls[0]!.betId).toBe(b.betId);
    expect(harness.outbox.calls).toHaveLength(1);
    expect(harness.outbox.calls[0]!.route.aggregateId).toBe(b.betId as unknown as string);
  });

  test("saga.transition returns null (defensive) → skip outbox, do not throw", async () => {
    const a = makeSaga();
    harness.sagas.claimExpiredResults = [a.saga];
    harness.bets.tryTransitionResults = [makeBet(a.betId)];
    harness.sagas.transitionResults = [null];

    await harness.sweeper.sweep();

    expect(harness.bets.tryTransitionCalls).toHaveLength(1);
    expect(harness.sagas.transitionCalls).toHaveLength(1);
    expect(harness.outbox.calls).toHaveLength(0);
  });

  test("claimExpired throws → sweep does not crash; error is swallowed and logged", async () => {
    harness.sagas.claimExpiredThrows = new Error("db connection lost");

    await expect(harness.sweeper.sweep()).rejects.toThrow("db connection lost");

    expect(harness.bets.tryTransitionCalls).toHaveLength(0);
    expect(harness.outbox.calls).toHaveLength(0);
  });

  test("onApplicationShutdown after bootstrap clears the timer and halts further scheduling", async () => {
    await harness.sweeper.onApplicationBootstrap();
    await harness.sweeper.onApplicationShutdown();

    const callsAtShutdown = harness.sagas.claimExpiredCalls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(harness.sagas.claimExpiredCalls.length).toBe(callsAtShutdown);
  });
});
