import { moneySnapshotSchema } from "@crash/contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const playerBetEntrySchema = z
  .object({
    betId: z.string().uuid(),
    roundId: z.string().uuid(),
    amount: moneySnapshotSchema,
    status: z.enum(["PENDING", "ACTIVE", "CASHED_OUT", "LOST", "REFUNDED"]),
    cashedOutMultiplier: z.number().nullable(),
    payout: moneySnapshotSchema.nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const playerBetsSchema = z
  .object({
    bets: z.array(playerBetEntrySchema),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();

export class PlayerBetsDto extends createZodDto(playerBetsSchema) {}

export const playerBetsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
