import { moneySnapshotSchema } from "@crash/contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const currentRoundBetSchema = z
  .object({
    betId: z.string().uuid(),
    playerIdMasked: z.string(),
    amount: moneySnapshotSchema,
    status: z.enum(["PENDING", "ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"]),
    cashedOutMultiplier: z.number().nullable(),
    payout: moneySnapshotSchema.nullable(),
  })
  .strict();

export const currentRoundSchema = z
  .object({
    roundId: z.string().uuid(),
    status: z.enum(["BETTING", "RUNNING", "CRASHED", "SETTLED"]),
    nonce: z.string(),
    seedHash: z.string(),
    clientSeed: z.string(),
    formulaVersion: z.number().int(),
    bettingEndsAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    crashedAt: z.string().datetime().nullable(),
    settledAt: z.string().datetime().nullable(),
    crashPoint: z.number().nullable(),
    serverSeed: z.string().nullable(),
    currentMultiplier: z.number().nullable(),
    bets: z.array(currentRoundBetSchema),
  })
  .strict();

export class CurrentRoundDto extends createZodDto(currentRoundSchema) {}
