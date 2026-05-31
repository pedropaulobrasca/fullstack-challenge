import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { Money } from "@crash/shared-kernel";
import { BetId, PlayerId, RoundId } from "@crash/shared-kernel/identity";
import { Bet } from "../../src/domain/bet.aggregate";
import { Multiplier } from "../../src/domain/value-objects/multiplier";
import { IllegalBetTransitionError } from "../../src/domain/errors";

const baseDate = new Date("2026-05-25T12:00:00Z");
const cashOutDate = new Date("2026-05-25T12:00:03Z");

function makePending(amountCents = 1000n): Bet {
  return Bet.place(
    BetId("bet-1"),
    RoundId("round-1"),
    PlayerId("player-1"),
    Money.of(amountCents),
    baseDate,
  );
}

describe("Bet.place — factory (PENDING)", () => {
  test("constructs a Bet in PENDING status with null cashout fields", () => {
    const bet = makePending();
    expect(bet.status).toBe("PENDING");
    expect(bet.cashedOutAt).toBeNull();
    expect(bet.cashedOutMultiplier).toBeNull();
    expect(bet.payout).toBeNull();
    expect(bet.refundReason).toBeNull();
    expect(bet.amount.toCents()).toBe(1000n);
    expect(bet.id).toBe(BetId("bet-1"));
    expect(bet.roundId).toBe(RoundId("round-1"));
    expect(bet.playerId).toBe(PlayerId("player-1"));
    expect(bet.createdAt).toBe(baseDate);
  });
});

describe("Bet.confirm — PENDING → ACTIVE", () => {
  test("PENDING → ACTIVE succeeds", () => {
    const pending = makePending();
    const active = pending.confirm();
    expect(active.status).toBe("ACTIVE");
  });

  test("ACTIVE → confirm() throws IllegalBetTransitionError", () => {
    const active = makePending().confirm();
    expect(() => active.confirm()).toThrow(IllegalBetTransitionError);
  });

  test("REFUNDED → confirm() throws", () => {
    const refunded = makePending().refund("test reason");
    expect(() => refunded.confirm()).toThrow(IllegalBetTransitionError);
  });

  test("CASHED_OUT → confirm() throws", () => {
    const cashed = makePending().confirm().cashOut(Multiplier.of(2.0), cashOutDate).next;
    expect(() => cashed.confirm()).toThrow(IllegalBetTransitionError);
  });

  test("error carries code ILLEGAL_BET_TRANSITION + from/to", () => {
    const active = makePending().confirm();
    try {
      active.confirm();
      throw new Error("expected to throw");
    } catch (err) {
      const e = err as IllegalBetTransitionError;
      expect(e.code).toBe("ILLEGAL_BET_TRANSITION");
      expect(e.from).toBe("ACTIVE");
      expect(e.to).toBe("ACTIVE");
    }
  });
});

describe("Bet.cashOut — ACTIVE → CASHED_OUT", () => {
  test("returns {next, payout} with status=CASHED_OUT and stamped fields", () => {
    const active = makePending(1000n).confirm();
    const multiplier = Multiplier.of(2.5);
    const { next, payout } = active.cashOut(multiplier, cashOutDate);
    expect(next.status).toBe("CASHED_OUT");
    expect(next.cashedOutAt).toBe(cashOutDate);
    expect(next.cashedOutMultiplier).toBe(multiplier);
    expect(next.payout).not.toBeNull();
    expect(next.payout!.toCents()).toBe(2500n);
    expect(payout.toCents()).toBe(2500n);
  });

  test("payout uses banker's rounding via Money.multiplyRounded", () => {
    const active = makePending(100n).confirm();
    const { payout } = active.cashOut(Multiplier.of(1.015), cashOutDate);
    expect(payout.toCents()).toBe(102n);
  });

  test("payout for 100 × 1.025 = 102 cents (banker's, 1.025 → 1.02)", () => {
    const active = makePending(100n).confirm();
    const { payout } = active.cashOut(Multiplier.of(1.025), cashOutDate);
    expect(payout.toCents()).toBe(102n);
  });

  test("PENDING → cashOut throws (must confirm first)", () => {
    const pending = makePending();
    expect(() => pending.cashOut(Multiplier.of(2.0), cashOutDate)).toThrow(
      IllegalBetTransitionError,
    );
  });

  test("CASHED_OUT → cashOut throws (double cashout)", () => {
    const cashed = makePending().confirm().cashOut(Multiplier.of(2.0), cashOutDate).next;
    expect(() => cashed.cashOut(Multiplier.of(3.0), cashOutDate)).toThrow(
      IllegalBetTransitionError,
    );
  });

  test("LOST → cashOut throws", () => {
    const lost = makePending().confirm().lose();
    expect(() => lost.cashOut(Multiplier.of(2.0), cashOutDate)).toThrow(
      IllegalBetTransitionError,
    );
  });

  test("REFUNDED → cashOut throws", () => {
    const refunded = makePending().refund("test");
    expect(() => refunded.cashOut(Multiplier.of(2.0), cashOutDate)).toThrow(
      IllegalBetTransitionError,
    );
  });
});

