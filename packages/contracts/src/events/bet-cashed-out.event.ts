import { z } from "zod";
import { moneySnapshotSchema } from "../money/snapshot";

export const BET_CASHED_OUT_EVENT_TYPE = "bet.cashed_out" as const;

export const betCashedOutEventSchema = z
  .object({
    betId: z.string().uuid(),
    playerId: z.string().min(1),
    roundId: z.string().uuid(),
    amount: moneySnapshotSchema,
    payout: moneySnapshotSchema,
    multiplier: z.number().positive(),
    cashedOutAt: z.string().datetime(),
  })
  .strict();

export type BetCashedOutEventV1 = z.infer<typeof betCashedOutEventSchema>;
