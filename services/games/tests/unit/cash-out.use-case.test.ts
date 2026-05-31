import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import { Money } from "@crash/shared-kernel";
import { BetId, PlayerId, RoundId } from "@crash/shared-kernel/identity";
import type { DomainEventEnvelope } from "@crash/shared-kernel/events";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { Round } from "../../src/domain/round.aggregate";
import type { Bet, BetProps } from "../../src/domain/bet.aggregate";
import type { BetStatus } from "../../src/domain/value-objects/bet-status";
import { Multiplier } from "../../src/domain/value-objects/multiplier";

type UseCaseCtor = typeof import("../../src/application/use-cases/cash-out.use-case")["CashOutUseCase"];
type RoundAggregateExport = typeof import("../../src/domain/round.aggregate")["Round"];
type BetAggregateExport = typeof import("../../src/domain/bet.aggregate")["Bet"];

let CashOutUseCase: UseCaseCtor;
let RoundAggregate: RoundAggregateExport;
let BetAggregate: BetAggregateExport;
let RoundNotRunningError: typeof import("../../src/domain/errors")["RoundNotRunningError"];
let NoActiveBetError: typeof import("../../src/domain/errors")["NoActiveBetError"];
let BetNotCashableError: typeof import("../../src/domain/errors")["BetNotCashableError"];

