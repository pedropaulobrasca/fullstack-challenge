import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Money } from "@crash/shared-kernel";
import { BetAmount } from "../../src/domain/value-objects/bet-amount";
import { BetAmountOutOfBoundsError } from "../../src/domain/errors";

describe("BetAmount bounds — REQ-DOM-04", () => {
  describe("default env (BET_MIN_CENTS=100, BET_MAX_CENTS=100000)", () => {
    test("99 cents → throws BetAmountOutOfBoundsError", () => {
      expect(() => BetAmount.of(Money.of(99n))).toThrow(BetAmountOutOfBoundsError);
    });

    test("100 cents (exact min) → accepted", () => {
      const result = BetAmount.of(Money.of(100n));
      expect(result.toCents()).toBe(100n);
    });

    test("100000 cents (exact max) → accepted", () => {
      const result = BetAmount.of(Money.of(100_000n));
      expect(result.toCents()).toBe(100_000n);
    });

    test("100001 cents → throws BetAmountOutOfBoundsError", () => {
      expect(() => BetAmount.of(Money.of(100_001n))).toThrow(BetAmountOutOfBoundsError);
    });

    test("error metadata carries amountCents, min, max", () => {
      try {
        BetAmount.of(Money.of(50n));
        throw new Error("expected to throw");
      } catch (err) {
        const e = err as BetAmountOutOfBoundsError;
        expect(e).toBeInstanceOf(BetAmountOutOfBoundsError);
        expect(e.code).toBe("BET_AMOUNT_OUT_OF_BOUNDS");
        expect(e.amountCents).toBe(50n);
        expect(e.min).toBe(100n);
        expect(e.max).toBe(100_000n);
      }
    });
  });

  describe("env override (BET_MIN_CENTS=500) flows through at call time", () => {
    let original: string | undefined;

    beforeEach(() => {
      original = process.env.BET_MIN_CENTS;
      process.env.BET_MIN_CENTS = "500";
    });

    afterEach(() => {
      if (original === undefined) {
        delete process.env.BET_MIN_CENTS;
      } else {
        process.env.BET_MIN_CENTS = original;
      }
    });

    test("after override, 100 cents (below new min) throws", () => {
      expect(() => BetAmount.of(Money.of(100n))).toThrow(BetAmountOutOfBoundsError);
    });

    test("after override, 500 cents (new min) accepted", () => {
      const result = BetAmount.of(Money.of(500n));
      expect(result.toCents()).toBe(500n);
    });
  });
});
