import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { type PropsWithChildren } from "react";
import { PlayerId, maskPlayerId } from "@crash/shared-kernel/identity";
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

const ownSub = "3f29b1a2-4d5e-6f7a-8b9c-0d1e2f3a4b5c";
const otherSub = "11111111-2222-3333-4444-555555555555";

vi.mock("@/auth/oidc", () => ({
  getOidc: vi.fn(async () => ({
    isUserLoggedIn: true,
    getAccessToken: async () => "test-token",
  })),
  useOidc: () => ({
    isUserLoggedIn: true,
    oidcTokens: { decodedIdToken: { sub: ownSub } },
  }),
}));

import { LeaderboardPanel } from "./leaderboard-panel";
import { RankChip } from "./rank-chip";
import { LeaderboardRow } from "./leaderboard-row";
import { dispatchWsEvent } from "@/stores/ws-dispatch";
import type { LeaderboardEntryWire } from "@crash/contracts/ws";

const ownMasked = maskPlayerId(PlayerId(ownSub));
const otherMasked = maskPlayerId(PlayerId(otherSub));

function snap(amount: string) {
  return { amount, currency: "CRD", scale: 2 } as const;
}

function entry(
  rank: number,
  masked: string,
  amount: string,
  winCount = 1,
): LeaderboardEntryWire {
  return {
    playerIdMasked: masked,
    rank,
    netProfit: snap(amount),
    winCount,
    totalBetCount: winCount + 1,
  };
}

function wrapWithClient(client: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren): React.ReactElement {
    return React.createElement(
      QueryClientProvider,
      { client },
      children,
    );
  };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("RankChip", () => {
  it("rank 1 renders with emerald rank-1 border class", () => {
    const { container } = render(<RankChip rank={1} />);
    const el = container.querySelector("[data-slot='rank-chip']")!;
    expect(el).toHaveAttribute("data-rank-color", "rank-1");
    expect(el.textContent).toBe("1");
  });

  it("rank 2 uses cyan rank-2 marker", () => {
    const { container } = render(<RankChip rank={2} />);
    const el = container.querySelector("[data-slot='rank-chip']")!;
    expect(el).toHaveAttribute("data-rank-color", "rank-2");
  });

  it("rank 3 uses muted rank-3 marker", () => {
    const { container } = render(<RankChip rank={3} />);
    const el = container.querySelector("[data-slot='rank-chip']")!;
    expect(el).toHaveAttribute("data-rank-color", "rank-3");
  });

  it("ranks 4-10 use default hairline marker", () => {
    const { container } = render(<RankChip rank={7} />);
    const el = container.querySelector("[data-slot='rank-chip']")!;
    expect(el).toHaveAttribute("data-rank-color", "rank-default");
  });

  it("rank 10 uses the two-digit shape", () => {
    const { container } = render(<RankChip rank={10} />);
    const el = container.querySelector("[data-slot='rank-chip']")!;
    expect(el).toHaveAttribute("data-shape", "rect");
    expect(el.textContent).toBe("10");
  });
});

