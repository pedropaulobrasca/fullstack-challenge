import { z } from "zod";
import { moneySnapshotSchema } from "../money/snapshot";

export const BET_LOST_EVENT_TYPE = "bet.lost" as const;

export const betLostEventSchema = z
  .object({
    betId: z.string().uuid(),
    playerId: z.string().min(1),
    roundId: z.string().uuid(),
    amount: moneySnapshotSchema,
    settledAt: z.string().datetime(),
  })
  .strict();

export type BetLostEventV1 = z.infer<typeof betLostEventSchema>;
