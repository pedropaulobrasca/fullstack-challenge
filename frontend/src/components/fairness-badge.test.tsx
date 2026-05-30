import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { FairnessBadge } from "@/components/fairness-badge";
import { useRoundStore } from "@/stores/round.store";
import { useHistoryStore } from "@/stores/history.store";
import {
  initialFairnessState,
  useFairnessStore,
} from "@/features/fairness/fairness.store";

beforeEach(() => {
  useRoundStore.setState({
    roundId: null,
    status: "IDLE",
    bettingEndsAt: null,
    roundStartedAt: null,
    crashValue: null,
  });
  useHistoryStore.setState({ entries: [] });
  useFairnessStore.setState({ ...initialFairnessState, verdicts: new Map() });
});

afterEach(() => {
  useFairnessStore.setState({ ...initialFairnessState, verdicts: new Map() });
});

describe("FairnessBadge", () => {
  it("renders the Fairness label with an accent-classed pulsing dot when commitment is live", () => {
    useRoundStore.setState({ status: "BETTING" });
    render(<FairnessBadge />);
    expect(screen.getByText("Fairness")).toBeInTheDocument();
    const dot = document.querySelector('[data-slot="fairness-dot"]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toMatch(/bg-accent/);
  });

  it("renders a muted-foreground dot between rounds (status IDLE)", () => {
    useRoundStore.setState({ status: "IDLE" });
    render(<FairnessBadge />);
    const dot = document.querySelector('[data-slot="fairness-dot"]');
    expect(dot).not.toBeNull();
    expect(dot!.className).toMatch(/bg-muted-foreground/);
  });

  it("replaces the dot with a CheckCircle2 when recently MATCHed", () => {
    useHistoryStore.setState({
      entries: [{ roundId: "round-prev", crashPoint: 2.41 }],
    });
    useFairnessStore.setState({
      verdicts: new Map([["round-prev", "MATCH"]]),
      recentlyVerifiedRoundId: "round-prev",
      recentlyVerifiedExpiresAt: Date.now() + 10_000,
    });
    render(<FairnessBadge />);
    expect(screen.getByLabelText("verified")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="fairness-dot"]')).toBeNull();
  });

  it("opens the drawer when clicked", () => {
    render(<FairnessBadge />);
    expect(useFairnessStore.getState().drawerOpen).toBe(false);
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Open fairness verification panel" }),
      );
    });
    expect(useFairnessStore.getState().drawerOpen).toBe(true);
  });

  it("has aria-label 'Open fairness verification panel'", () => {
    render(<FairnessBadge />);
    expect(
      screen.getByRole("button", { name: "Open fairness verification panel" }),
    ).toBeInTheDocument();
  });
});
