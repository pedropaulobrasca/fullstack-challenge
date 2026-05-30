import { z } from "zod";
import { moneySnapshotSchema } from "../money/snapshot";

export const leaderboardEntrySchema = z
  .object({
    playerIdMasked: z.string().regex(/^[0-9a-f]{8}$/),
    rank: z.number().int().positive(),
    netProfit: moneySnapshotSchema,
    winCount: z.number().int().nonnegative(),
    totalBetCount: z.number().int().nonnegative(),
  })
  .strict();

export type LeaderboardEntryWire = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardUpdatedPayloadSchema = z
  .object({
    entries: z.array(leaderboardEntrySchema),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type LeaderboardUpdatedPayload = z.infer<
  typeof leaderboardUpdatedPayloadSchema
>;
