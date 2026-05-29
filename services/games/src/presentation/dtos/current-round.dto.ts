import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { roundBetViewSchema } from "./round-bet-view.dto";

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
    bets: z.array(roundBetViewSchema),
  })
  .strict();

export class CurrentRoundDto extends createZodDto(currentRoundSchema) {}
