import { Money, NegativeMoneyError } from "@crash/shared-kernel";
import type { CorrelationId, PlayerId, WalletId } from "@crash/shared-kernel/identity";
import { InsufficientFundsError } from "./errors";
import { Transaction } from "./transaction.aggregate";

export type WalletProps = {
  id: WalletId;
  playerId: PlayerId;
  balance: Money;
  createdAt: Date;
  updatedAt: Date;
};

export type WalletMutationResult = {
  next: Wallet;
  transaction: Transaction;
};

export class Wallet {
  private constructor(private readonly props: WalletProps) {}

  static provision(id: WalletId, playerId: PlayerId, initial: Money, now: Date): Wallet {
    return new Wallet({
      id,
      playerId,
      balance: initial,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: WalletProps): Wallet {
    return new Wallet(props);
  }

  get id(): WalletId {
    return this.props.id;
  }

  get playerId(): PlayerId {
    return this.props.playerId;
  }

  get balance(): Money {
    return this.props.balance;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  debit(
    amount: Money,
    correlationId: CorrelationId,
    messageId: string,
    now: Date,
  ): WalletMutationResult {
    let nextBalance: Money;
    try {
      nextBalance = this.props.balance.subtract(amount);
    } catch (err) {
      if (err instanceof NegativeMoneyError) {
        throw new InsufficientFundsError({
          playerId: this.props.playerId,
          requested: amount.toSnapshot(),
          available: this.props.balance.toSnapshot(),
        });
      }
      throw err;
    }

    const next = new Wallet({
      ...this.props,
      balance: nextBalance,
      updatedAt: now,
    });
    const transaction = Transaction.record({
      walletId: this.props.id,
      kind: "DEBIT",
      amount,
      correlationId,
      messageId,
      previousBalance: this.props.balance,
      newBalance: nextBalance,
      appliedAt: now,
    });
    return { next, transaction };
  }

  credit(
    amount: Money,
    correlationId: CorrelationId,
    messageId: string,
    now: Date,
  ): WalletMutationResult {
    const nextBalance = this.props.balance.add(amount);
    const next = new Wallet({
      ...this.props,
      balance: nextBalance,
      updatedAt: now,
    });
    const transaction = Transaction.record({
      walletId: this.props.id,
      kind: "CREDIT",
      amount,
      correlationId,
      messageId,
      previousBalance: this.props.balance,
      newBalance: nextBalance,
      appliedAt: now,
    });
    return { next, transaction };
  }
}
