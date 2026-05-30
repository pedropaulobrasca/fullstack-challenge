import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import { useRoundDetail, type RoundDetail } from "@/features/replay/use-round-detail";

function withQueryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

const fixture: RoundDetail = {
  roundId: "11111111-1111-1111-1111-111111111111",
  nonce: "0",
  serverSeed:
    "0000000000000000000000000000000000000000000000000000000000000001",
  serverSeedHash: "abc",
  clientSeed: "test",
  crashPoint: 2.94,
  recomputedCrashPoint: 2.94,
  matches: true,
  formulaVersion: 1,
  previousServerSeed: null,
  bets: [],
  growthRate: 0.06,
};

describe("useRoundDetail", () => {
  it("is disabled when roundId is null", async () => {
    const { result } = renderHook(() => useRoundDetail(null), {
      wrapper: withQueryClient(),
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("loads the round detail when roundId is supplied", async () => {
    const fetchImpl = async () => fixture;
    const { result } = renderHook(
      () => useRoundDetail("11111111-1111-1111-1111-111111111111", { fetchImpl }),
      { wrapper: withQueryClient() },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.crashPoint).toBe(2.94);
    expect(Array.isArray(result.current.data?.bets)).toBe(true);
  });

  it("surfaces ROUND_NOT_YET_SETTLED as a typed not-settled error", async () => {
    const fetchImpl = async () => {
      const err = Object.assign(new Error("not settled"), {
        kind: "not-settled" as const,
        message: "not settled",
      });
      throw err;
    };
    const { result } = renderHook(
      () => useRoundDetail("11111111-1111-1111-1111-111111111111", { fetchImpl }),
      { wrapper: withQueryClient() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.kind).toBe("not-settled");
  });
});
