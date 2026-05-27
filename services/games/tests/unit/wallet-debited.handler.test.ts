import { beforeAll, describe, expect, test } from "bun:test";
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

type HandlerCtor = typeof import("../../src/application/handlers/wallet-debited.handler")["WalletDebitedHandler"];
type BetAggregateExport = typeof import("../../src/domain/bet.aggregate")["Bet"];
type SagaAggregateExport = typeof import("../../src/domain/bet-saga-state.aggregate")["BetSagaState"];

let WalletDebitedHandler: HandlerCtor;
let BetAggregate: BetAggregateExport;
let BetSagaStateAggregate: SagaAggregateExport;

beforeAll(async () => {
  ({ WalletDebitedHandler } = await import(
    "../../src/application/handlers/wallet-debited.handler"
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
  public tryTransitionResult: Bet | null = null;
  public findByIdResult: Bet | null = null;
  public findByIdCalls: Array<{ id: BetId; em: unknown }> = [];

  async tryTransition(
    id: BetId,
    from: BetStatus,
    to: BetStatus,
    patch: Partial<BetProps>,
    em?: unknown,
  ): Promise<Bet | null> {
    this.tryTransitionCalls.push({ id, from, to, patch, em });
    return this.tryTransitionResult;
  }

  async findById(id: BetId): Promise<Bet | null> {
    this.findByIdCalls.push({ id, em: undefined });
    return this.findByIdResult;
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
  public findByCorrelationIdResult: BetSagaState | null = null;
  public findByCorrelationIdCalls: Array<{ correlationId: string; em: unknown }> = [];
  public transitionCalls: Array<{
    betId: BetId;
    from: BetSagaStatus;
    to: BetSagaStatus;
    em: unknown;
  }> = [];

  async findByCorrelationId(correlationId: string, em?: unknown): Promise<BetSagaState | null> {
    this.findByCorrelationIdCalls.push({ correlationId, em });
    return this.findByCorrelationIdResult;
  }
  async findByBetId(): Promise<BetSagaState | null> {
    return null;
  }
  async transition(
    betId: BetId,
    from: BetSagaStatus,
    to: BetSagaStatus,
    em: unknown,
  ): Promise<BetSagaState | null> {
    this.transitionCalls.push({ betId, from, to, em });
    return null;
  }
  async create(_input: BetSagaStateCreateInput): Promise<void> {}
  async claimExpired(): Promise<BetSagaState[]> {
    return [];
  }
}

type Harness = {
  handler: InstanceType<HandlerCtor>;
  bets: FakeBetRepo;
  sagas: FakeSagaRepo;
  outbox: FakeOutboxRepository;
  txEm: { __tag: "txEm" };
};

function buildHarness(): Harness {
  const bets = new FakeBetRepo();
  const sagas = new FakeSagaRepo();
  const outbox = new FakeOutboxRepository();
  const handler = new WalletDebitedHandler(
    {} as never,
    {} as never,
    {} as never,
    outbox as unknown as never,
    bets as unknown as BetRepository,
    sagas as unknown as BetSagaStateRepository,
  );
  return { handler, bets, sagas, outbox, txEm: { __tag: "txEm" } };
}

function buildEnvelope(opts: {
  correlationId?: string;
  playerId?: string;
  walletId?: string;
}) {
  return {
    messageId: randomUUID(),
    correlationId: opts.correlationId ?? randomUUID(),
    causationId: randomUUID(),
    type: "wallet.debited" as const,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      walletId: opts.walletId ?? randomUUID(),
      playerId: opts.playerId ?? "player-1",
      newBalance: { amount: "9500", currency: "CRD", scale: 2 },
    },
  };
}

describe("WalletDebitedHandler", () => {
  test("DEBIT_PENDING saga → transitions bet PENDING→ACTIVE, saga→CONFIRMED, emits bet.active", async () => {
    const h = buildHarness();
    const correlationId = randomUUID();
    const betId = BetId(randomUUID());
    const roundId = RoundId(randomUUID());
    const playerId = PlayerId("player-1");

    h.sagas.findByCorrelationIdResult = BetSagaStateAggregate.rehydrate({
      betId,
      correlationId,
      status: "DEBIT_PENDING",
      deadlineAt: new Date(Date.now() + 5000),
      updatedAt: new Date(),
    });
    const activeBet = BetAggregate.rehydrate({
      id: betId,
      roundId,
      playerId,
      amount: Money.of(500n),
      status: "ACTIVE",
      cashedOutAt: null,
      cashedOutMultiplier: null,
      payout: null,
      refundReason: null,
      createdAt: new Date(),
    });
    h.bets.tryTransitionResult = activeBet;

    const envelope = buildEnvelope({ correlationId, playerId: "player-1" });

    await h.handler.handle(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(1);
    expect(h.bets.tryTransitionCalls[0]!.id).toBe(betId);
    expect(h.bets.tryTransitionCalls[0]!.from).toBe("PENDING");
    expect(h.bets.tryTransitionCalls[0]!.to).toBe("ACTIVE");
    expect(h.bets.tryTransitionCalls[0]!.em).toBe(h.txEm);

    expect(h.sagas.transitionCalls).toHaveLength(1);
    expect(h.sagas.transitionCalls[0]!.from).toBe("DEBIT_PENDING");
    expect(h.sagas.transitionCalls[0]!.to).toBe("CONFIRMED");
    expect(h.sagas.transitionCalls[0]!.em).toBe(h.txEm);

    expect(h.outbox.calls).toHaveLength(1);
    expect(h.outbox.calls[0]!.envelope.type).toBe("bet.active");
    expect(h.outbox.calls[0]!.route.exchange).toBe("game.events");
    expect(h.outbox.calls[0]!.route.routingKey).toBe("bet.active");
    expect(h.outbox.calls[0]!.route.aggregateType).toBe("Bet");
    expect(h.outbox.calls[0]!.route.aggregateId).toBe(betId as unknown as string);
    expect(h.outbox.calls[0]!.em).toBe(h.txEm);
    expect(h.outbox.calls[0]!.envelope.correlationId).toBe(correlationId);
    const payload = h.outbox.calls[0]!.envelope.payload as {
      betId: string;
      playerId: string;
      roundId: string;
    };
    expect(payload.betId).toBe(betId as unknown as string);
    expect(payload.playerId).toBe("player-1");
    expect(payload.roundId).toBe(roundId as unknown as string);
  });

  test("TIMED_OUT saga → emits compensating wallet.credit with original bet amount, saga→COMPENSATED", async () => {
    const h = buildHarness();
    const correlationId = randomUUID();
    const betId = BetId(randomUUID());
    const roundId = RoundId(randomUUID());
    const playerId = PlayerId("player-1");

    h.sagas.findByCorrelationIdResult = BetSagaStateAggregate.rehydrate({
      betId,
      correlationId,
      status: "TIMED_OUT",
      deadlineAt: new Date(Date.now() - 5000),
      updatedAt: new Date(),
    });
    h.bets.findByIdResult = BetAggregate.rehydrate({
      id: betId,
      roundId,
      playerId,
      amount: Money.of(750n),
      status: "REFUNDED",
      cashedOutAt: null,
      cashedOutMultiplier: null,
      payout: null,
      refundReason: "SAGA_TIMEOUT",
      createdAt: new Date(),
    });

    const envelope = buildEnvelope({ correlationId, playerId: "player-1" });

    await h.handler.handle(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(1);
    expect(h.outbox.calls[0]!.envelope.type).toBe("wallet.credit");
    expect(h.outbox.calls[0]!.route.exchange).toBe("wallet.commands");
    expect(h.outbox.calls[0]!.route.routingKey).toBe("wallet.credit");
    expect(h.outbox.calls[0]!.route.aggregateType).toBe("Bet");
    expect(h.outbox.calls[0]!.route.aggregateId).toBe(betId as unknown as string);
    expect(h.outbox.calls[0]!.em).toBe(h.txEm);

    const payload = h.outbox.calls[0]!.envelope.payload as {
      playerId: string;
      amount: { amount: string; currency: string; scale: number };
    };
    expect(payload.playerId).toBe("player-1");
    expect(payload.amount.amount).toBe("750");

    expect(h.sagas.transitionCalls).toHaveLength(1);
    expect(h.sagas.transitionCalls[0]!.from).toBe("TIMED_OUT");
    expect(h.sagas.transitionCalls[0]!.to).toBe("COMPENSATED");
    expect(h.sagas.transitionCalls[0]!.em).toBe(h.txEm);
  });

  test("terminal-state saga (CONFIRMED) → no-op, no writes", async () => {
    const h = buildHarness();
    const correlationId = randomUUID();
    const betId = BetId(randomUUID());

    h.sagas.findByCorrelationIdResult = BetSagaStateAggregate.rehydrate({
      betId,
      correlationId,
      status: "CONFIRMED",
      deadlineAt: new Date(),
      updatedAt: new Date(),
    });

    const envelope = buildEnvelope({ correlationId });

    await h.handler.handle(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(0);
    expect(h.sagas.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("unknown correlationId → warn + return, no writes", async () => {
    const h = buildHarness();
    h.sagas.findByCorrelationIdResult = null;

    const envelope = buildEnvelope({});

    await h.handler.handle(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(0);
    expect(h.sagas.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("race during CONFIRM — bets.tryTransition returns null → saga.transition skipped, no bet.active emitted", async () => {
    const h = buildHarness();
    const correlationId = randomUUID();
    const betId = BetId(randomUUID());

    h.sagas.findByCorrelationIdResult = BetSagaStateAggregate.rehydrate({
      betId,
      correlationId,
      status: "DEBIT_PENDING",
      deadlineAt: new Date(Date.now() + 5000),
      updatedAt: new Date(),
    });
    h.bets.tryTransitionResult = null;

    const envelope = buildEnvelope({ correlationId });

    await h.handler.handle(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(1);
    expect(h.sagas.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });
});
