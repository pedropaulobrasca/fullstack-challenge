import { describe, expect, test } from "bun:test";
import { Money, NegativeMoneyError, ValidationError } from "@crash/shared-kernel";
import { moneySnapshotSchema, parseMoneySnapshot, serializeMoney } from "../src";

describe("MoneySnapshot contract", () => {
  test("serializeMoney returns the canonical wire shape", () => {
    const snapshot = serializeMoney(Money.of(100n));

    expect(snapshot).toEqual({ amount: "100", currency: "CRD", scale: 2 });
  });

  test("parseMoneySnapshot returns a Money whose cents match the wire amount", () => {
    const money = parseMoneySnapshot({ amount: "100", currency: "CRD", scale: 2 });

    expect(money.toCents()).toBe(100n);
  });

  test("parseMoneySnapshot throws ValidationError on missing fields", () => {
    expect(() => parseMoneySnapshot({})).toThrow(ValidationError);
  });

  test("parseMoneySnapshot throws ValidationError when amount is a number not a string", () => {
    expect(() =>
      parseMoneySnapshot({ amount: 100, currency: "CRD", scale: 2 }),
    ).toThrow(ValidationError);
  });

  test("parseMoneySnapshot throws NegativeMoneyError when amount is a shape-valid negative integer", () => {
    expect(() =>
      parseMoneySnapshot({ amount: "-1", currency: "CRD", scale: 2 }),
    ).toThrow(NegativeMoneyError);
  });

  test("serialize and parse round-trip preserves the bigint cents value", () => {
    const samples: bigint[] = [0n, 1n, 100n, 100_000n, 999_999_999n];

    for (const cents of samples) {
      const original = Money.of(cents);
      const wire = JSON.parse(JSON.stringify(serializeMoney(original)));
      const restored = parseMoneySnapshot(wire);

      expect(restored.toCents()).toBe(cents);
      expect(restored.equals(original)).toBe(true);
    }
  });

  test("moneySnapshotSchema is strict and rejects unknown keys", () => {
    expect(() =>
      parseMoneySnapshot({ amount: "100", currency: "CRD", scale: 2, extra: "x" }),
    ).toThrow(ValidationError);
  });
});