describe("LeaderboardRow", () => {
  it("renders masked playerId, positive profit with sign + TrendingUp", () => {
    const e = entry(4, otherMasked, "1500", 3);
    const { container } = render(
      <LeaderboardRow entry={e} isOwnRow={false} previousRank={null} />,
    );
    expect(container.textContent).toContain(otherMasked);
    expect(container.textContent).toContain("+");
    expect(container.querySelector("[data-trend='up']")).toBeTruthy();
    expect(container.textContent).toContain("3w");
  });

  it("renders negative profit muted (NOT destructive/red) with leading minus and TrendingDown", () => {
    const e = entry(5, otherMasked, "-2200", 0);
    const { container } = render(
      <LeaderboardRow entry={e} isOwnRow={false} previousRank={null} />,
    );
    const profit = container.querySelector("[data-slot='leaderboard-profit']")!;
    expect(profit.textContent).toContain("−");
    expect(profit.className).not.toMatch(/destructive|text-red/);
    expect(profit.className).toMatch(/muted-foreground/);
    expect(container.querySelector("[data-trend='down']")).toBeTruthy();
  });

  it("renders zero profit muted with no trend icon", () => {
    const e = entry(6, otherMasked, "0", 0);
    const { container } = render(
      <LeaderboardRow entry={e} isOwnRow={false} previousRank={null} />,
    );
    expect(container.querySelector("[data-trend='up']")).toBeFalsy();
    expect(container.querySelector("[data-trend='down']")).toBeFalsy();
  });

  it("own-row prefixes YOU and uses emerald rail data attribute regardless of rank", () => {
    const e = entry(7, ownMasked, "500", 2);
    const { container } = render(
      <LeaderboardRow entry={e} isOwnRow={true} previousRank={null} />,
    );
    expect(container.textContent).toMatch(/YOU \(/);
    const row = container.querySelector("[data-slot='leaderboard-row']")!;
    expect(row).toHaveAttribute("data-own", "true");
  });

  it("fires rank-up transition data attribute when rank improves", () => {
    const e1 = entry(4, otherMasked, "100");
    const { container, rerender } = render(
      <LeaderboardRow entry={e1} isOwnRow={false} previousRank={4} />,
    );
    expect(container.querySelector("[data-rank-up='true']")).toBeFalsy();
    const e2 = entry(2, otherMasked, "100");
    rerender(<LeaderboardRow entry={e2} isOwnRow={false} previousRank={4} />);
    expect(container.querySelector("[data-rank-up='true']")).toBeTruthy();
  });
});

describe("LeaderboardPanel", () => {
  it("renders the Top N · last Wh heading from env-driven config", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [entry(1, otherMasked, "12450", 8)],
          updatedAt: "2026-05-30T12:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
    const client = freshClient();
    render(<LeaderboardPanel isActive={true} />, { wrapper: wrapWithClient(client) });
    expect(screen.getByText(/Top 10 · last 24h/i)).toBeInTheDocument();
  });

  it("shows 5 skeleton rows while loading", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}),
    );
    const client = freshClient();
    const { container } = render(
      <LeaderboardPanel isActive={true} />,
      { wrapper: wrapWithClient(client) },
    );
    expect(container.querySelectorAll("[data-slot='leaderboard-skeleton']").length).toBe(5);
  });

  it("renders empty state copy when entries is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ entries: [], updatedAt: "2026-05-30T12:00:00.000Z" }), {
        status: 200,
      }),
    );
    const client = freshClient();
    render(<LeaderboardPanel isActive={true} />, { wrapper: wrapWithClient(client) });
    await screen.findByText(/No rounds settled in the last 24h yet\./i);
    expect(
      screen.getByText(/The leaderboard updates as players cash out\./i),
    ).toBeInTheDocument();
  });

  it("renders destructive Alert + Retry button on error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    const client = freshClient();
    render(<LeaderboardPanel isActive={true} />, { wrapper: wrapWithClient(client) });
    await screen.findByText(/Couldn't load leaderboard/i);
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("detects own-row via shared maskPlayerId from @crash/shared-kernel", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [
            entry(1, otherMasked, "20000", 5),
            entry(7, ownMasked, "1250", 2),
          ],
          updatedAt: "2026-05-30T12:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
    const client = freshClient();
    const { container } = render(
      <LeaderboardPanel isActive={true} />,
      { wrapper: wrapWithClient(client) },
    );
    await screen.findByText(new RegExp(ownMasked.slice(0, 5)));
    const ownRow = container.querySelector("[data-slot='leaderboard-row'][data-own='true']");
    expect(ownRow).toBeTruthy();
    expect(ownRow!.textContent).toMatch(/YOU \(/);
  });

  it("refresh button triggers a refetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            entries: [entry(1, otherMasked, "1000", 1)],
            updatedAt: "2026-05-30T12:00:00.000Z",
          }),
          { status: 200 },
        ),
      );
    const client = freshClient();
    render(<LeaderboardPanel isActive={true} />, { wrapper: wrapWithClient(client) });
    await screen.findByText(new RegExp(otherMasked));
    const button = screen.getByRole("button", { name: /Refresh leaderboard/i });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("reflects WS leaderboard:updated payload (live update path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          entries: [entry(1, otherMasked, "10000", 4)],
          updatedAt: "2026-05-30T12:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
    const client = freshClient();
    render(<LeaderboardPanel isActive={true} />, { wrapper: wrapWithClient(client) });
    await screen.findByText(new RegExp(otherMasked));
    const newMasked = "aaaaaaaa";
    act(() => {
      dispatchWsEvent("leaderboard:updated", {
        entries: [
          {
            playerIdMasked: newMasked,
            rank: 1,
            netProfit: snap("99999"),
            winCount: 99,
            totalBetCount: 100,
          },
        ],
        updatedAt: "2026-05-30T12:01:00.000Z",
      });
    });
    await screen.findByText(new RegExp(newMasked));
  });
});
