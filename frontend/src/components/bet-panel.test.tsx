import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Money } from "@crash/shared-kernel";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    bet: { minCents: 100, maxCents: 100000 },
    currencyCode: "CRD",
    autoBet: { minTarget: 1.01, maxTarget: 100 },
  }),
}));

import { BetPanel } from "@/components/bet-panel";
import { useAutoBetStore } from "@/features/auto-bet/auto-bet.store";
import { useRoundStore } from "@/stores/round.store";
import { useBetStore } from "@/stores/bet.store";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BetPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAutoBetStore.setState({
    isRunning: false,
    config: null,
    sessionPL: Money.of(0n),
    sessionPLSign: 0,
    lastBetAmount: null,
    lastOutcome: null,
    roundCount: 0,
    halted: null,
  });
  useRoundStore.setState({
    roundId: "r1",
    status: "BETTING",
    bettingEndsAt: Date.now() + 30_000,
    roundStartedAt: null,
    crashValue: null,
  });
  useBetStore.setState({ myBet: null, pending: false, celebrate: false });
});

describe("BetPanel — tab structure", () => {
  it("renders shadcn Tabs with Manual default and 2 triggers", () => {
    renderPanel();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /manual/i })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByRole("tab", { name: /auto/i })).toHaveAttribute(
      "data-state",
      "inactive",
    );
  });

  it("Manual tab default shows the Phase 7 bet form", () => {
    renderPanel();
    expect(screen.getByLabelText("Bet amount")).toBeInTheDocument();
    expect(screen.getByTestId("bet-place-button")).toBeInTheDocument();
  });

  it("clicking Auto reveals the auto-bet form and unmounts the manual form", () => {
    renderPanel();
    const autoTrigger = screen.getByRole("tab", { name: /auto/i });
    fireEvent.keyDown(autoTrigger, { key: "ArrowRight" });
    fireEvent.keyDown(autoTrigger, { key: "Enter" });
    expect(screen.getByLabelText("Target multiplier")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bet amount")).not.toBeInTheDocument();
  });

  it("while running, Manual tab body shows Lock alert and the form is disabled", () => {
    useAutoBetStore.setState({
      isRunning: true,
      config: {
        target: 2,
        strategy: "fixed",
        baseAmount: Money.of(1000n),
        stopLoss: Money.of(5000n),
        stopWin: Money.of(10000n),
      },
      sessionPL: Money.of(0n),
      sessionPLSign: 0,
      lastBetAmount: null,
      lastOutcome: null,
      roundCount: 0,
      halted: null,
    });
    renderPanel();
    expect(
      screen.getByText(/Switch to the Auto tab to stop/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bet amount")).toBeDisabled();
  });
});
