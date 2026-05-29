import { moneySnapshotSchema } from "@crash/contracts";
import { z } from "zod";

export const roundBetViewSchema = z
  .object({
    betId: z.string().uuid(),
    playerIdMasked: z.string(),
    amount: moneySnapshotSchema,
    status: z.enum(["PENDING", "ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"]),
    cashedOutMultiplier: z.number().nullable(),
    payout: moneySnapshotSchema.nullable(),
  })
  .strict();

export type RoundBetView = z.infer<typeof roundBetViewSchema>;
