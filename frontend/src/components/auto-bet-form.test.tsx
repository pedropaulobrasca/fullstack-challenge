import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Money } from "@crash/shared-kernel";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    bet: { minCents: 100, maxCents: 100000 },
    currencyCode: "CRD",
    autoBet: { minTarget: 1.01, maxTarget: 100 },
  }),
}));

import { AutoBetForm } from "@/components/auto-bet-form";
import { useAutoBetStore } from "@/features/auto-bet/auto-bet.store";

function resetStore() {
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
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Target multiplier"), {
    target: { value: "2.00" },
  });
  fireEvent.change(screen.getByLabelText("Base bet"), {
    target: { value: "10.00" },
  });
  fireEvent.change(screen.getByLabelText("Stop-loss"), {
    target: { value: "50.00" },
  });
  fireEvent.change(screen.getByLabelText("Stop-win"), {
    target: { value: "100.00" },
  });
}

beforeEach(() => {
  resetStore();
});

describe("AutoBetForm — idle layout", () => {
  it("renders 5 inputs and a Start button disabled by default", () => {
    render(<AutoBetForm />);
    expect(screen.getByLabelText("Target multiplier")).toBeInTheDocument();
    expect(screen.getByLabelText("Base bet")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop-loss")).toBeInTheDocument();
    expect(screen.getByLabelText("Stop-win")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Strategy" })).toBeInTheDocument();
    const start = screen.getByRole("button", { name: /start auto-bet/i });
    expect(start).toBeDisabled();
  });

  it("defaults the strategy radio to Fixed", () => {
    render(<AutoBetForm />);
    const fixed = screen.getByRole("radio", { name: "Fixed" });
    const martingale = screen.getByRole("radio", { name: "Martingale" });
    expect(fixed).toHaveAttribute("data-state", "checked");
    expect(martingale).toHaveAttribute("data-state", "unchecked");
  });
});

describe("AutoBetForm — validation", () => {
  it("enables Start when all 5 fields are valid", () => {
    render(<AutoBetForm />);
    fillValidForm();
    const start = screen.getByRole("button", { name: /start auto-bet/i });
    expect(start).not.toBeDisabled();
  });

  it("shows muted error on target below min on blur", () => {
    render(<AutoBetForm />);
    const target = screen.getByLabelText("Target multiplier");
    fireEvent.change(target, { target: { value: "0.5" } });
    fireEvent.blur(target);
    const error = screen.getByText(/target must be at least/i);
    expect(error).toHaveClass("text-muted-foreground");
    expect(error.className).not.toMatch(/destructive/);
  });

  it("shows error on base bet above max", () => {
    render(<AutoBetForm />);
    const base = screen.getByLabelText("Base bet");
    fireEvent.change(base, { target: { value: "2000.00" } });
    fireEvent.blur(base);
    expect(screen.getByText(/above the maximum bet/i)).toBeInTheDocument();
  });
});

describe("AutoBetForm — Start click", () => {
  it("calls useAutoBetStore.start with the parsed config", () => {
    render(<AutoBetForm />);
    fillValidForm();
    const start = screen.getByRole("button", { name: /start auto-bet/i });
    fireEvent.click(start);
    const state = useAutoBetStore.getState();
    expect(state.isRunning).toBe(true);
    expect(state.config?.target).toBe(2);
    expect(state.config?.strategy).toBe("fixed");
    expect(state.config?.baseAmount.toCents()).toBe(1000n);
    expect(state.config?.stopLoss.toCents()).toBe(5000n);
    expect(state.config?.stopWin.toCents()).toBe(10000n);
  });
});

describe("AutoBetForm — running state", () => {
  beforeEach(() => {
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
  });

  it("disables all 5 inputs and shows Stop button with destructive border", () => {
    render(<AutoBetForm />);
    expect(screen.getByLabelText("Target multiplier")).toBeDisabled();
    expect(screen.getByLabelText("Base bet")).toBeDisabled();
    expect(screen.getByLabelText("Stop-loss")).toBeDisabled();
    expect(screen.getByLabelText("Stop-win")).toBeDisabled();
    const stop = screen.getByRole("button", { name: /stop auto-bet/i });
    expect(stop).toBeInTheDocument();
    expect(stop.className).toMatch(/border-destructive/);
    expect(stop.className).not.toMatch(/bg-destructive/);
  });

  it("renders the session panel when running", () => {
    render(<AutoBetForm />);
    expect(screen.getByTestId("auto-bet-session-panel")).toBeInTheDocument();
  });

  it("Stop click halts the driver with reason=user, no toast", () => {
    render(<AutoBetForm />);
    fireEvent.click(screen.getByRole("button", { name: /stop auto-bet/i }));
    const state = useAutoBetStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.halted).toEqual({ reason: "user" });
  });
});

describe("AutoBetForm — session panel content", () => {
  function startWithPL(plMagnitude: bigint, sign: -1 | 0 | 1, rounds: number) {
    useAutoBetStore.setState({
      isRunning: true,
      config: {
        target: 2,
        strategy: "fixed",
        baseAmount: Money.of(1000n),
        stopLoss: Money.of(5000n),
        stopWin: Money.of(10000n),
      },
      sessionPL: Money.of(plMagnitude),
      sessionPLSign: sign,
      lastBetAmount: null,
      lastOutcome: null,
      roundCount: rounds,
      halted: null,
    });
  }

  it("renders positive P/L in accent color with leading +", () => {
    startWithPL(1250n, 1, 3);
    render(<AutoBetForm />);
    const panel = screen.getByTestId("auto-bet-session-panel");
    expect(within(panel).getByText(/\+12\.50 CRD/)).toBeInTheDocument();
    expect(within(panel).getByText(/3 rounds/)).toBeInTheDocument();
    const pl = within(panel).getByTestId("session-pl-value");
    expect(pl.className).toMatch(/text-accent|accent/);
    expect(pl.className).not.toMatch(/destructive/);
  });

  it("renders negative P/L in muted-foreground (NOT red)", () => {
    startWithPL(430n, -1, 2);
    render(<AutoBetForm />);
    const panel = screen.getByTestId("auto-bet-session-panel");
    expect(within(panel).getByText(/-4\.30 CRD/)).toBeInTheDocument();
    const pl = within(panel).getByTestId("session-pl-value");
    expect(pl.className).toMatch(/text-muted-foreground/);
    expect(pl.className).not.toMatch(/destructive/);
  });

  it("renders Next bet preview computed from strategy + last outcome", () => {
    useAutoBetStore.setState({
      isRunning: true,
      config: {
        target: 2,
        strategy: "martingale",
        baseAmount: Money.of(1000n),
        stopLoss: Money.of(5000n),
        stopWin: Money.of(10000n),
      },
      sessionPL: Money.of(1000n),
      sessionPLSign: -1,
      lastBetAmount: Money.of(1000n),
      lastOutcome: "loss",
      roundCount: 1,
      halted: null,
    });
    render(<AutoBetForm />);
    const panel = screen.getByTestId("auto-bet-session-panel");
    expect(within(panel).getByText(/Next bet: 20\.00 CRD/)).toBeInTheDocument();
    expect(within(panel).getByText(/martingale, after loss/)).toBeInTheDocument();
  });
});

describe("AutoBetForm — accessibility", () => {
  it("every interactive control is at least 44px tall", () => {
    render(<AutoBetForm />);
    const targets = [
      screen.getByLabelText("Target multiplier"),
      screen.getByLabelText("Base bet"),
      screen.getByLabelText("Stop-loss"),
      screen.getByLabelText("Stop-win"),
      screen.getByRole("button", { name: /start auto-bet/i }),
    ];
    for (const node of targets) {
      expect(node.className).toMatch(/min-h-11|h-11|h-12|min-h-\[44px\]/);
    }
  });
});
