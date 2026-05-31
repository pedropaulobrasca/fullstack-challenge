import { describe, expect, test } from "bun:test";
import { Money } from "@crash/shared-kernel";
import { CorrelationId, PlayerId, WalletId } from "@crash/shared-kernel/identity";
import { Wallet } from "../../src/domain/wallet.aggregate";
import { InsufficientFundsError } from "../../src/domain/errors";

const now = new Date("2026-05-25T12:00:00Z");
const later = new Date("2026-05-25T12:05:00Z");

describe("Wallet aggregate", () => {
  test("Wallet.provision sets balance, ids and timestamps", () => {
    const wallet = Wallet.provision(
      WalletId("w-1"),
      PlayerId("p-1"),
      Money.of(100_000n),
      now,
    );

    expect(wallet.id).toBe(WalletId("w-1"));
    expect(wallet.playerId).toBe(PlayerId("p-1"));
    expect(wallet.balance.toCents()).toBe(100_000n);
    expect(wallet.createdAt).toEqual(now);
    expect(wallet.updatedAt).toEqual(now);
  });

  test("Wallet.rehydrate reconstructs without invoking provisioning factory", () => {
    const wallet = Wallet.rehydrate({
      id: WalletId("w-9"),
      playerId: PlayerId("p-9"),
      balance: Money.of(42n),
      createdAt: now,
      updatedAt: later,
    });

    expect(wallet.id).toBe(WalletId("w-9"));
    expect(wallet.balance.toCents()).toBe(42n);
    expect(wallet.updatedAt).toEqual(later);
  });

  test("wallet.debit returns next snapshot and DEBIT Transaction", () => {
    const wallet = Wallet.provision(
      WalletId("w-1"),
      PlayerId("p-1"),
      Money.of(100_000n),
      now,
    );

    const { next, transaction } = wallet.debit(
      Money.of(40_000n),
      CorrelationId("corr-debit"),
      "msg-debit",
      later,
    );

    expect(next.balance.toCents()).toBe(60_000n);
    expect(next.updatedAt).toEqual(later);
    expect(transaction.kind).toBe("DEBIT");
    expect(transaction.amount.equals(Money.of(40_000n))).toBe(true);
    expect(transaction.previousBalance.equals(wallet.balance)).toBe(true);
    expect(transaction.newBalance.equals(next.balance)).toBe(true);
    expect(transaction.walletId).toBe(wallet.id);
    expect(transaction.correlationId).toBe(CorrelationId("corr-debit"));
    expect(transaction.messageId).toBe("msg-debit");
  });

  test("wallet.debit throws InsufficientFundsError when amount exceeds balance", () => {
    const wallet = Wallet.provision(
      WalletId("w-1"),
      PlayerId("p-1"),
      Money.of(100_000n),
      now,
    );

    try {
      wallet.debit(Money.of(200_000n), CorrelationId("corr-x"), "msg-x", later);
      throw new Error("expected InsufficientFundsError");
    } catch (err) {
      expect(err).toBeInstanceOf(InsufficientFundsError);
      const ife = err as InsufficientFundsError;
      expect(ife.requested.amount).toBe("200000");
      expect(ife.available.amount).toBe("100000");
      expect(ife.playerId).toBe(PlayerId("p-1"));
    }
  });

  test("wallet.credit returns next snapshot and CREDIT Transaction", () => {
    const wallet = Wallet.provision(
      WalletId("w-1"),
      PlayerId("p-1"),
      Money.of(100_000n),
      now,
    );

    const { next, transaction } = wallet.credit(
      Money.of(50_000n),
      CorrelationId("corr-credit"),
      "msg-credit",
      later,
    );

    expect(next.balance.toCents()).toBe(150_000n);
    expect(transaction.kind).toBe("CREDIT");
    expect(transaction.amount.equals(Money.of(50_000n))).toBe(true);
    expect(transaction.previousBalance.equals(wallet.balance)).toBe(true);
    expect(transaction.newBalance.equals(next.balance)).toBe(true);
  });

  test("chained debit then credit on resulting snapshot preserves Money invariants", () => {
    const wallet = Wallet.provision(
      WalletId("w-1"),
      PlayerId("p-1"),
      Money.of(100_000n),
      now,
    );

    const debited = wallet.debit(
      Money.of(30_000n),
      CorrelationId("corr-1"),
      "msg-1",
      later,
    );
    const credited = debited.next.credit(
      Money.of(30_000n),
      CorrelationId("corr-2"),
      "msg-2",
      later,
    );

    expect(credited.next.balance.toCents()).toBe(100_000n);
    expect(credited.transaction.previousBalance.toCents()).toBe(70_000n);
    expect(credited.transaction.newBalance.toCents()).toBe(100_000n);
  });

  test("original wallet instance is unchanged after debit and credit (snapshot semantics)", () => {
    const wallet = Wallet.provision(
      WalletId("w-1"),
      PlayerId("p-1"),
      Money.of(100_000n),
      now,
    );

    wallet.debit(Money.of(40_000n), CorrelationId("c-d"), "m-d", later);
    wallet.credit(Money.of(20_000n), CorrelationId("c-c"), "m-c", later);

    expect(wallet.balance.toCents()).toBe(100_000n);
    expect(wallet.updatedAt).toEqual(now);
  });
});
