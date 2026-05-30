import { create } from "zustand";
import { Money } from "@crash/shared-kernel";
import type { AutoBetStrategy, LastOutcome } from "@/features/auto-bet/strategy";

export type HaltReason =
  | "user"
  | "stop-loss"
  | "stop-win"
  | "insufficient-balance";

export type AutoBetConfig = {
  target: number;
  strategy: AutoBetStrategy;
  baseAmount: Money;
  stopLoss: Money;
  stopWin: Money;
};

export type AutoBetOutcome = "win" | "loss" | "refund";

export type AutoBetState = {
  isRunning: boolean;
  config: AutoBetConfig | null;
  sessionPL: Money;
  sessionPLSign: -1 | 0 | 1;
  lastBetAmount: Money | null;
  lastOutcome: LastOutcome;
  roundCount: number;
  halted: { reason: HaltReason } | null;
  start: (config: AutoBetConfig) => void;
  stop: (params?: { reason: HaltReason }) => void;
  recordOutcome: (
    outcome: AutoBetOutcome,
    betAmount: Money,
    payout: Money,
  ) => void;
  recordPostedBet: (amount: Money) => void;
};

function applyDelta(
  currentPL: Money,
  currentSign: -1 | 0 | 1,
  delta: Money,
  deltaSign: -1 | 0 | 1,
): { sessionPL: Money; sessionPLSign: -1 | 0 | 1 } {
  if (deltaSign === 0) {
    return { sessionPL: currentPL, sessionPLSign: currentSign };
  }
  if (currentSign === 0) {
    return { sessionPL: delta, sessionPLSign: deltaSign };
  }
  if (currentSign === deltaSign) {
    return {
      sessionPL: currentPL.add(delta),
      sessionPLSign: currentSign,
    };
  }
  if (currentPL.greaterThan(delta)) {
    return {
      sessionPL: currentPL.subtract(delta),
      sessionPLSign: currentSign,
    };
  }
  if (delta.greaterThan(currentPL)) {
    return {
      sessionPL: delta.subtract(currentPL),
      sessionPLSign: deltaSign,
    };
  }
  return { sessionPL: Money.of(0n), sessionPLSign: 0 };
}

export const useAutoBetStore = create<AutoBetState>((set, get) => ({
  isRunning: false,
  config: null,
  sessionPL: Money.of(0n),
  sessionPLSign: 0,
  lastBetAmount: null,
  lastOutcome: null,
  roundCount: 0,
  halted: null,
  start: (config) =>
    set({
      isRunning: true,
      config,
      sessionPL: Money.of(0n),
      sessionPLSign: 0,
      lastBetAmount: null,
      lastOutcome: null,
      roundCount: 0,
      halted: null,
    }),
  stop: (params) =>
    set({
      isRunning: false,
      halted: params ? { reason: params.reason } : null,
    }),
  recordOutcome: (outcome, betAmount, payout) => {
    const state = get();
    if (!state.isRunning) {
      return;
    }
    if (outcome === "refund") {
      return;
    }
    if (outcome === "win") {
      const winDelta = payout.subtract(betAmount);
      const { sessionPL, sessionPLSign } = applyDelta(
        state.sessionPL,
        state.sessionPLSign,
        winDelta,
        winDelta.isZero() ? 0 : 1,
      );
      set({
        sessionPL,
        sessionPLSign,
        lastBetAmount: betAmount,
        lastOutcome: "win",
        roundCount: state.roundCount + 1,
      });
      return;
    }
    const { sessionPL, sessionPLSign } = applyDelta(
      state.sessionPL,
      state.sessionPLSign,
      betAmount,
      betAmount.isZero() ? 0 : -1,
    );
    set({
      sessionPL,
      sessionPLSign,
      lastBetAmount: betAmount,
      lastOutcome: "loss",
      roundCount: state.roundCount + 1,
    });
  },
  recordPostedBet: (amount) => set({ lastBetAmount: amount }),
}));
