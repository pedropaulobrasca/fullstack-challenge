import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const leaderboardQuerySchema = z
  .object({
    window: z.enum(["24h"]).default("24h"),
  })
  .strict();

export class LeaderboardQueryDto extends createZodDto(leaderboardQuerySchema) {}
