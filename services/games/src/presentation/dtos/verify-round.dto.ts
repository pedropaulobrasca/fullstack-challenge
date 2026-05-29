import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { roundBetViewSchema } from "./round-bet-view.dto";

export const verifyRoundSchema = z
  .object({
    roundId: z.string().uuid(),
    nonce: z.string(),
    serverSeed: z.string(),
    serverSeedHash: z.string(),
    clientSeed: z.string(),
    crashPoint: z.number(),
    recomputedCrashPoint: z.number(),
    matches: z.boolean(),
    formulaVersion: z.number().int(),
    previousServerSeed: z.string().nullable(),
    bets: z.array(roundBetViewSchema),
    growthRate: z.number().positive(),
  })
  .strict();

export class VerifyRoundDto extends createZodDto(verifyRoundSchema) {}
