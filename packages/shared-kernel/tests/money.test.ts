import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { DineroCurrency } from "dinero.js/bigint";
import {
  Money,
  CRD,
  NegativeMoneyError,
  CurrencyMismatchError,
  type MoneySnapshot,
} from "../src";

const USD: DineroCurrency<bigint> = {
  code: "USD",
  base: 10n,
  exponent: 2n,
};

describe("Money VO", () => {
  test("Money.of(100n) constructs and exposes toCents()", () => {
    const money = Money.of(100n);
    expect(money.toCents()).toBe(100n);
  });

  test("Money.of(-1n) throws NegativeMoneyError", () => {
    expect(() => Money.of(-1n)).toThrow(NegativeMoneyError);
  });

  test("Money.of(0n) constructs and isZero() returns true", () => {
    const money = Money.of(0n);
    expect(money.isZero()).toBe(true);
  });

  test("add returns sum at cents granularity", () => {
    const total = Money.of(100n).add(Money.of(50n));
    expect(total.toCents()).toBe(150n);
  });

  test("subtract returns difference at cents granularity", () => {
    const diff = Money.of(100n).subtract(Money.of(50n));
    expect(diff.toCents()).toBe(50n);
  });

  test("subtract that would go negative throws NegativeMoneyError", () => {
    expect(() => Money.of(50n).subtract(Money.of(100n))).toThrow(NegativeMoneyError);
  });

  test("equals returns true for same amount, false otherwise", () => {
    expect(Money.of(100n).equals(Money.of(100n))).toBe(true);
    expect(Money.of(100n).equals(Money.of(101n))).toBe(false);
  });

  test("lessThan compares amounts in same currency", () => {
    expect(Money.of(100n).lessThan(Money.of(200n))).toBe(true);
    expect(Money.of(200n).lessThan(Money.of(100n))).toBe(false);
  });

  test("greaterThan compares amounts in same currency", () => {
    expect(Money.of(100n).greaterThan(Money.of(50n))).toBe(true);
  });

  test("toString formats whole.fraction CRD using exponent 2", () => {
    expect(Money.of(123456n).toString()).toBe("1234.56 CRD");
  });

  test("JSON round-trip via toJSON/fromSnapshot preserves cents", () => {
    const original = Money.of(100_000n);
    const wire = JSON.stringify(original);
    const parsed = JSON.parse(wire) as MoneySnapshot;
    const restored = Money.fromSnapshot(parsed);
    expect(restored.toCents()).toBe(100_000n);
  });

  test("adding two Money values with different currencies throws CurrencyMismatchError", () => {
    const inCrd = Money.of(100n, CRD);
    const inUsd = Money.of(100n, USD);
    expect(() => inCrd.add(inUsd)).toThrow(CurrencyMismatchError);
  });

  test("property: JSON round-trip preserves cents for any non-negative bigint up to 10_000_000", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), (cents) => {
        const original = Money.of(cents);
        const wire = JSON.stringify(original);
        const parsed = JSON.parse(wire) as MoneySnapshot;
        const restored = Money.fromSnapshot(parsed);
        return restored.toCents() === cents;
      }),
    );
  });
});
