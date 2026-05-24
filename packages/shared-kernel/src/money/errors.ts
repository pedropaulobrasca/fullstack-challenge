import { DomainError } from "../errors/domain-error";

export class NegativeMoneyError extends DomainError {
  readonly code = "NEGATIVE_MONEY";

  constructor(amount: bigint | string) {
    super(`Money cannot be negative: ${amount.toString()}`);
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = "CURRENCY_MISMATCH";

  constructor(public readonly expected: string, public readonly actual: string) {
    super(`Currency mismatch: expected ${expected}, got ${actual}`);
  }
}
