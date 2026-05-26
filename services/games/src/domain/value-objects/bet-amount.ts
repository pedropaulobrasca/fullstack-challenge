import { Money } from "@crash/shared-kernel";
import { BetAmountOutOfBoundsError } from "../errors";

export const BetAmount = {
  of(amount: Money): Money {
    const min = readBigIntEnv("BET_MIN_CENTS", 100n);
    const max = readBigIntEnv("BET_MAX_CENTS", 100_000n);
    const cents = amount.toCents();
    if (cents < min || cents > max) {
      throw new BetAmountOutOfBoundsError({ amountCents: cents, min, max });
    }
    return amount;
  },
};

function readBigIntEnv(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (!/^\d+$/.test(raw)) {
    return fallback;
  }
  return BigInt(raw);
}
