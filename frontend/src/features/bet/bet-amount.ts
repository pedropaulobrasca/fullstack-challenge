import { Money, CRD } from "@crash/shared-kernel";
import { getConfig } from "@/lib/config";

export type BetAmountResult =
  | { ok: true; money: Money }
  | { ok: false; reason: "invalid" | "below-min" | "above-max" };

function buildDecimalPattern(fractionDigits: number): RegExp {
  return new RegExp(`^\\d+(\\.\\d{1,${fractionDigits}})?$`);
}

function toCents(raw: string, fractionExponent: bigint): bigint {
  const [whole = "0", fraction = ""] = raw.split(".");
  const padded = fraction.padEnd(Number(fractionExponent), "0");
  const radix = Array.isArray(CRD.base) ? CRD.base[0] : (CRD.base as bigint);
  const base = radix ** fractionExponent;
  return BigInt(whole) * base + BigInt(padded);
}

export function parseBetAmount(raw: string): BetAmountResult {
  const trimmed = raw.trim();
  const fractionExponent = CRD.exponent;
  const pattern = buildDecimalPattern(Number(fractionExponent));
  if (trimmed === "" || !pattern.test(trimmed)) {
    return { ok: false, reason: "invalid" };
  }

  const { bet, currencyCode } = getConfig();
  const money = Money.of(toCents(trimmed, fractionExponent), CRD);
  const min = Money.of(BigInt(bet.minCents), CRD);
  const max = Money.of(BigInt(bet.maxCents), CRD);

  if (currencyCode !== CRD.code) {
    return { ok: false, reason: "invalid" };
  }
  if (money.lessThan(min)) {
    return { ok: false, reason: "below-min" };
  }
  if (money.greaterThan(max)) {
    return { ok: false, reason: "above-max" };
  }
  return { ok: true, money };
}
