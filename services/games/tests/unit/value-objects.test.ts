import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { Money } from "@crash/shared-kernel";
import { Multiplier } from "../../src/domain/value-objects/multiplier";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";
import { BetAmount } from "../../src/domain/value-objects/bet-amount";
import { ROUND_STATUSES } from "../../src/domain/value-objects/round-status";
import { BET_STATUSES } from "../../src/domain/value-objects/bet-status";
import { isValidSeedHex } from "../../src/domain/value-objects/seed";
import {
  BetAmountOutOfBoundsError,
  CrashPointOutOfBoundsError,
  MultiplierOutOfBoundsError,
} from "../../src/domain/errors";

describe("Multiplier VO", () => {
  test("Multiplier.of(0.99) throws MultiplierOutOfBoundsError", () => {
    expect(() => Multiplier.of(0.99)).toThrow(MultiplierOutOfBoundsError);
  });

  test("Multiplier.of(1.00) accepted", () => {
    const m = Multiplier.of(1.0);
    expect(m.toNumber()).toBe(1.0);
    expect(m.tenThousandths).toBe(10_000n);
  });

  test("Multiplier round-trips tenThousandths bigint scale", () => {
    const m = Multiplier.of(2.3456);
    expect(m.tenThousandths).toBe(23_456n);
    expect(m.toNumber()).toBe(2.3456);
    expect(m.toCentiX()).toBe(234);
  });

  test("Multiplier.of(NaN) throws", () => {
    expect(() => Multiplier.of(Number.NaN)).toThrow(MultiplierOutOfBoundsError);
  });

  test("Multiplier.of(Infinity) throws", () => {
    expect(() => Multiplier.of(Number.POSITIVE_INFINITY)).toThrow(MultiplierOutOfBoundsError);
  });

  test("error carries code ILLEGAL or OUT_OF_BOUNDS identifier", () => {
    try {
      Multiplier.of(0.5);
    } catch (err) {
      expect(err).toBeInstanceOf(MultiplierOutOfBoundsError);
      expect((err as MultiplierOutOfBoundsError).code).toBe("MULTIPLIER_OUT_OF_BOUNDS");
    }
  });
});

describe("CrashPoint VO", () => {
  test("CrashPoint.of(0.5) throws CrashPointOutOfBoundsError", () => {
    expect(() => CrashPoint.of(0.5)).toThrow(CrashPointOutOfBoundsError);
  });

  test("CrashPoint.of(2.34).toCentiX() === 234", () => {
    expect(CrashPoint.of(2.34).toCentiX()).toBe(234);
  });

  test("CrashPoint stores centiX and round-trips toNumber", () => {
    const cp = CrashPoint.of(15.78);
    expect(cp.toCentiX()).toBe(1578);
    expect(cp.toNumber()).toBe(15.78);
  });

  test("CrashPoint.fromCentiX rebuilds equivalently", () => {
    const cp = CrashPoint.fromCentiX(550);
    expect(cp.toNumber()).toBe(5.5);
    expect(cp.toCentiX()).toBe(550);
  });

  test("CrashPoint.of above 1e9 throws", () => {
    expect(() => CrashPoint.of(1e9 + 1)).toThrow(CrashPointOutOfBoundsError);
  });

  test("CrashPoint.of(NaN) throws", () => {
    expect(() => CrashPoint.of(Number.NaN)).toThrow(CrashPointOutOfBoundsError);
  });

  test("error code", () => {
    try {
      CrashPoint.of(0.1);
    } catch (err) {
      expect((err as CrashPointOutOfBoundsError).code).toBe("CRASH_POINT_OUT_OF_BOUNDS");
    }
  });
});

describe("BetAmount guard", () => {
  test("BetAmount.of(Money.of(50n)) throws (below default 100)", () => {
    expect(() => BetAmount.of(Money.of(50n))).toThrow(BetAmountOutOfBoundsError);
  });

  test("BetAmount.of(Money.of(100n)) accepted", () => {
    const m = BetAmount.of(Money.of(100n));
    expect(m.toCents()).toBe(100n);
  });

  test("BetAmount.of(Money.of(100_001n)) throws (above default 100000)", () => {
    expect(() => BetAmount.of(Money.of(100_001n))).toThrow(BetAmountOutOfBoundsError);
  });

  test("BetAmount reads env at call time (override flows through)", () => {
    const original = process.env.BET_MIN_CENTS;
    process.env.BET_MIN_CENTS = "500";
    try {
      expect(() => BetAmount.of(Money.of(200n))).toThrow(BetAmountOutOfBoundsError);
    } finally {
      process.env.BET_MIN_CENTS = original;
    }
  });

  test("error carries amountCents/min/max metadata", () => {
    try {
      BetAmount.of(Money.of(50n));
    } catch (err) {
      const e = err as BetAmountOutOfBoundsError;
      expect(e.code).toBe("BET_AMOUNT_OUT_OF_BOUNDS");
      expect(e.amountCents).toBe(50n);
      expect(e.min).toBe(100n);
      expect(e.max).toBe(100_000n);
    }
  });
});

describe("RoundStatus + BetStatus", () => {
  test("ROUND_STATUSES exposes all four statuses in order", () => {
    expect(ROUND_STATUSES).toEqual(["BETTING", "RUNNING", "CRASHED", "SETTLED"]);
  });

  test("BET_STATUSES exposes all five bet statuses", () => {
    expect(BET_STATUSES).toEqual(["PENDING", "ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"]);
  });
});

describe("isValidSeedHex", () => {
  test("64-char lowercase hex passes", () => {
    expect(isValidSeedHex("a".repeat(64))).toBe(true);
    expect(isValidSeedHex("0123456789abcdef".repeat(4))).toBe(true);
  });

  test("wrong length fails", () => {
    expect(isValidSeedHex("a".repeat(63))).toBe(false);
    expect(isValidSeedHex("a".repeat(65))).toBe(false);
  });

  test("non-hex chars fail", () => {
    expect(isValidSeedHex("g".repeat(64))).toBe(false);
    expect(isValidSeedHex("A".repeat(64))).toBe(false);
    expect(isValidSeedHex("")).toBe(false);
  });
});
