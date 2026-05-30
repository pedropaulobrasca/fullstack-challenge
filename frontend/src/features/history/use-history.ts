import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { useHistoryStore, type HistoryEntry } from "@/stores/history.store";

type HistoryRound = {
  roundId: string;
  crashPoint: number | null;
};

type HistoryResponse = {
  rounds: HistoryRound[];
};

async function fetchHistory(): Promise<HistoryEntry[]> {
  const response = await apiFetch("/games/rounds/history");
  if (!response.ok) {
    throw new Error(`GET /games/rounds/history failed with ${response.status}`);
  }
  const body = (await response.json()) as HistoryResponse;
  return body.rounds
    .filter((round): round is HistoryRound & { crashPoint: number } => round.crashPoint !== null)
    .slice(0, getConfig().historySize)
    .map((round) => ({ roundId: round.roundId, crashPoint: round.crashPoint }));
}

export function useHistory() {
  const query = useQuery({
    queryKey: ["games", "rounds", "history"],
    queryFn: fetchHistory,
  });

  const seed = useHistoryStore((state) => state.seed);
  const prependCrash = useHistoryStore((state) => state.prependCrash);

  useEffect(() => {
    if (query.data !== undefined) {
      seed(query.data);
    }
  }, [query.data, seed]);

  return { ...query, prependCrash };
}
