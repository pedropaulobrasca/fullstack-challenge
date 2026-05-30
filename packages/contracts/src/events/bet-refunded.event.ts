import { z } from "zod";
import { moneySnapshotSchema } from "../money/snapshot";

export const BET_REFUNDED_EVENT_TYPE = "bet.refunded" as const;

export const betRefundedEventSchema = z
  .object({
    betId: z.string().uuid(),
    playerId: z.string().min(1),
    roundId: z.string().uuid().optional(),
    amount: moneySnapshotSchema.optional(),
    reason: z.string().min(1),
  })
  .strict();

export type BetRefundedEventV1 = z.infer<typeof betRefundedEventSchema>;
