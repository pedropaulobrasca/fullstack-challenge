import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const confettiMock = vi.fn();
vi.mock("canvas-confetti", () => ({ default: (opts: unknown) => confettiMock(opts) }));

vi.mock("@/features/wallet/use-wallet", () => ({ useWallet: () => ({}) }));

const historyState = { isLoading: false };
vi.mock("@/features/history/use-history", () => ({
  useHistory: () => historyState,
}));

vi.mock("@/auth/oidc", () => ({ enforceLogin: () => undefined }));

vi.mock("@/components/crash-curve", () => ({
  CrashCurve: () => <div data-testid="crash-curve" />,
}));

let matchMediaMatches = false;
function setMatchMedia(matches: boolean) {
  matchMediaMatches = matches;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: matchMediaMatches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

import { Route } from "@/routes/index";
import { useRoundStore } from "@/stores/round.store";
import { useBetStore } from "@/stores/bet.store";
import { useFeedStore } from "@/stores/feed.store";
import { useHistoryStore } from "@/stores/history.store";
import { dedupedToast, clearToastKey } from "@/lib/toast";

const GameRoute = Route.options.component as () => React.ReactElement;

function renderRoute() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GameRoute />
    </QueryClientProvider>,
  );
}

function resetStores() {
  useRoundStore.setState({
    roundId: null,
    status: "IDLE",
    bettingEndsAt: null,
    roundStartedAt: null,
    crashValue: null,
  });
  useBetStore.setState({ myBet: null, pending: false, celebrate: false });
  useFeedStore.setState({ entries: [] });
  useHistoryStore.setState({ entries: [] });
}

beforeEach(() => {
  confettiMock.mockClear();
  setMatchMedia(false);
  historyState.isLoading = false;
  resetStores();
  for (const key of ["insufficient-balance", "bet-window-closed", "network"]) {
    clearToastKey(key);
  }
});

describe("GameRoute layout", () => {
  it("shows the curve-area skeleton while no round snapshot has arrived", () => {
    renderRoute();
    expect(document.querySelector('[data-slot="curve-skeleton"]')).not.toBeNull();
    expect(screen.queryByTestId("crash-curve")).toBeNull();
  });

  it("mounts the CrashCurve once a round exists", () => {
    act(() => {
      useRoundStore.setState({ roundId: "r1", status: "RUNNING", roundStartedAt: Date.now() });
    });
    renderRoute();
    expect(screen.getByTestId("crash-curve")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="curve-skeleton"]')).toBeNull();
  });

  it("renders both the bet rail and the live-feed rail", () => {
    renderRoute();
    expect(document.querySelector('[data-region="bet-rail"]')).not.toBeNull();
    expect(document.querySelector('[data-region="feed-rail"]')).not.toBeNull();
  });

  it("shows the history skeleton while history is loading", () => {
    historyState.isLoading = true;
    renderRoute();
    expect(document.querySelector('[data-slot="history-skeleton"]')).not.toBeNull();
  });
});

describe("GameRoute juice", () => {
  it("fires confetti exactly once when a cashout celebration flag is set and clears it", () => {
    useBetStore.setState({ celebrate: true });
    renderRoute();
    expect(confettiMock).toHaveBeenCalledTimes(1);
    expect(useBetStore.getState().celebrate).toBe(false);
  });

  it("does not fire confetti when reduced-motion is preferred", () => {
    setMatchMedia(true);
    useBetStore.setState({ celebrate: true });
    renderRoute();
    expect(confettiMock).not.toHaveBeenCalled();
  });

  it("renders the crash-flash overlay only while the round is CRASHED", () => {
    act(() => {
      useRoundStore.setState({
        roundId: "r1",
        status: "CRASHED",
        crashValue: 3.21,
      });
    });
    renderRoute();
    expect(document.querySelector('[data-slot="crash-flash"]')).not.toBeNull();
    expect(screen.getByText(/Crashed @ 3\.21x/)).toBeInTheDocument();
  });
});

describe("toast dedupe (integration)", () => {
  it("fires one toast when the same key is raised twice", async () => {
    const sonner = await import("sonner");
    const spy = vi.spyOn(sonner.toast, "warning").mockReturnValue("id");
    dedupedToast("insufficient-balance", "msg");
    dedupedToast("insufficient-balance", "msg");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
