import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import { Money } from "@crash/shared-kernel";
import { BetId, PlayerId, RoundId } from "@crash/shared-kernel/identity";
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
  BetSagaStatus,
} from "../../src/domain/bet-saga-state.aggregate";

type UseCaseCtor = typeof import("../../src/application/use-cases/place-bet.use-case")["PlaceBetUseCase"];
type RoundAggregateExport = typeof import("../../src/domain/round.aggregate")["Round"];
type BetAggregateExport = typeof import("../../src/domain/bet.aggregate")["Bet"];

let PlaceBetUseCase: UseCaseCtor;
let RoundAggregate: RoundAggregateExport;
let BetAggregate: BetAggregateExport;
let RoundNotInBettingPhaseError: typeof import("../../src/domain/errors")["RoundNotInBettingPhaseError"];
let BetAlreadyActiveError: typeof import("../../src/domain/errors")["BetAlreadyActiveError"];

beforeAll(async () => {
  ({ PlaceBetUseCase } = await import(
    "../../src/application/use-cases/place-bet.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
  ({ Bet: BetAggregate } = await import("../../src/domain/bet.aggregate"));
  const errors = await import("../../src/domain/errors");
  RoundNotInBettingPhaseError = errors.RoundNotInBettingPhaseError;
  BetAlreadyActiveError = errors.BetAlreadyActiveError;
});

type AddCall = {
  envelope: DomainEventEnvelope<unknown>;
  route: { exchange: string; routingKey: string; aggregateType: string; aggregateId: string };
  em: unknown;
};

class FakeOutboxRepository {
  public readonly calls: AddCall[] = [];
  async add<TPayload>(
    envelope: DomainEventEnvelope<TPayload>,
    route: { exchange: string; routingKey: string; aggregateType: string; aggregateId: string },
    em: unknown,
  ): Promise<void> {
    this.calls.push({ envelope, route, em });
  }
}

class StubEntityManager {
  public transactionalCalls = 0;
  async transactional<T>(cb: (em: this) => Promise<T>): Promise<T> {
    this.transactionalCalls += 1;
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
  public readonly saveCalls: Array<{ bet: Bet; em: unknown; order: number }> = [];
  public existingActive: Bet | null = null;
  private orderCursor: () => number;

  constructor(orderCursor: () => number) {
    this.orderCursor = orderCursor;
  }

  async findActiveByRoundAndPlayer(): Promise<Bet | null> {
    return this.existingActive;
  }

  async save(bet: Bet, txEm?: unknown): Promise<void> {
    this.saveCalls.push({ bet, em: txEm, order: this.orderCursor() });
  }

  async findById(): Promise<Bet | null> {
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
  public readonly createCalls: Array<{
    input: BetSagaStateCreateInput;
    em: unknown;
    order: number;
  }> = [];
  private orderCursor: () => number;

  constructor(orderCursor: () => number) {
    this.orderCursor = orderCursor;
  }

  async create(input: BetSagaStateCreateInput, txEm: unknown): Promise<void> {
    this.createCalls.push({ input, em: txEm, order: this.orderCursor() });
  }

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

function buildRunningRound(now: Date): Round {
  return buildBettingRound(now).start(now);
}

type Harness = {
  useCase: InstanceType<UseCaseCtor>;
  em: StubEntityManager;
  outbox: FakeOutboxRepository;
  bets: FakeBetRepo;
  sagas: FakeBetSagaRepo;
  orderState: { value: number };
};

function buildHarness(open: Round | null): Harness {
  const em = new StubEntityManager();
  const outbox = new FakeOutboxRepository();
  const orderState = { value: 0 };
  const nextOrder = (): number => {
    orderState.value += 1;
    return orderState.value;
  };
  const bets = new FakeBetRepo(nextOrder);
  const sagas = new FakeBetSagaRepo(nextOrder);
  const rounds = new FakeRoundRepo(open);

  // Patch outbox.add to also record the order increment so callers can verify ordering.
  const originalAdd = outbox.add.bind(outbox);
  outbox.add = async (envelope, route, txEm) => {
    (envelope as unknown as { __order?: number }).__order = nextOrder();
    await originalAdd(envelope, route, txEm);
  };

  const useCase = new PlaceBetUseCase(
    em as unknown as never,
    outbox as unknown as never,
    rounds as unknown as RoundRepository,
    bets as unknown as BetRepository,
    sagas as unknown as BetSagaStateRepository,
  );

  return { useCase, em, outbox, bets, sagas, orderState };
}

describe("PlaceBetUseCase", () => {
  test("happy path — returns betId + PENDING and writes bet, saga, outbox under one TX", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const round = buildBettingRound(now);
    const h = buildHarness(round);

    const playerId = PlayerId("player-1");
    const amount = Money.of(500n);

    const result = await h.useCase.execute({ playerId, amount, now });

    expect(result.status).toBe("PENDING");
    expect(typeof result.betId).toBe("string");

    expect(h.em.transactionalCalls).toBe(1);
    expect(h.bets.saveCalls).toHaveLength(1);
    expect(h.sagas.createCalls).toHaveLength(1);
    expect(h.outbox.calls).toHaveLength(1);

    const savedBet = h.bets.saveCalls[0]!.bet;
    expect(savedBet.status).toBe("PENDING");
    expect(savedBet.roundId).toBe(round.id);
    expect(savedBet.playerId).toBe(playerId);
    expect(savedBet.amount.toCents()).toBe(500n);
    expect(savedBet.id).toBe(result.betId);

    const sagaInput = h.sagas.createCalls[0]!.input;
    expect(sagaInput.betId).toBe(result.betId);
    expect(sagaInput.deadlineAt.getTime()).toBe(now.getTime() + 5000);
    expect(typeof sagaInput.correlationId).toBe("string");
    expect(sagaInput.correlationId.length).toBeGreaterThan(0);
    expect(sagaInput.correlationId).not.toBe(result.betId as unknown as string);

    const envelope = h.outbox.calls[0]!.envelope;
    expect(envelope.type).toBe("wallet.debit");
    expect(envelope.correlationId).toBe(sagaInput.correlationId);
    const payload = envelope.payload as { playerId: string; amount: { amount: string } };
    expect(payload.playerId).toBe(playerId as unknown as string);
    expect(payload.amount.amount).toBe("500");

    const route = h.outbox.calls[0]!.route;
    expect(route.exchange).toBe("wallet.commands");
    expect(route.routingKey).toBe("wallet.debit");
    expect(route.aggregateType).toBe("Bet");
    expect(route.aggregateId).toBe(result.betId as unknown as string);
  });

  test("no open round → throws RoundNotInBettingPhaseError with actual=NO_OPEN_ROUND", async () => {
    const h = buildHarness(null);
    const now = new Date();
    let caught: unknown = null;
    try {
      await h.useCase.execute({ playerId: PlayerId("p"), amount: Money.of(500n), now });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RoundNotInBettingPhaseError);
    expect((caught as InstanceType<typeof RoundNotInBettingPhaseError>).actual).toBe(
      "NO_OPEN_ROUND",
    );
    expect(h.bets.saveCalls).toHaveLength(0);
    expect(h.sagas.createCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("open round in RUNNING → Round.acceptBet throws RoundNotInBettingPhaseError(RUNNING)", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const running = buildRunningRound(now);
    const h = buildHarness(running);

    let caught: unknown = null;
    try {
      await h.useCase.execute({ playerId: PlayerId("p"), amount: Money.of(500n), now });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RoundNotInBettingPhaseError);
    expect((caught as InstanceType<typeof RoundNotInBettingPhaseError>).actual).toBe("RUNNING");
    expect(h.bets.saveCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("player already has active bet → BetAlreadyActiveError carries existingBetId", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const round = buildBettingRound(now);
    const h = buildHarness(round);

    const existingId = BetId(randomUUID());
    const existingBet = BetAggregate.place(
      existingId,
      round.id,
      PlayerId("player-1"),
      Money.of(500n),
      now,
    );
    h.bets.existingActive = existingBet;

    let caught: unknown = null;
    try {
      await h.useCase.execute({
        playerId: PlayerId("player-1"),
        amount: Money.of(500n),
        now,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BetAlreadyActiveError);
    expect((caught as InstanceType<typeof BetAlreadyActiveError>).existingBetId).toBe(existingId);
    expect(h.bets.saveCalls).toHaveLength(0);
    expect(h.sagas.createCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("write order inside the transactional callback: bet → saga → outbox, all with same txEm", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const round = buildBettingRound(now);
    const h = buildHarness(round);

    await h.useCase.execute({
      playerId: PlayerId("player-1"),
      amount: Money.of(500n),
      now,
    });

    expect(h.em.transactionalCalls).toBe(1);
    const betOrder = h.bets.saveCalls[0]!.order;
    const sagaOrder = h.sagas.createCalls[0]!.order;
    const outboxEnvelope = h.outbox.calls[0]!.envelope as unknown as { __order: number };
    expect(betOrder).toBeLessThan(sagaOrder);
    expect(sagaOrder).toBeLessThan(outboxEnvelope.__order);

    expect(h.bets.saveCalls[0]!.em).toBe(h.em);
    expect(h.sagas.createCalls[0]!.em).toBe(h.em);
    expect(h.outbox.calls[0]!.em).toBe(h.em);
  });

  test("correlationId is a UUID distinct from betId", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const round = buildBettingRound(now);
    const h = buildHarness(round);

    const result = await h.useCase.execute({
      playerId: PlayerId("player-1"),
      amount: Money.of(500n),
      now,
    });

    const corr = h.sagas.createCalls[0]!.input.correlationId;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(corr).toMatch(uuidRegex);
    expect(result.betId as unknown as string).toMatch(uuidRegex);
    expect(corr).not.toBe(result.betId as unknown as string);
  });
});
