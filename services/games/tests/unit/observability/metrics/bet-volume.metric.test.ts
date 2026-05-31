/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../../../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import type { Bet, BetProps } from "../../../../src/domain/bet.aggregate";
import type { BetRepository } from "../../../../src/domain/bet.repository";
import type { RoundRepository } from "../../../../src/domain/round.repository";
import type { Round } from "../../../../src/domain/round.aggregate";
import type { BetSagaState } from "../../../../src/domain/bet-saga-state.aggregate";
import type { BetSagaStateRepository } from "../../../../src/domain/bet-saga-state.repository";
import type { BetStatus } from "../../../../src/domain/value-objects/bet-status";

type CashOutCtor = typeof import("../../../../src/application/use-cases/cash-out.use-case")["CashOutUseCase"];
type CrashRoundCtor = typeof import("../../../../src/application/use-cases/crash-round.use-case")["CrashRoundUseCase"];
type WalletDebitRejectedCtor = typeof import("../../../../src/application/handlers/wallet-debit-rejected.handler")["WalletDebitRejectedHandler"];
type SweeperCtor = typeof import("../../../../src/application/saga-timeout-sweeper.service")["SagaTimeoutSweeper"];
type BetExport = typeof import("../../../../src/domain/bet.aggregate")["Bet"];
type RoundExport = typeof import("../../../../src/domain/round.aggregate")["Round"];

let CashOutUseCase: CashOutCtor;
let CrashRoundUseCase: CrashRoundCtor;
let WalletDebitRejectedHandler: WalletDebitRejectedCtor;
let SagaTimeoutSweeper: SweeperCtor;
let BetAgg: BetExport;
let RoundAgg: RoundExport;
let CrashPoint: typeof import("../../../../src/domain/value-objects/crash-point")["CrashPoint"];
let Multiplier: typeof import("../../../../src/domain/value-objects/multiplier")["Multiplier"];

beforeAll(async () => {
  ({ CashOutUseCase } = await import("../../../../src/application/use-cases/cash-out.use-case"));
  ({ CrashRoundUseCase } = await import("../../../../src/application/use-cases/crash-round.use-case"));
  ({ WalletDebitRejectedHandler } = await import(
    "../../../../src/application/handlers/wallet-debit-rejected.handler"
  ));
  ({ SagaTimeoutSweeper } = await import(
    "../../../../src/application/saga-timeout-sweeper.service"
  ));
  ({ Bet: BetAgg } = await import("../../../../src/domain/bet.aggregate"));
  ({ Round: RoundAgg } = await import("../../../../src/domain/round.aggregate"));
  ({ CrashPoint } = await import("../../../../src/domain/value-objects/crash-point"));
  ({ Multiplier } = await import("../../../../src/domain/value-objects/multiplier"));
});

type IncCall = { labels: Record<string, string>; value?: number };

class FakeCounter {
  public readonly calls: IncCall[] = [];
  inc(labels: Record<string, string>, value?: number): void {
    this.calls.push({ labels, value });
  }
}

class StubEm {
  async transactional<T>(cb: (em: this) => Promise<T>): Promise<T> {
    return cb(this);
  }
}

class StubOutbox {
  public readonly added: unknown[] = [];
  async add(envelope: unknown): Promise<void> {
    this.added.push(envelope);
  }
}

function buildBet(
  roundId: ReturnType<typeof RoundId>,
  playerId: ReturnType<typeof PlayerId>,
  amountCents: bigint,
  status: BetStatus = "ACTIVE",
): Bet {
  return BetAgg.rehydrate({
    id: BetId(randomUUID()),
    roundId,
    playerId,
    amount: Money.of(amountCents),
    status,
    cashedOutAt: null,
    cashedOutMultiplier: null,
    payout: null,
    refundReason: null,
    createdAt: new Date(),
  });
}