beforeAll(async () => {
  ({ CashOutUseCase } = await import(
    "../../src/application/use-cases/cash-out.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
  ({ Bet: BetAggregate } = await import("../../src/domain/bet.aggregate"));
  const errors = await import("../../src/domain/errors");
  RoundNotRunningError = errors.RoundNotRunningError;
  NoActiveBetError = errors.NoActiveBetError;
  BetNotCashableError = errors.BetNotCashableError;
});

type AddCall = {
  envelope: DomainEventEnvelope<unknown>;
  route: { exchange: string; routingKey: string; aggregateType: string; aggregateId: string };
  em: unknown;
  order: number;
};

class FakeOutboxRepository {
  public readonly calls: AddCall[] = [];
  private orderCursor: () => number;
  constructor(orderCursor: () => number) {
    this.orderCursor = orderCursor;
  }
  async add<TPayload>(
    envelope: DomainEventEnvelope<TPayload>,
    route: { exchange: string; routingKey: string; aggregateType: string; aggregateId: string },
    em: unknown,
  ): Promise<void> {
    this.calls.push({ envelope, route, em, order: this.orderCursor() });
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
  public existingActive: Bet | null = null;
  public transitionReturns: Bet | null | "passthrough" = "passthrough";
  public readonly transitionCalls: Array<{
    id: BetId;
    from: BetStatus;
    to: BetStatus;
    patch: Partial<BetProps>;
    em: unknown;
    order: number;
  }> = [];
  private orderCursor: () => number;

  constructor(orderCursor: () => number) {
    this.orderCursor = orderCursor;
  }

  async findActiveByRoundAndPlayer(): Promise<Bet | null> {
    return this.existingActive;
  }

  async tryTransition(
    id: BetId,
    from: BetStatus,
    to: BetStatus,
    patch: Partial<BetProps>,
    txEm?: unknown,
  ): Promise<Bet | null> {
    this.transitionCalls.push({ id, from, to, patch, em: txEm, order: this.orderCursor() });
    if (this.transitionReturns === "passthrough") {
      if (this.existingActive === null) return null;
      return BetAggregate.rehydrate({
        id: this.existingActive.id,
        roundId: this.existingActive.roundId,
        playerId: this.existingActive.playerId,
        amount: this.existingActive.amount,
        status: to,
        cashedOutAt: (patch.cashedOutAt as Date) ?? null,
        cashedOutMultiplier: (patch.cashedOutMultiplier as Multiplier) ?? null,
        payout: (patch.payout as Money) ?? null,
        refundReason: null,
        createdAt: this.existingActive.createdAt,
      });
    }
    return this.transitionReturns;
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
  async save(): Promise<void> {}
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

function buildActiveBet(roundId: ReturnType<typeof RoundAggregate.schedule>["id"], playerId: PlayerId, now: Date): Bet {
  return BetAggregate.rehydrate({
    id: BetId(randomUUID()),
    roundId,
    playerId,
    amount: Money.of(500n),
    status: "ACTIVE",
    cashedOutAt: null,
    cashedOutMultiplier: null,
    payout: null,
    refundReason: null,
    createdAt: now,
  });
}

type Harness = {
  useCase: InstanceType<UseCaseCtor>;
  em: StubEntityManager;
  outbox: FakeOutboxRepository;
  bets: FakeBetRepo;
};

function buildHarness(open: Round | null): Harness {
  const em = new StubEntityManager();
  const orderState = { value: 0 };
  const nextOrder = (): number => {
    orderState.value += 1;
    return orderState.value;
  };
  const outbox = new FakeOutboxRepository(nextOrder);
  const bets = new FakeBetRepo(nextOrder);
  const rounds = new FakeRoundRepo(open);

  const noopCounter = { inc: () => undefined };
  const useCase = new CashOutUseCase(
    em as unknown as never,
    outbox as unknown as never,
    rounds as unknown as RoundRepository,
    bets as unknown as BetRepository,
    noopCounter as unknown as never,
  );

  return { useCase, em, outbox, bets };
}

describe("CashOutUseCase", () => {
  test("happy path — transitions bet ACTIVE→CASHED_OUT and writes wallet.credit outbox under one TX", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const running = buildRunningRound(now);
    const h = buildHarness(running);

    const playerId = PlayerId("player-1");
    const active = buildActiveBet(running.id, playerId, now);
    h.bets.existingActive = active;

    const acceptedAt = new Date(now.getTime() + 1000);
    const multiplier = Multiplier.of(2);

    const result = await h.useCase.execute({ playerId, multiplier, acceptedAt });

    expect(h.em.transactionalCalls).toBe(1);
    expect(h.bets.transitionCalls).toHaveLength(1);
    expect(h.outbox.calls).toHaveLength(2);

    const tc = h.bets.transitionCalls[0]!;
    expect(tc.id).toBe(active.id);
    expect(tc.from).toBe("ACTIVE");
    expect(tc.to).toBe("CASHED_OUT");
    expect(tc.patch.cashedOutAt).toBe(acceptedAt);
    expect((tc.patch.cashedOutMultiplier as Multiplier).toNumber()).toBe(2);
    expect((tc.patch.payout as Money).toCents()).toBe(1000n);

    const envelope = h.outbox.calls[0]!.envelope;
    expect(envelope.type).toBe("wallet.credit");
    expect(typeof envelope.correlationId).toBe("string");
    expect(envelope.correlationId.length).toBeGreaterThan(0);
    const payload = envelope.payload as { playerId: string; amount: { amount: string } };
    expect(payload.playerId).toBe(playerId as unknown as string);
    expect(payload.amount.amount).toBe("1000");

    const route = h.outbox.calls[0]!.route;
    expect(route.exchange).toBe("wallet.commands");
    expect(route.routingKey).toBe("wallet.credit");
    expect(route.aggregateType).toBe("Bet");
    expect(route.aggregateId).toBe(active.id as unknown as string);

    const cashedEnvelope = h.outbox.calls[1]!.envelope;
    expect(cashedEnvelope.type).toBe("bet.cashed_out");
    expect(cashedEnvelope.correlationId).toBe(envelope.correlationId);
    const cashedPayload = cashedEnvelope.payload as {
      betId: string;
      playerId: string;
      roundId: string;
      amount: { amount: string };
      payout: { amount: string };
      multiplier: number;
      cashedOutAt: string;
    };
    expect(cashedPayload.betId).toBe(active.id as unknown as string);
    expect(cashedPayload.playerId).toBe(playerId as unknown as string);
    expect(cashedPayload.roundId).toBe(running.id as unknown as string);
    expect(cashedPayload.amount.amount).toBe("500");
    expect(cashedPayload.payout.amount).toBe("1000");
    expect(cashedPayload.multiplier).toBe(2);
    expect(cashedPayload.cashedOutAt).toBe(acceptedAt.toISOString());

    const cashedRoute = h.outbox.calls[1]!.route;
    expect(cashedRoute.exchange).toBe("game.events");
    expect(cashedRoute.routingKey).toBe("bet.cashed_out");
    expect(cashedRoute.aggregateType).toBe("Bet");
    expect(cashedRoute.aggregateId).toBe(active.id as unknown as string);

    expect(result.multiplier.toNumber()).toBe(2);
    expect(result.payout.toCents()).toBe(1000n);
  });

  test("no open round → throws RoundNotRunningError with actual=NO_OPEN_ROUND", async () => {
    const h = buildHarness(null);
    let caught: unknown = null;
    try {
      await h.useCase.execute({
        playerId: PlayerId("p"),
        multiplier: Multiplier.of(2),
        acceptedAt: new Date(),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RoundNotRunningError);
    expect((caught as InstanceType<typeof RoundNotRunningError>).actual).toBe(
      "NO_OPEN_ROUND",
    );
    expect(h.bets.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("round status BETTING → throws RoundNotRunningError(BETTING)", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const betting = buildBettingRound(now);
    const h = buildHarness(betting);

    let caught: unknown = null;
    try {
      await h.useCase.execute({
        playerId: PlayerId("p"),
        multiplier: Multiplier.of(2),
        acceptedAt: now,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RoundNotRunningError);
    expect((caught as InstanceType<typeof RoundNotRunningError>).actual).toBe("BETTING");
    expect(h.bets.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("no active bet → throws NoActiveBetError", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const running = buildRunningRound(now);
    const h = buildHarness(running);

    let caught: unknown = null;
    try {
      await h.useCase.execute({
        playerId: PlayerId("p"),
        multiplier: Multiplier.of(2),
        acceptedAt: now,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NoActiveBetError);
    expect(h.bets.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("bet exists but status PENDING → throws BetNotCashableError(PENDING)", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const running = buildRunningRound(now);
    const h = buildHarness(running);

    const playerId = PlayerId("player-1");
    const pending = BetAggregate.rehydrate({
      id: BetId(randomUUID()),
      roundId: running.id,
      playerId,
      amount: Money.of(500n),
      status: "PENDING",
      cashedOutAt: null,
      cashedOutMultiplier: null,
      payout: null,
      refundReason: null,
      createdAt: now,
    });
    h.bets.existingActive = pending;

    let caught: unknown = null;
    try {
      await h.useCase.execute({
        playerId,
        multiplier: Multiplier.of(2),
        acceptedAt: now,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BetNotCashableError);
    expect((caught as InstanceType<typeof BetNotCashableError>).status).toBe("PENDING");
    expect(h.bets.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("tryTransition returns null (race) → throws BetNotCashableError(RACE)", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const running = buildRunningRound(now);
    const h = buildHarness(running);

    const playerId = PlayerId("player-1");
    const active = buildActiveBet(running.id, playerId, now);
    h.bets.existingActive = active;
    h.bets.transitionReturns = null;

    let caught: unknown = null;
    try {
      await h.useCase.execute({
        playerId,
        multiplier: Multiplier.of(2),
        acceptedAt: now,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BetNotCashableError);
    expect((caught as InstanceType<typeof BetNotCashableError>).status).toBe("RACE");
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("write order inside the transactional callback: bet.tryTransition → outbox, all with same txEm", async () => {
    const now = new Date("2026-05-27T00:00:00.000Z");
    const running = buildRunningRound(now);
    const h = buildHarness(running);

    const playerId = PlayerId("player-1");
    const active = buildActiveBet(running.id, playerId, now);
    h.bets.existingActive = active;

    await h.useCase.execute({
      playerId,
      multiplier: Multiplier.of(2),
      acceptedAt: now,
    });

    expect(h.em.transactionalCalls).toBe(1);
    const transitionOrder = h.bets.transitionCalls[0]!.order;
    const outboxOrder = h.outbox.calls[0]!.order;
    expect(transitionOrder).toBeLessThan(outboxOrder);

    expect(h.bets.transitionCalls[0]!.em).toBe(h.em);
    expect(h.outbox.calls[0]!.em).toBe(h.em);
  });
});
