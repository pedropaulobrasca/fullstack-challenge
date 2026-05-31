import { DomainError } from "@crash/shared-kernel";
import type { Money, MoneySnapshot } from "@crash/shared-kernel";
import type { CorrelationId, TransactionId, WalletId } from "@crash/shared-kernel/identity";
export type TransactionKind = "DEBIT" | "CREDIT";

export type TransactionProps = {
  walletId: WalletId;
  kind: TransactionKind;
  amount: Money;
  correlationId: CorrelationId;
  messageId: string;
  previousBalance: Money;
  newBalance: Money;
  appliedAt: Date;
};

export type TransactionSnapshot = {
  id: TransactionId;
  walletId: WalletId;
  kind: TransactionKind;
  amount: MoneySnapshot;
  correlationId: CorrelationId;
  messageId: string;
  previousBalance: MoneySnapshot;
  newBalance: MoneySnapshot;
  appliedAt: string;
};

class InvalidTransactionError extends DomainError {
  readonly code = "INVALID_TRANSACTION";
}

export class Transaction {
  private constructor(private readonly props: TransactionProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static record(props: TransactionProps): Transaction {
    if (props.amount.toCents() <= 0n) {
      throw new InvalidTransactionError("Transaction amount must be positive");
    }
    if (props.messageId.trim().length === 0) {
      throw new InvalidTransactionError("Transaction messageId must be a non-empty string");
    }
    if (String(props.correlationId).trim().length === 0) {
      throw new InvalidTransactionError("Transaction correlationId must be a non-empty string");
    }
    return new Transaction(props);
  }

  get id(): TransactionId {
    return this.props.messageId as unknown as TransactionId;
  }

  get walletId(): WalletId {
    return this.props.walletId;
  }

  get kind(): TransactionKind {
    return this.props.kind;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get correlationId(): CorrelationId {
    return this.props.correlationId;
  }

  get messageId(): string {
    return this.props.messageId;
  }

  get previousBalance(): Money {
    return this.props.previousBalance;
  }

  get newBalance(): Money {
    return this.props.newBalance;
  }

  get appliedAt(): Date {
    return this.props.appliedAt;
  }

  toSnapshot(): TransactionSnapshot {
    return {
      id: this.id,
      walletId: this.props.walletId,
      kind: this.props.kind,
      amount: this.props.amount.toSnapshot(),
      correlationId: this.props.correlationId,
      messageId: this.props.messageId,
      previousBalance: this.props.previousBalance.toSnapshot(),
      newBalance: this.props.newBalance.toSnapshot(),
      appliedAt: this.props.appliedAt.toISOString(),
    };
  }
}
