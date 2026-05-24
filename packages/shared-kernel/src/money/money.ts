import {
  add,
  dinero,
  subtract,
  multiply,
  toSnapshot,
  isNegative,
  isZero,
  equal,
  lessThan,
  greaterThan,
} from "dinero.js/bigint";
import type { Dinero } from "dinero.js/bigint";
import { CRD } from "./currency";
import type { Currency } from "./currency";
import { CurrencyMismatchError, NegativeMoneyError } from "./errors";

export type MoneySnapshot = {
  amount: string;
  currency: string;
  scale: number;
};

export type MoneyMultiplier = number | { numerator: bigint; denominator: bigint };

export class Money {
  private constructor(private readonly inner: Dinero<bigint>) {}

  static of(amountCents: bigint, currency: Currency = CRD): Money {
    if (amountCents < 0n) {
      throw new NegativeMoneyError(amountCents);
    }
    return new Money(dinero({ amount: amountCents, currency }));
  }

  static fromSnapshot(snap: MoneySnapshot, currency: Currency = CRD): Money {
    if (snap.currency !== currency.code) {
      throw new CurrencyMismatchError(currency.code, snap.currency);
    }
    return Money.of(BigInt(snap.amount), currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(add(this.inner, other.inner));
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = subtract(this.inner, other.inner);
    if (isNegative(result)) {
      throw new NegativeMoneyError(toSnapshot(result).amount);
    }
    return new Money(result);
  }

  multiply(factor: MoneyMultiplier): Money {
    const scaled =
      typeof factor === "number"
        ? { amount: BigInt(Math.round(factor * 10_000)), scale: 4n }
        : { amount: factor.numerator, scale: bigintLog10(factor.denominator) };
    return new Money(multiply(this.inner, scaled));
  }

  toCents(): bigint {
    return toSnapshot(this.inner).amount;
  }

  toSnapshot(): MoneySnapshot {
    const snap = toSnapshot(this.inner);
    return {
      amount: snap.amount.toString(),
      currency: snap.currency.code,
      scale: Number(snap.scale),
    };
  }

  toJSON(): MoneySnapshot {
    return this.toSnapshot();
  }

  toString(): string {
    const snap = toSnapshot(this.inner);
    const base = snap.currency.base as bigint;
    const exponent = snap.currency.exponent;
    const divisor = base ** exponent;
    const whole = snap.amount / divisor;
    const fraction = snap.amount % divisor;
    const fractionDigits = fraction.toString().padStart(Number(exponent), "0");
    return `${whole.toString()}.${fractionDigits} ${snap.currency.code}`;
  }

  isZero(): boolean {
    return isZero(this.inner);
  }

  equals(other: Money): boolean {
    if (!this.sameCurrencyAs(other)) {
      return false;
    }
    return equal(this.inner, other.inner);
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return lessThan(this.inner, other.inner);
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return greaterThan(this.inner, other.inner);
  }

  private sameCurrencyAs(other: Money): boolean {
    return toSnapshot(this.inner).currency.code === toSnapshot(other.inner).currency.code;
  }

  private assertSameCurrency(other: Money): void {
    const a = toSnapshot(this.inner).currency.code;
    const b = toSnapshot(other.inner).currency.code;
    if (a !== b) {
      throw new CurrencyMismatchError(a, b);
    }
  }
}

function bigintLog10(value: bigint): bigint {
  if (value <= 0n) {
    return 0n;
  }
  let result = 0n;
  let remaining = value;
  while (remaining >= 10n) {
    remaining /= 10n;
    result += 1n;
  }
  return result;
}
