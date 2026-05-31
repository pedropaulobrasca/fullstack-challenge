import { describe, expect, test } from "bun:test";
import { Money } from "@crash/shared-kernel";
import { CorrelationId, WalletId } from "@crash/shared-kernel/identity";
import { Transaction } from "../../src/domain/transaction.aggregate";

const buildValidParams = () => ({
  walletId: WalletId("w-1"),
  kind: "DEBIT" as const,
  amount: Money.of(10_000n),
  correlationId: CorrelationId("corr-1"),
  messageId: "msg-1",
  previousBalance: Money.of(50_000n),
  newBalance: Money.of(40_000n),
  appliedAt: new Date("2026-05-25T12:00:00Z"),
});

describe("Transaction aggregate", () => {
  test("Transaction.record produces a frozen instance exposing every input field via getters", () => {
    const params = buildValidParams();
    const tx = Transaction.record(params);

    expect(tx.walletId).toBe(params.walletId);
    expect(tx.kind).toBe("DEBIT");
    expect(tx.amount.equals(params.amount)).toBe(true);
    expect(tx.correlationId).toBe(params.correlationId);
    expect(tx.messageId).toBe(params.messageId);
    expect(tx.previousBalance.equals(params.previousBalance)).toBe(true);
    expect(tx.newBalance.equals(params.newBalance)).toBe(true);
    expect(tx.appliedAt).toEqual(params.appliedAt);
    expect(Object.isFrozen(tx)).toBe(true);
  });

  test("direct property mutation on Transaction does not change the instance state", () => {
    const tx = Transaction.record(buildValidParams());
    try {
      (tx as unknown as { kind: string }).kind = "CREDIT";
    } catch {
      // strict mode throws — acceptable
    }
    expect(tx.kind).toBe("DEBIT");
  });

  test("toSnapshot returns plain object with MoneySnapshot strings (not bigint) for all amounts", () => {
    const tx = Transaction.record(buildValidParams());
    const snap = tx.toSnapshot();

    expect(typeof snap.amount.amount).toBe("string");
    expect(typeof snap.previousBalance.amount).toBe("string");
    expect(typeof snap.newBalance.amount).toBe("string");
    expect(snap.amount.amount).toBe("10000");
    expect(snap.previousBalance.amount).toBe("50000");
    expect(snap.newBalance.amount).toBe("40000");
    expect(snap.kind).toBe("DEBIT");
    expect(snap.messageId).toBe("msg-1");
    expect(snap.correlationId).toBe("corr-1");
    expect(JSON.stringify(snap)).toContain("\"amount\":\"10000\"");
  });

  test("Transaction.record throws when amount is zero", () => {
    const params = { ...buildValidParams(), amount: Money.of(0n) };
    expect(() => Transaction.record(params)).toThrow();
  });

  test("Transaction.record throws when messageId is empty or whitespace", () => {
    expect(() => Transaction.record({ ...buildValidParams(), messageId: "" })).toThrow();
    expect(() => Transaction.record({ ...buildValidParams(), messageId: "   " })).toThrow();
  });

  test("Transaction.record throws when correlationId is empty or whitespace", () => {
    expect(() =>
      Transaction.record({ ...buildValidParams(), correlationId: CorrelationId("") }),
    ).toThrow();
    expect(() =>
      Transaction.record({ ...buildValidParams(), correlationId: CorrelationId("   ") }),
    ).toThrow();
  });
});