describe("Bet.lose — ACTIVE → LOST", () => {
  test("ACTIVE → LOST succeeds", () => {
    const lost = makePending().confirm().lose();
    expect(lost.status).toBe("LOST");
  });

  test("PENDING → lose throws", () => {
    expect(() => makePending().lose()).toThrow(IllegalBetTransitionError);
  });

  test("CASHED_OUT → lose throws", () => {
    const cashed = makePending().confirm().cashOut(Multiplier.of(2.0), cashOutDate).next;
    expect(() => cashed.lose()).toThrow(IllegalBetTransitionError);
  });

  test("LOST → lose (idempotency violation) throws", () => {
    const lost = makePending().confirm().lose();
    expect(() => lost.lose()).toThrow(IllegalBetTransitionError);
  });
});

describe("Bet.refund — PENDING → REFUNDED", () => {
  test("PENDING → REFUNDED with reason succeeds", () => {
    const refunded = makePending().refund("round cancelled");
    expect(refunded.status).toBe("REFUNDED");
    expect(refunded.refundReason).toBe("round cancelled");
  });

  test("ACTIVE → refund throws (per ADR-014 — only PENDING is refundable)", () => {
    const active = makePending().confirm();
    expect(() => active.refund("late refund")).toThrow(IllegalBetTransitionError);
  });

  test("CASHED_OUT → refund throws", () => {
    const cashed = makePending().confirm().cashOut(Multiplier.of(2.0), cashOutDate).next;
    expect(() => cashed.refund("late refund")).toThrow(IllegalBetTransitionError);
  });

  test("LOST → refund throws", () => {
    const lost = makePending().confirm().lose();
    expect(() => lost.refund("post-loss refund")).toThrow(IllegalBetTransitionError);
  });

  test("REFUNDED → refund throws (no double-refund)", () => {
    const refunded = makePending().refund("first reason");
    expect(() => refunded.refund("second reason")).toThrow(IllegalBetTransitionError);
  });
});

describe("Bet immutability and rehydrate", () => {
  test("confirm returns a new instance, original unchanged", () => {
    const pending = makePending();
    const active = pending.confirm();
    expect(pending.status).toBe("PENDING");
    expect(active.status).toBe("ACTIVE");
    expect(pending).not.toBe(active);
  });

  test("rehydrate reconstructs the aggregate from props", () => {
    const original = makePending().confirm();
    const rehydrated = Bet.rehydrate({
      id: original.id,
      roundId: original.roundId,
      playerId: original.playerId,
      amount: original.amount,
      status: original.status,
      cashedOutAt: original.cashedOutAt,
      cashedOutMultiplier: original.cashedOutMultiplier,
      payout: original.payout,
      refundReason: original.refundReason,
      createdAt: original.createdAt,
    });
    expect(rehydrated.status).toBe("ACTIVE");
    expect(rehydrated.amount.toCents()).toBe(1000n);
  });
});

describe("Bet.place — autoCashoutTarget (Phase 9 Plan 02)", () => {
  test("place without autoCashoutTarget defaults to null (backwards-compat)", () => {
    const bet = makePending();
    expect(bet.autoCashoutTarget).toBeNull();
  });

  test("place with autoCashoutTarget = null returns a Bet exposing null", () => {
    const bet = Bet.place(
      BetId("bet-1"),
      RoundId("round-1"),
      PlayerId("player-1"),
      Money.of(1000n),
      baseDate,
      null,
    );
    expect(bet.autoCashoutTarget).toBeNull();
  });

  test("place with Multiplier.fromCentiX(200) exposes target with toCentiX() === 200", () => {
    const bet = Bet.place(
      BetId("bet-1"),
      RoundId("round-1"),
      PlayerId("player-1"),
      Money.of(1000n),
      baseDate,
      Multiplier.fromTenThousandths(20_000n),
    );
    expect(bet.autoCashoutTarget).not.toBeNull();
    expect(bet.autoCashoutTarget!.toCentiX()).toBe(200);
  });

  test("autoCashoutTarget is preserved across rehydrate", () => {
    const original = Bet.place(
      BetId("bet-1"),
      RoundId("round-1"),
      PlayerId("player-1"),
      Money.of(1000n),
      baseDate,
      Multiplier.fromTenThousandths(20_000n),
    );
    const rehydrated = Bet.rehydrate({
      id: original.id,
      roundId: original.roundId,
      playerId: original.playerId,
      amount: original.amount,
      status: original.status,
      cashedOutAt: original.cashedOutAt,
      cashedOutMultiplier: original.cashedOutMultiplier,
      payout: original.payout,
      refundReason: original.refundReason,
      createdAt: original.createdAt,
      autoCashoutTarget: original.autoCashoutTarget,
    });
    expect(rehydrated.autoCashoutTarget?.toCentiX()).toBe(200);
  });
});

describe("Bet — happy paths from place → terminal", () => {
  test("place → confirm → cashOut yields CASHED_OUT", () => {
    const result = makePending(2000n)
      .confirm()
      .cashOut(Multiplier.of(3.0), cashOutDate);
    expect(result.next.status).toBe("CASHED_OUT");
    expect(result.payout.toCents()).toBe(6000n);
  });

  test("place → confirm → lose yields LOST", () => {
    const lost = makePending().confirm().lose();
    expect(lost.status).toBe("LOST");
  });

  test("place → refund yields REFUNDED without going through ACTIVE", () => {
    const refunded = makePending().refund("round aborted");
    expect(refunded.status).toBe("REFUNDED");
  });
});
