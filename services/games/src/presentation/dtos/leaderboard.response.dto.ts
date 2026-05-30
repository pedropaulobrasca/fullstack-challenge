import { createZodDto } from "nestjs-zod";
import { leaderboardUpdatedPayloadSchema } from "@crash/contracts/ws";

export const leaderboardResponseSchema = leaderboardUpdatedPayloadSchema;

export class LeaderboardResponseDto extends createZodDto(
  leaderboardResponseSchema,
) {}
