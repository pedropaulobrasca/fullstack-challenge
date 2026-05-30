import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import type { DomainEventEnvelope } from "@crash/shared-kernel/events";
import { betLostEventSchema } from "@crash/contracts";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type { Round } from "../../src/domain/round.aggregate";
import type { Bet, BetProps } from "../../src/domain/bet.aggregate";
import type { BetStatus } from "../../src/domain/value-objects/bet-status";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";

type UseCaseCtor = typeof import("../../src/application/use-cases/crash-round.use-case")["CrashRoundUseCase"];
type RoundAggregateExport = typeof import("../../src/domain/round.aggregate")["Round"];
type BetAggregateExport = typeof import("../../src/domain/bet.aggregate")["Bet"];

let CrashRoundUseCase: UseCaseCtor;
let RoundAggregate: RoundAggregateExport;
let BetAggregate: BetAggregateExport;

beforeAll(async () => {
  ({ CrashRoundUseCase } = await import(
    "../../src/application/use-cases/crash-round.use-case"
  ));
  ({ Round: RoundAggregate } = await import("../../src/domain/round.aggregate"));
  ({ Bet: BetAggregate } = await import("../../src/domain/bet.aggregate"));
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
  public crashed: Round | null = null;
  public reloaded: Round | null = null;
  async transitionFromRunningToCrashed(): Promise<Round | null> {
    return this.crashed;
  }
  async findById(): Promise<Round | null> {
    return this.reloaded;
  }
}

class FakeBetRepo implements Partial<BetRepository> {
  public activeBets: Bet[] = [];
  public transitionFails: Set<string> = new Set();
  public readonly transitionCalls: Array<{
    id: BetId;
    from: BetStatus;
    to: BetStatus;
    em: unknown;
  }> = [];

  async findActiveByRound(): Promise<Bet[]> {
    return this.activeBets;
  }

  async tryTransition(
    id: BetId,
    from: BetStatus,
    to: BetStatus,
    patch: Partial<BetProps>,
    txEm?: unknown,
  ): Promise<Bet | null> {
    this.transitionCalls.push({ id, from, to, em: txEm });
    if (this.transitionFails.has(id as unknown as string)) return null;
    const original = this.activeBets.find((b) => b.id === id);
    if (!original) return null;
    return BetAggregate.rehydrate({
      id: original.id,
      roundId: original.roundId,
      playerId: original.playerId,
      amount: original.amount,
      status: to,
      cashedOutAt: null,
      cashedOutMultiplier: null,
      payout: null,
      refundReason: null,
      createdAt: original.createdAt,
      autoCashoutTarget: original.autoCashoutTarget,
    });
  }
}

function buildCrashedRound(now: Date, crashPoint: CrashPoint): Round {
  const scheduled = RoundAggregate.schedule(
    RoundId(randomUUID()),
    0n,
    "a".repeat(64),
    "client-seed-hex",
    1,
    new Date(now.getTime() + 5000),
    now,
  );
  return scheduled.start(now).crash(crashPoint, now);
}

function buildActiveBet(
  roundId: ReturnType<typeof RoundAggregate.schedule>["id"],
  now: Date,
): Bet {
  return BetAggregate.rehydrate({
    id: BetId(randomUUID()),
    roundId,
    playerId: PlayerId(`player-${randomUUID()}`),
    amount: Money.of(10000n),
    status: "ACTIVE",
    cashedOutAt: null,
    cashedOutMultiplier: null,
    payout: null,
    refundReason: null,
    createdAt: now,
    autoCashoutTarget: null,
  });
}

type Harness = {
  useCase: InstanceType<UseCaseCtor>;
  em: StubEntityManager;
  outbox: FakeOutboxRepository;
  bets: FakeBetRepo;
  rounds: FakeRoundRepo;
};

function buildHarness(): Harness {
  const em = new StubEntityManager();
  const outbox = new FakeOutboxRepository();
  const bets = new FakeBetRepo();
  const rounds = new FakeRoundRepo();
  const useCase = new CrashRoundUseCase(
    em as unknown as never,
    outbox as unknown as never,
    rounds as unknown as RoundRepository,
    bets as unknown as BetRepository,
  );
  return { useCase, em, outbox, bets, rounds };
}

describe("CrashRoundUseCase — bet.lost outbox emission", () => {
  test("emits one bet.lost outbox row per ACTIVE bet swept to LOST", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const crashPoint = CrashPoint.of(2.5);
    const h = buildHarness();
    const round = buildCrashedRound(now, crashPoint);
    h.rounds.crashed = round;
    h.bets.activeBets = [
      buildActiveBet(round.id, now),
      buildActiveBet(round.id, now),
      buildActiveBet(round.id, now),
    ];

    await h.useCase.execute(round, crashPoint, now);

    expect(h.outbox.calls).toHaveLength(3);
    for (const call of h.outbox.calls) {
      expect(call.envelope.type).toBe("bet.lost");
      expect(call.route.exchange).toBe("game.events");
      expect(call.route.routingKey).toBe("bet.lost");
      expect(call.route.aggregateType).toBe("Bet");
    }
  });

  test("each bet.lost payload validates against betLostEventSchema", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const crashPoint = CrashPoint.of(2.5);
    const h = buildHarness();
    const round = buildCrashedRound(now, crashPoint);
    h.rounds.crashed = round;
    h.bets.activeBets = [buildActiveBet(round.id, now)];

    await h.useCase.execute(round, crashPoint, now);

    const parsed = betLostEventSchema.parse(h.outbox.calls[0]!.envelope.payload);
    expect(parsed.roundId).toBe(round.id as unknown as string);
    expect(parsed.amount.amount).toBe("10000");
    expect(parsed.amount.currency).toBe("CRD");
  });

  test("zero ACTIVE bets → zero bet.lost rows emitted", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const crashPoint = CrashPoint.of(2.5);
    const h = buildHarness();
    const round = buildCrashedRound(now, crashPoint);
    h.rounds.crashed = round;
    h.bets.activeBets = [];

    await h.useCase.execute(round, crashPoint, now);

    expect(h.outbox.calls).toHaveLength(0);
  });

  test("tryTransition race (returns null) → no bet.lost row emitted for that bet", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const crashPoint = CrashPoint.of(2.5);
    const h = buildHarness();
    const round = buildCrashedRound(now, crashPoint);
    h.rounds.crashed = round;
    const a = buildActiveBet(round.id, now);
    const b = buildActiveBet(round.id, now);
    h.bets.activeBets = [a, b];
    h.bets.transitionFails.add(a.id as unknown as string);

    await h.useCase.execute(round, crashPoint, now);

    expect(h.outbox.calls).toHaveLength(1);
    expect(
      (h.outbox.calls[0]!.envelope.payload as { betId: string }).betId,
    ).toBe(b.id as unknown as string);
  });

  test("FSM transition + outbox publish share the same txEm", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const crashPoint = CrashPoint.of(2.5);
    const h = buildHarness();
    const round = buildCrashedRound(now, crashPoint);
    h.rounds.crashed = round;
    h.bets.activeBets = [buildActiveBet(round.id, now)];

    await h.useCase.execute(round, crashPoint, now);

    expect(h.em.transactionalCalls).toBe(1);
    expect(h.bets.transitionCalls[0]!.em).toBe(h.em);
    expect(h.outbox.calls[0]!.em).toBe(h.em);
  });

  test("envelope carries fresh messageId + correlationId per LOST bet", async () => {
    const now = new Date("2026-05-30T00:00:00.000Z");
    const crashPoint = CrashPoint.of(2.5);
    const h = buildHarness();
    const round = buildCrashedRound(now, crashPoint);
    h.rounds.crashed = round;
    h.bets.activeBets = [
      buildActiveBet(round.id, now),
      buildActiveBet(round.id, now),
    ];

    await h.useCase.execute(round, crashPoint, now);

    const ids = h.outbox.calls.map((c) => c.envelope.messageId);
    expect(new Set(ids).size).toBe(2);
    for (const call of h.outbox.calls) {
      expect(typeof call.envelope.correlationId).toBe("string");
      expect(call.envelope.correlationId.length).toBeGreaterThan(0);
      expect(call.envelope.causationId).toBe(call.envelope.messageId);
    }
  });
});