describe("bet_volume_total counter — observation sites", () => {
  test("CrashRoundUseCase increments counter status=lost once per swept bet with amount in cents", async () => {
    const now = new Date();
    const round = RoundAgg.schedule(
      RoundId(randomUUID()),
      0n,
      "a".repeat(64),
      "client-seed",
      1,
      new Date(now.getTime() + 1000),
      now,
    )
      .start(now);
    const playerA = PlayerId("p-a");
    const bets: Bet[] = [
      buildBet(round.id, playerA, 5000n),
      buildBet(round.id, playerA, 5000n),
      buildBet(round.id, playerA, 5000n),
    ];

    const counter = new FakeCounter();
    const bettableRepo: Partial<BetRepository> = {
      async findActiveByRound() {
        return bets;
      },
      async tryTransition(
        id,
        from,
        to,
        patch,
      ): Promise<Bet | null> {
        const original = bets.find((b) => b.id === id);
        if (!original) return null;
        return BetAgg.rehydrate({
          id: original.id,
          roundId: original.roundId,
          playerId: original.playerId,
          amount: original.amount,
          status: to,
          cashedOutAt: (patch.cashedOutAt as Date | null) ?? null,
          cashedOutMultiplier: (patch.cashedOutMultiplier as never) ?? null,
          payout: (patch.payout as never) ?? null,
          refundReason: (patch.refundReason as string | null) ?? null,
          createdAt: original.createdAt,
        });
      },
    };
    const roundRepo: Partial<RoundRepository> = {
      async transitionFromRunningToCrashed() {
        return round;
      },
    };

    const useCase = new CrashRoundUseCase(
      new StubEm() as unknown as never,
      new StubOutbox() as unknown as never,
      roundRepo as RoundRepository,
      bettableRepo as BetRepository,
      counter as unknown as never,
    );

    await useCase.execute(round, CrashPoint.of(150), now);

    expect(counter.calls).toHaveLength(3);
    for (const call of counter.calls) {
      expect(call.labels).toEqual({ status: "lost" });
      expect(call.value).toBe(5000);
    }
  });

  test("CashOutUseCase increments counter status=cashed_out with bet amount in cents", async () => {
    const now = new Date();
    const round = RoundAgg.schedule(
      RoundId(randomUUID()),
      0n,
      "a".repeat(64),
      "client-seed",
      1,
      new Date(now.getTime() + 1000),
      now,
    ).start(now);
    const playerId = PlayerId("p-1");
    const active = buildBet(round.id, playerId, 7500n);

    const counter = new FakeCounter();
    const rounds: Partial<RoundRepository> = {
      async findOpen() {
        return round;
      },
    };
    const bets: Partial<BetRepository> = {
      async findActiveByRoundAndPlayer() {
        return active;
      },
      async tryTransition(id, _from, to, patch) {
        return BetAgg.rehydrate({
          id: active.id,
          roundId: active.roundId,
          playerId: active.playerId,
          amount: active.amount,
          status: to,
          cashedOutAt: (patch.cashedOutAt as Date | null) ?? null,
          cashedOutMultiplier: (patch.cashedOutMultiplier as never) ?? null,
          payout: (patch.payout as never) ?? null,
          refundReason: null,
          createdAt: active.createdAt,
        });
      },
    };

    const useCase = new CashOutUseCase(
      new StubEm() as unknown as never,
      new StubOutbox() as unknown as never,
      rounds as RoundRepository,
      bets as BetRepository,
      counter as unknown as never,
    );

    await useCase.execute({
      playerId,
      multiplier: Multiplier.of(2),
      acceptedAt: new Date(now.getTime() + 500),
    });

    expect(counter.calls).toHaveLength(1);
    expect(counter.calls[0]!.labels).toEqual({ status: "cashed_out" });
    expect(counter.calls[0]!.value).toBe(7500);
  });

  test("WalletDebitRejectedHandler increments counter status=refunded with bet amount in cents", async () => {
    const playerId = PlayerId("p-r");
    const roundId = RoundId(randomUUID());
    const pending = buildBet(roundId, playerId, 4200n, "PENDING");

    const counter = new FakeCounter();
    const sagas: Partial<BetSagaStateRepository> = {
      async findByCorrelationId(): Promise<BetSagaState | null> {
        return {
          betId: pending.id,
          correlationId: "corr-1",
          status: "DEBIT_PENDING",
          deadlineAt: new Date(),
          updatedAt: new Date(),
        } as unknown as BetSagaState;
      },
      async transition(): Promise<BetSagaState | null> {
        return {} as BetSagaState;
      },
    };
    const bets: Partial<BetRepository> = {
      async tryTransition(_id, _from, to, _patch) {
        return BetAgg.rehydrate({
          id: pending.id,
          roundId: pending.roundId,
          playerId: pending.playerId,
          amount: pending.amount,
          status: to,
          cashedOutAt: null,
          cashedOutMultiplier: null,
          payout: null,
          refundReason: "INSUFFICIENT_FUNDS",
          createdAt: pending.createdAt,
        });
      },
    };

    const handler = new WalletDebitRejectedHandler(
      new StubEm() as unknown as never,
      {} as unknown as never,
      {} as unknown as never,
      new StubOutbox() as unknown as never,
      bets as BetRepository,
      sagas as BetSagaStateRepository,
      counter as unknown as never,
    );

    const envelope = {
      messageId: "msg-1",
      correlationId: "corr-1",
      payload: {
        playerId: playerId as unknown as string,
        reason: "INSUFFICIENT_FUNDS",
      },
    };

    await handler.handleEnvelope(envelope as any, {} as any, new StubEm() as unknown as never);

    expect(counter.calls).toHaveLength(1);
    expect(counter.calls[0]!.labels).toEqual({ status: "refunded" });
    expect(counter.calls[0]!.value).toBe(4200);
  });

  test("SagaTimeoutSweeper increments counter status=refunded once per refunded bet in the sweep", async () => {
    const playerId = PlayerId("p-s");
    const bet1 = buildBet(RoundId(randomUUID()), playerId, 3300n, "PENDING");
    const bet2 = buildBet(RoundId(randomUUID()), playerId, 2200n, "PENDING");

    const counter = new FakeCounter();
    const sagas: Partial<BetSagaStateRepository> = {
      async claimExpired(): Promise<BetSagaState[]> {
        return [
          {
            betId: bet1.id,
            correlationId: "c-1",
            status: "DEBIT_PENDING",
            deadlineAt: new Date(),
            updatedAt: new Date(),
          } as unknown as BetSagaState,
          {
            betId: bet2.id,
            correlationId: "c-2",
            status: "DEBIT_PENDING",
            deadlineAt: new Date(),
            updatedAt: new Date(),
          } as unknown as BetSagaState,
        ];
      },
      async transition(): Promise<BetSagaState | null> {
        return {} as BetSagaState;
      },
    };
    const bets: Partial<BetRepository> = {
      async tryTransition(id, _from, to) {
        const original = id === bet1.id ? bet1 : bet2;
        return BetAgg.rehydrate({
          id: original.id,
          roundId: original.roundId,
          playerId: original.playerId,
          amount: original.amount,
          status: to,
          cashedOutAt: null,
          cashedOutMultiplier: null,
          payout: null,
          refundReason: "SAGA_TIMEOUT",
          createdAt: original.createdAt,
        });
      },
    };

    const sweeper = new SagaTimeoutSweeper(
      new StubEm() as unknown as never,
      new StubOutbox() as unknown as never,
      sagas as BetSagaStateRepository,
      bets as BetRepository,
      counter as unknown as never,
    );

    await sweeper.sweep();

    expect(counter.calls).toHaveLength(2);
    for (const call of counter.calls) {
      expect(call.labels).toEqual({ status: "refunded" });
    }
    const observedValues = counter.calls.map((c) => c.value).sort();
    expect(observedValues).toEqual([2200, 3300]);
  });
});
