import { useQuery } from "@tanstack/react-query";
import { protectedFetch } from "@/lib/api";
import type { RoundBetView } from "@/features/replay/round-detail.types";

export type RoundDetail = {
  roundId: string;
  nonce: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  crashPoint: number;
  recomputedCrashPoint: number;
  matches: boolean;
  formulaVersion: number;
  previousServerSeed: string | null;
  bets: RoundBetView[];
  growthRate: number;
};

export type RoundDetailError =
  | { kind: "not-settled"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "network"; message: string };

type VerifyErrorBody = {
  code?: string;
  message?: string;
};

export async function fetchRoundDetail(
  roundId: string,
  signal: AbortSignal,
): Promise<RoundDetail> {
  const response = await protectedFetch(`/games/rounds/${roundId}/verify`, {
    signal,
  });
  if (response.status === 400) {
    const body = (await response.json().catch(() => ({}))) as VerifyErrorBody;
    if (body.code === "ROUND_NOT_YET_SETTLED") {
      const err: Error & RoundDetailError = Object.assign(
        new Error(body.message ?? "Round not yet settled"),
        {
          kind: "not-settled" as const,
          message: body.message ?? "Round not yet settled",
        },
      );
      throw err;
    }
    const err: Error & RoundDetailError = Object.assign(
      new Error(body.message ?? "Bad request"),
      {
        kind: "network" as const,
        message: body.message ?? "Bad request",
      },
    );
    throw err;
  }
  if (response.status === 404) {
    const err: Error & RoundDetailError = Object.assign(new Error("Round not found"), {
      kind: "not-found" as const,
      message: "Round not found",
    });
    throw err;
  }
  if (!response.ok) {
    const err: Error & RoundDetailError = Object.assign(new Error("network"), {
      kind: "network" as const,
      message: "network",
    });
    throw err;
  }
  return (await response.json()) as RoundDetail;
}

type UseRoundDetailDeps = {
  fetchImpl?: (roundId: string, signal: AbortSignal) => Promise<RoundDetail>;
};

export function useRoundDetail(roundId: string | null, deps: UseRoundDetailDeps = {}) {
  const impl = deps.fetchImpl ?? fetchRoundDetail;
  return useQuery<RoundDetail, Error & RoundDetailError>({
    queryKey: ["round-detail", roundId],
    queryFn: ({ signal }) => {
      if (roundId === null) {
        throw new Error("roundId is null");
      }
      return impl(roundId, signal);
    },
    enabled: roundId !== null,
    retry: false,
    staleTime: Infinity,
  });
}
