import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type PropsWithChildren } from "react";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    rest: { base: "http://api.test" },
    leaderboard: {
      sizeN: 10,
      windowHours: 24,
      relativeRefreshMs: 5000,
      rankUpTransitionMs: 200,
    },
  }),
}));

vi.mock("@/auth/oidc", () => ({
  getOidc: vi.fn(async () => ({
    isUserLoggedIn: true,
    getAccessToken: async () => "test-token",
  })),
}));

import { useLeaderboard, leaderboardQueryKey } from "./use-leaderboard";
import { fetchLeaderboard } from "./leaderboard-api";
import { dispatchWsEvent } from "@/stores/ws-dispatch";

const validPayload = {
  entries: [
    {
      playerIdMasked: "bd14a3c2",
      rank: 1,
      netProfit: { amount: "12450", currency: "CRD", scale: 2 },
      winCount: 8,
      totalBetCount: 12,
    },
  ],
  updatedAt: "2026-05-30T12:00:00.000Z",
};

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren): React.ReactElement {
    return React.createElement(
      QueryClientProvider,
      { client },
      children,
    );
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("fetchLeaderboard", () => {
  it("calls /games/leaderboard?window=24h with Authorization Bearer", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(validPayload), { status: 200 }));

    await fetchLeaderboard("24h");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/games/leaderboard?window=24h");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("Zod-parses the response and rejects malformed shapes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ entries: "not-an-array" }), { status: 200 }),
    );
    await expect(fetchLeaderboard("24h")).rejects.toThrow();
  });

  it("throws when HTTP status is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(fetchLeaderboard("24h")).rejects.toThrow();
  });
});

describe("useLeaderboard", () => {
  it("returns isLoading initially and data after fetch resolves", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(validPayload), { status: 200 }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLeaderboard(), { wrapper: wrapper(client) });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data?.entries).toHaveLength(1);
    expect(result.current.data?.entries[0]?.playerIdMasked).toBe("bd14a3c2");
  });

  it("replaces cache inline when WS leaderboard:updated arrives with valid payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(validPayload), { status: 200 }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLeaderboard(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());

    const updated = {
      entries: [
        {
          playerIdMasked: "f9c45a01",
          rank: 1,
          netProfit: { amount: "20000", currency: "CRD", scale: 2 },
          winCount: 10,
          totalBetCount: 14,
        },
      ],
      updatedAt: "2026-05-30T12:01:00.000Z",
    };

    act(() => {
      dispatchWsEvent("leaderboard:updated", updated);
    });

    await waitFor(() => {
      expect(result.current.data?.entries[0]?.playerIdMasked).toBe("f9c45a01");
    });
    expect(client.getQueryData(leaderboardQueryKey)).toEqual(updated);
  });

  it("drops invalid WS payloads without corrupting cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(validPayload), { status: 200 }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLeaderboard(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => {
      dispatchWsEvent("leaderboard:updated", { entries: "broken" });
    });

    expect(result.current.data).toEqual(validPayload);
    expect(warn).toHaveBeenCalled();
  });

  it("refetch() triggers a fresh GET", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(validPayload), { status: 200 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useLeaderboard(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeDefined());

    await act(async () => {
      await result.current.refetch();
    });

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
