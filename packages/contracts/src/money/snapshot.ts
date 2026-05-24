import { Money, ValidationError } from "@crash/shared-kernel";
import type { MoneySnapshot } from "@crash/shared-kernel";
import { z } from "zod";

export const moneySnapshotSchema = z
  .object({
    amount: z.string().regex(/^-?\d+$/),
    currency: z.string().min(1),
    scale: z.number().int().nonnegative(),
  })
  .strict();

export type MoneySnapshotInput = z.infer<typeof moneySnapshotSchema>;

export function serializeMoney(money: Money): MoneySnapshot {
  return money.toSnapshot();
}

export function parseMoneySnapshot(input: unknown): Money {
  const parsed = moneySnapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Invalid money snapshot: ${parsed.error.message}`,
      parsed.error,
    );
  }
  return Money.fromSnapshot(parsed.data);
}
