import { createZodDto } from "nestjs-zod";
import { z } from "zod";

const roundHistoryEntrySchema = z
  .object({
    roundId: z.string().uuid(),
    nonce: z.string(),
    crashPoint: z.number(),
    settledAt: z.string().datetime(),
    totalBetCount: z.number().int().nonnegative(),
  })
  .strict();

export const roundHistorySchema = z
  .object({
    rounds: z.array(roundHistoryEntrySchema),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .strict();

export class RoundHistoryDto extends createZodDto(roundHistorySchema) {}

export const roundHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
