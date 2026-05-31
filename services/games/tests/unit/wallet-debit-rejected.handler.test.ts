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

type HandlerCtor =
  typeof import("../../src/application/handlers/wallet-debit-rejected.handler")["WalletDebitRejectedHandler"];
type BetAggregateExport = typeof import("../../src/domain/bet.aggregate")["Bet"];
type SagaAggregateExport = typeof import("../../src/domain/bet-saga-state.aggregate")["BetSagaState"];

let WalletDebitRejectedHandler: HandlerCtor;
let BetAggregate: BetAggregateExport;
let BetSagaStateAggregate: SagaAggregateExport;

beforeAll(async () => {
  ({ WalletDebitRejectedHandler } = await import(
    "../../src/application/handlers/wallet-debit-rejected.handler"
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

  async findById(): Promise<Bet | null> {
    return null;
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
  public transitionCalls: Array<{
    betId: BetId;
    from: BetSagaStatus;
    to: BetSagaStatus;
    em: unknown;
  }> = [];

  async findByCorrelationId(): Promise<BetSagaState | null> {
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
  const noopCounter = { inc: () => undefined };
  const handler = new WalletDebitRejectedHandler(
    {} as never,
    {} as never,
    {} as never,
    outbox as unknown as never,
    bets as unknown as BetRepository,
    sagas as unknown as BetSagaStateRepository,
    noopCounter as unknown as never,
  );
  return { handler, bets, sagas, outbox, txEm: { __tag: "txEm" } };
}

function buildEnvelope(opts: {
  correlationId?: string;
  playerId?: string;
  reason?: "INSUFFICIENT_FUNDS" | "WALLET_NOT_FOUND";
}) {
  return {
    messageId: randomUUID(),
    correlationId: opts.correlationId ?? randomUUID(),
    causationId: randomUUID(),
    type: "wallet.debit.rejected" as const,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      playerId: opts.playerId ?? "player-1",
      reason: opts.reason ?? ("INSUFFICIENT_FUNDS" as const),
      requested: { amount: "500", currency: "CRD", scale: 2 },
    },
  };
}

function rehydrateRefundedBet(betId: BetId, roundId: RoundId): Bet {
  return BetAggregate.rehydrate({
    id: betId,
    roundId,
    playerId: PlayerId("player-1"),
    amount: Money.of(500n),
    status: "REFUNDED",
    cashedOutAt: null,
    cashedOutMultiplier: null,
    payout: null,
    refundReason: "INSUFFICIENT_FUNDS",
    createdAt: new Date(),
  });
}

describe("WalletDebitRejectedHandler", () => {
  test("DEBIT_PENDING + INSUFFICIENT_FUNDS → bet PENDING→REFUNDED with reason, saga→REFUNDED, emits bet.refunded", async () => {
    const h = buildHarness();
    const correlationId = randomUUID();
    const betId = BetId(randomUUID());
    const roundId = RoundId(randomUUID());

    h.sagas.findByCorrelationIdResult = BetSagaStateAggregate.rehydrate({
      betId,
      correlationId,
      status: "DEBIT_PENDING",
      deadlineAt: new Date(Date.now() + 5000),
      updatedAt: new Date(),
    });
    h.bets.tryTransitionResult = rehydrateRefundedBet(betId, roundId);

    const envelope = buildEnvelope({
      correlationId,
      playerId: "player-1",
      reason: "INSUFFICIENT_FUNDS",
    });

    await h.handler.handleEnvelope(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(1);
    expect(h.bets.tryTransitionCalls[0]!.id).toBe(betId);
    expect(h.bets.tryTransitionCalls[0]!.from).toBe("PENDING");
    expect(h.bets.tryTransitionCalls[0]!.to).toBe("REFUNDED");
    expect(h.bets.tryTransitionCalls[0]!.patch.refundReason).toBe("INSUFFICIENT_FUNDS");
    expect(h.bets.tryTransitionCalls[0]!.em).toBe(h.txEm);

    expect(h.sagas.transitionCalls).toHaveLength(1);
    expect(h.sagas.transitionCalls[0]!.from).toBe("DEBIT_PENDING");
    expect(h.sagas.transitionCalls[0]!.to).toBe("REFUNDED");
    expect(h.sagas.transitionCalls[0]!.em).toBe(h.txEm);

    expect(h.outbox.calls).toHaveLength(1);
    expect(h.outbox.calls[0]!.envelope.type).toBe("bet.refunded");
    expect(h.outbox.calls[0]!.route.exchange).toBe("game.events");
    expect(h.outbox.calls[0]!.route.routingKey).toBe("bet.refunded");
    expect(h.outbox.calls[0]!.route.aggregateType).toBe("Bet");
    expect(h.outbox.calls[0]!.route.aggregateId).toBe(betId as unknown as string);
    expect(h.outbox.calls[0]!.em).toBe(h.txEm);

    const payload = h.outbox.calls[0]!.envelope.payload as {
      betId: string;
      playerId: string;
      reason: string;
    };
    expect(payload.betId).toBe(betId as unknown as string);
    expect(payload.playerId).toBe("player-1");
    expect(payload.reason).toBe("INSUFFICIENT_FUNDS");
  });

  test("DEBIT_PENDING + WALLET_NOT_FOUND → same flow, refundReason='WALLET_NOT_FOUND'", async () => {
    const h = buildHarness();
    const correlationId = randomUUID();
    const betId = BetId(randomUUID());
    const roundId = RoundId(randomUUID());

    h.sagas.findByCorrelationIdResult = BetSagaStateAggregate.rehydrate({
      betId,
      correlationId,
      status: "DEBIT_PENDING",
      deadlineAt: new Date(Date.now() + 5000),
      updatedAt: new Date(),
    });
    h.bets.tryTransitionResult = rehydrateRefundedBet(betId, roundId);

    const envelope = buildEnvelope({ correlationId, reason: "WALLET_NOT_FOUND" });

    await h.handler.handleEnvelope(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls[0]!.patch.refundReason).toBe("WALLET_NOT_FOUND");
    expect(h.outbox.calls[0]!.envelope.type).toBe("bet.refunded");
    const payload = h.outbox.calls[0]!.envelope.payload as { reason: string };
    expect(payload.reason).toBe("WALLET_NOT_FOUND");
  });

  test("non-DEBIT_PENDING saga → no-op, no writes", async () => {
    const h = buildHarness();
    const correlationId = randomUUID();
    const betId = BetId(randomUUID());

    h.sagas.findByCorrelationIdResult = BetSagaStateAggregate.rehydrate({
      betId,
      correlationId,
      status: "TIMED_OUT",
      deadlineAt: new Date(Date.now() - 5000),
      updatedAt: new Date(),
    });

    const envelope = buildEnvelope({ correlationId });

    await h.handler.handleEnvelope(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(0);
    expect(h.sagas.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });

  test("unknown correlationId → warn + no-op", async () => {
    const h = buildHarness();
    h.sagas.findByCorrelationIdResult = null;

    const envelope = buildEnvelope({});

    await h.handler.handleEnvelope(envelope as never, {} as never, h.txEm as never);

    expect(h.bets.tryTransitionCalls).toHaveLength(0);
    expect(h.sagas.transitionCalls).toHaveLength(0);
    expect(h.outbox.calls).toHaveLength(0);
  });
});
