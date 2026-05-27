import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { BetId } from "@crash/shared-kernel";
import { BetSagaState } from "../../src/domain/bet-saga-state.aggregate";
import { IllegalBetSagaTransitionError } from "../../src/domain/errors";

const betId = BetId("bet-saga-1");
const correlationId = "corr-1";
const deadlineAt = new Date("2026-05-27T12:00:05Z");

function makePending(): BetSagaState {
  return BetSagaState.create({ betId, correlationId, deadlineAt });
}

describe("BetSagaState.create — factory (DEBIT_PENDING)", () => {
  test("returns aggregate in DEBIT_PENDING with supplied fields", () => {
    const state = makePending();
    expect(state.status).toBe("DEBIT_PENDING");
    expect(state.betId).toBe(betId);
    expect(state.correlationId).toBe(correlationId);
    expect(state.deadlineAt).toBe(deadlineAt);
    expect(state.updatedAt).toBeInstanceOf(Date);
  });
});

describe("BetSagaState.confirm — DEBIT_PENDING → CONFIRMED", () => {
  test("returns new aggregate with status CONFIRMED", () => {
    const next = makePending().confirm();
    expect(next.status).toBe("CONFIRMED");
  });
});

describe("BetSagaState.refund — DEBIT_PENDING → REFUNDED", () => {
  test("returns new aggregate with status REFUNDED", () => {
    const next = makePending().refund();
    expect(next.status).toBe("REFUNDED");
  });
});

describe("BetSagaState.timeOut — DEBIT_PENDING → TIMED_OUT", () => {
  test("returns new aggregate with status TIMED_OUT", () => {
    const next = makePending().timeOut();
    expect(next.status).toBe("TIMED_OUT");
  });
});

describe("BetSagaState.compensate — TIMED_OUT → COMPENSATED", () => {
  test("returns new aggregate with status COMPENSATED", () => {
    const next = makePending().timeOut().compensate();
    expect(next.status).toBe("COMPENSATED");
  });
});

describe("BetSagaState — illegal transitions", () => {
  test("compensate() on CONFIRMED throws IllegalBetSagaTransitionError with from/to", () => {
    const confirmed = makePending().confirm();
    try {
      confirmed.compensate();
      throw new Error("expected to throw");
    } catch (err) {
      const e = err as IllegalBetSagaTransitionError;
      expect(e).toBeInstanceOf(IllegalBetSagaTransitionError);
      expect(e.from).toBe("CONFIRMED");
      expect(e.to).toBe("COMPENSATED");
    }
  });

  test("confirm() after CONFIRMED throws", () => {
    const confirmed = makePending().confirm();
    expect(() => confirmed.confirm()).toThrow(IllegalBetSagaTransitionError);
  });

  test("confirm() after REFUNDED throws", () => {
    const refunded = makePending().refund();
    expect(() => refunded.confirm()).toThrow(IllegalBetSagaTransitionError);
  });

  test("confirm() after COMPENSATED throws", () => {
    const compensated = makePending().timeOut().compensate();
    expect(() => compensated.confirm()).toThrow(IllegalBetSagaTransitionError);
  });
});

describe("BetSagaState.rehydrate — bypasses FSM", () => {
  test("returns aggregate matching row status without transitions", () => {
    const original = makePending().timeOut();
    const rehydrated = BetSagaState.rehydrate({
      betId: original.betId,
      correlationId: original.correlationId,
      status: original.status,
      deadlineAt: original.deadlineAt,
      updatedAt: original.updatedAt,
    });
    expect(rehydrated.status).toBe("TIMED_OUT");
    expect(rehydrated.betId).toBe(betId);
    expect(rehydrated.correlationId).toBe(correlationId);
  });
});
