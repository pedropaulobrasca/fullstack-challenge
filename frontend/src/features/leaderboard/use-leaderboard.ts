import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeaderboardUpdatedPayload } from "@crash/contracts/ws";
import { subscribeWsEvent } from "@/stores/ws-dispatch";
import {
  fetchLeaderboard,
  type LeaderboardResponse,
  type LeaderboardWindow,
} from "./leaderboard-api";

export const leaderboardQueryKey = ["leaderboard", "24h"] as const;

export function useLeaderboard(window: LeaderboardWindow = "24h") {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: leaderboardQueryKey,
    queryFn: () => fetchLeaderboard(window),
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    return subscribeWsEvent("leaderboard:updated", (payload) => {
      queryClient.setQueryData<LeaderboardResponse>(
        leaderboardQueryKey,
        payload as LeaderboardUpdatedPayload,
      );
    });
  }, [queryClient]);

  return query;
}
