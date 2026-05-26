// Banker's-rounding (half-to-even) sanity test for Money × factor.
//
// REQ-DOM-07 requires banker's rounding on bet × multiplier. Dinero v2's
// `multiply` is precision-preserving (adds scales) — it does NOT round. To
// produce a currency-exponent result we must follow `multiply` with a scale
// reduction using a half-even divider. Money.multiplyRounded encapsulates
// this and is what Bet.cashOut consumes.
//
// Expected (literal banker's half-to-even at currency-exponent 2):
//   100 × 1.005 → 100  (1.005 → nearest even → 1.00)
//   100 × 1.015 → 102  (1.015 → nearest even → 1.02)
//   100 × 1.025 → 102  (1.025 → nearest even → 1.02)
//   100 × 1.035 → 104  (1.035 → nearest even → 1.04)
//   100 × 1.995 → 200  (1.995 → nearest even → 2.00)
//   100 × 0.5   → 50   (no half-cent residue at scale 2)
//   1 × 333/1000 → 0  (0.333 → 0 at cents, power-of-10 denominator)
//   7 × 333/1000 → 2  (2.331 → 2 at cents)
//
// Contract note: factor.denominator MUST be a power of 10 — the underlying
// Dinero multiplier is { amount, scale } where scale is the decimal exponent.
// Arbitrary rational divisors would require a different reduction path that
// callers (Bet.cashOut uses 10_000n) never need.
import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { Money } from "@crash/shared-kernel";

describe("Money rounding sanity (REQ-DOM-07 — banker's half-to-even)", () => {
  test("100 cents × 1.005 → 100 cents (1.00 by banker's)", () => {
    const result = Money.of(100n).multiplyRounded({ numerator: 1005n, denominator: 1000n });
    expect(result.toCents()).toBe(100n);
  });

  test("100 cents × 1.015 → 102 cents (1.02 by banker's)", () => {
    const result = Money.of(100n).multiplyRounded({ numerator: 1015n, denominator: 1000n });
    expect(result.toCents()).toBe(102n);
  });

  test("100 cents × 1.025 → 102 cents (1.02 by banker's)", () => {
    const result = Money.of(100n).multiplyRounded({ numerator: 1025n, denominator: 1000n });
    expect(result.toCents()).toBe(102n);
  });

  test("100 cents × 1.035 → 104 cents (1.04 by banker's)", () => {
    const result = Money.of(100n).multiplyRounded({ numerator: 1035n, denominator: 1000n });
    expect(result.toCents()).toBe(104n);
  });

  test("100 cents × 1.995 → 200 cents (2.00 by banker's, no tie)", () => {
    const result = Money.of(100n).multiplyRounded({ numerator: 1995n, denominator: 1000n });
    expect(result.toCents()).toBe(200n);
  });

  test("100 cents × 0.5 → 50 cents (no tie)", () => {
    const result = Money.of(100n).multiplyRounded({ numerator: 5n, denominator: 10n });
    expect(result.toCents()).toBe(50n);
  });

  test("1 cent × 0.333 → 0 cents (0.333 cents rounded to 0)", () => {
    const result = Money.of(1n).multiplyRounded({ numerator: 333n, denominator: 1000n });
    expect(result.toCents()).toBe(0n);
  });

  test("7 cents × (333/1000) → 2 cents (2.331 rounded to 2)", () => {
    const result = Money.of(7n).multiplyRounded({ numerator: 333n, denominator: 1000n });
    expect(result.toCents()).toBe(2n);
  });

  test("default mode is banker's (omitted second argument)", () => {
    const explicit = Money.of(100n).multiplyRounded(
      { numerator: 1025n, denominator: 1000n },
      "bankers",
    );
    const implicit = Money.of(100n).multiplyRounded({ numerator: 1025n, denominator: 1000n });
    expect(implicit.toCents()).toBe(explicit.toCents());
  });

  test("half-up mode rounds ties away from zero", () => {
    const result = Money.of(100n).multiplyRounded(
      { numerator: 1025n, denominator: 1000n },
      "half-up",
    );
    expect(result.toCents()).toBe(103n);
  });
});
