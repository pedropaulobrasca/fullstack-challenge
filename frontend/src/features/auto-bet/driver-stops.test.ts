import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    bet: { minCents: 100, maxCents: 1000000 },
    currencyCode: "CRD",
    autoBet: { minTarget: 1.01, maxTarget: 100 },
  }),
}));

import { Money } from "@crash/shared-kernel";
import {
  handleAutoBetEvent,
  type AutoBetDriverDeps,
} from "@/features/auto-bet/auto-bet-driver";
import { useAutoBetStore } from "@/features/auto-bet/auto-bet.store";
import { useWalletStore } from "@/stores/wallet.store";
import { useBetStore } from "@/stores/bet.store";

const cents = (n: bigint) => Money.of(n);

const baseConfig = () => ({
  target: 2,
  strategy: "fixed" as const,
  baseAmount: cents(1000n),
  stopLoss: cents(5000n),
  stopWin: cents(5000n),
});

function buildDeps(overrides: Partial<AutoBetDriverDeps> = {}): AutoBetDriverDeps {
  return {
    placeBet: vi.fn().mockResolvedValue(undefined),
    toastWarning: vi.fn(),
    ...overrides,
  };
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
  useWalletStore.setState({
    balance: { amount: "100000", currency: "CRD", scale: 2 },
  });
  useBetStore.setState({ myBet: null, pending: false, celebrate: false });
});

describe("driver — round:started while idle", () => {
  it("does not POST when isRunning=false", async () => {
    const deps = buildDeps();
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    expect(deps.placeBet).not.toHaveBeenCalled();
  });
});

describe("driver — round:started while running", () => {
  it("POSTs next bet with autoCashoutTarget from config", async () => {
    useAutoBetStore.getState().start(baseConfig());
    const deps = buildDeps();
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    expect(deps.placeBet).toHaveBeenCalledTimes(1);
    const mockFn = deps.placeBet as ReturnType<typeof vi.fn>;
    const firstCall = mockFn.mock.calls[0];
    expect(firstCall).toBeDefined();
    const call = firstCall![0] as { money: Money; autoCashoutTarget: number };
    expect(call.money.toCents()).toBe(1000n);
    expect(call.autoCashoutTarget).toBe(2);
  });

  it("records lastBetAmount on successful POST", async () => {
    useAutoBetStore.getState().start(baseConfig());
    const deps = buildDeps();
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    expect(useAutoBetStore.getState().lastBetAmount?.toCents()).toBe(1000n);
  });
});

describe("driver — bet:my_cashed_out", () => {
  it("records win outcome with bet amount from useBetStore.myBet", () => {
    useAutoBetStore.getState().start(baseConfig());
    useBetStore.setState({
      myBet: {
        betId: "b1",
        roundId: "r1",
        amount: { amount: "1000", currency: "CRD", scale: 2 },
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });
    const deps = buildDeps();
    handleAutoBetEvent(
      "bet:my_cashed_out",
      {
        roundId: "r1",
        betId: "b1",
        multiplier: 2.0,
        payout: { amount: "2000", currency: "CRD", scale: 2 },
      },
      deps,
    );
    const state = useAutoBetStore.getState();
    expect(state.lastOutcome).toBe("win");
    expect(state.sessionPL.toCents()).toBe(1000n);
    expect(state.sessionPLSign).toBe(1);
    expect(state.roundCount).toBe(1);
  });
});

describe("driver — bet:my_refunded", () => {
  it("records refund as no-op for PL and round count", () => {
    useAutoBetStore.getState().start(baseConfig());
    useBetStore.setState({
      myBet: {
        betId: "b1",
        roundId: "r1",
        amount: { amount: "1000", currency: "CRD", scale: 2 },
        status: "PENDING",
        cashoutMultiplier: null,
      },
      pending: false,
      celebrate: false,
    });
    const deps = buildDeps();
    handleAutoBetEvent(
      "bet:my_refunded",
      {
        roundId: "r1",
        betId: "b1",
        amount: { amount: "1000", currency: "CRD", scale: 2 },
        reason: "round-cancelled",
      },
      deps,
    );
    const state = useAutoBetStore.getState();
    expect(state.sessionPL.toCents()).toBe(0n);
    expect(state.roundCount).toBe(0);
  });
});

describe("driver — stop-win gate", () => {
  it("halts and toasts amber when sessionPL >= stopWin (no POST fires)", async () => {
    useAutoBetStore.getState().start(baseConfig());
    useAutoBetStore.setState({
      sessionPL: cents(5000n),
      sessionPLSign: 1,
    });
    const deps = buildDeps();
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    expect(deps.placeBet).not.toHaveBeenCalled();
    const state = useAutoBetStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.halted).toEqual({ reason: "stop-win" });
    expect(deps.toastWarning).toHaveBeenCalledWith(
      "stop-win",
      expect.stringContaining("Stop-win reached"),
    );
  });
});

describe("driver — stop-loss gate", () => {
  it("halts and toasts amber when sessionPL (negative) <= -stopLoss (no POST fires)", async () => {
    useAutoBetStore.getState().start(baseConfig());
    useAutoBetStore.setState({
      sessionPL: cents(5000n),
      sessionPLSign: -1,
    });
    const deps = buildDeps();
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    expect(deps.placeBet).not.toHaveBeenCalled();
    const state = useAutoBetStore.getState();
    expect(state.halted).toEqual({ reason: "stop-loss" });
    expect(deps.toastWarning).toHaveBeenCalledWith(
      "stop-loss",
      expect.stringContaining("Stop-loss reached"),
    );
  });
});

describe("driver — balance gate", () => {
  it("halts with insufficient-balance when next bet > wallet balance", async () => {
    useAutoBetStore.getState().start({
      ...baseConfig(),
      baseAmount: cents(200000n),
    });
    useWalletStore.setState({
      balance: { amount: "100000", currency: "CRD", scale: 2 },
    });
    const deps = buildDeps();
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    expect(deps.placeBet).not.toHaveBeenCalled();
    expect(useAutoBetStore.getState().halted).toEqual({
      reason: "insufficient-balance",
    });
    expect(deps.toastWarning).toHaveBeenCalledWith(
      "insufficient-balance",
      expect.stringContaining("insufficient balance"),
    );
  });

  it("halts when next bet exceeds bet.maxCents cap", async () => {
    useAutoBetStore.getState().start({
      ...baseConfig(),
      baseAmount: cents(2000000n),
    });
    useWalletStore.setState({
      balance: { amount: "100000000", currency: "CRD", scale: 2 },
    });
    const deps = buildDeps();
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    expect(deps.placeBet).not.toHaveBeenCalled();
    expect(useAutoBetStore.getState().halted).toEqual({
      reason: "insufficient-balance",
    });
  });
});

describe("driver — POST error handling", () => {
  it("treats 409 (bet-window-closed) as transient: does NOT halt", async () => {
    useAutoBetStore.getState().start(baseConfig());
    const placeBet = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("bet-window-closed"), {
          key: "bet-window-closed",
        }),
      );
    const deps = buildDeps({ placeBet });
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    const state = useAutoBetStore.getState();
    expect(state.isRunning).toBe(true);
    expect(state.halted).toBe(null);
  });

  it("halts on 402 insufficient-balance from server", async () => {
    useAutoBetStore.getState().start(baseConfig());
    const placeBet = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("insufficient-balance"), {
          key: "insufficient-balance",
        }),
      );
    const deps = buildDeps({ placeBet });
    await handleAutoBetEvent("round:started", { roundId: "r1" }, deps);
    const state = useAutoBetStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.halted).toEqual({ reason: "insufficient-balance" });
  });
});
