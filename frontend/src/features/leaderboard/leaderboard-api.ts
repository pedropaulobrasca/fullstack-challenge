import {
  leaderboardUpdatedPayloadSchema,
  type LeaderboardUpdatedPayload,
} from "@crash/contracts/ws";
import { protectedFetch } from "@/lib/api";

export type LeaderboardWindow = "24h";

export const leaderboardResponseSchema = leaderboardUpdatedPayloadSchema;
export type LeaderboardResponse = LeaderboardUpdatedPayload;

export async function fetchLeaderboard(
  window: LeaderboardWindow = "24h",
): Promise<LeaderboardResponse> {
  const response = await protectedFetch(`/games/leaderboard?window=${window}`);
  if (!response.ok) {
    throw new Error(`GET /games/leaderboard failed with ${response.status}`);
  }
  const body = await response.json();
  return leaderboardResponseSchema.parse(body);
}
