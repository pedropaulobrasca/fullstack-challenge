import { useEffect } from "react";
import { Money } from "@crash/shared-kernel";
import { useAutoBetStore } from "@/features/auto-bet/auto-bet.store";
import { nextBetAmount } from "@/features/auto-bet/strategy";
import { useWalletStore } from "@/stores/wallet.store";
import { useBetStore } from "@/stores/bet.store";
import { subscribeWsEvent, type WsEvent } from "@/stores/ws-dispatch";
import { dedupedToast } from "@/lib/toast";
import { getConfig } from "@/lib/config";
import { usePlaceBet } from "@/features/bet/use-place-bet";

export type PlaceBetCall = (params: {
  money: Money;
  autoCashoutTarget: number;
}) => Promise<void>;

export type ToastWarning = (key: string, message: string) => void;

export type AutoBetDriverDeps = {
  placeBet: PlaceBetCall;
  toastWarning: ToastWarning;
};

function formatCrd(money: Money): string {
  const snap = money.toSnapshot();
  const cents = BigInt(snap.amount);
  const scale = BigInt(snap.scale);
  const divisor = 10n ** scale;
  const whole = cents / divisor;
  const fraction = cents % divisor;
  const fractionDigits = fraction.toString().padStart(Number(scale), "0");
  return `${whole.toString()}.${fractionDigits} CRD`;
}

function signedCrd(amount: Money, sign: -1 | 0 | 1): string {
  if (sign === 1) {
    return `+${formatCrd(amount)}`;
  }
  if (sign === -1) {
    return `-${formatCrd(amount)}`;
  }
  return formatCrd(amount);
}

function plGreaterOrEqual(plMagnitude: Money, plSign: -1 | 0 | 1, threshold: Money): boolean {
  if (plSign !== 1) {
    return false;
  }
  return plMagnitude.greaterThan(threshold) || plMagnitude.equals(threshold);
}

function plLossExceedsThreshold(plMagnitude: Money, plSign: -1 | 0 | 1, threshold: Money): boolean {
  if (plSign !== -1) {
    return false;
  }
  return plMagnitude.greaterThan(threshold) || plMagnitude.equals(threshold);
}

export async function handleAutoBetEvent(
  event: WsEvent,
  payload: unknown,
  deps: AutoBetDriverDeps,
): Promise<void> {
  if (event === "bet:my_cashed_out") {
    const state = useAutoBetStore.getState();
    if (!state.isRunning) return;
    const data = payload as { payout: { amount: string; currency: string; scale: number } };
    const bet = useBetStore.getState().myBet;
    if (bet === null) return;
    const betAmount = Money.fromSnapshot(bet.amount);
    const payout = Money.fromSnapshot(data.payout);
    state.recordOutcome("win", betAmount, payout);
    return;
  }

  if (event === "bet:my_refunded") {
    const state = useAutoBetStore.getState();
    if (!state.isRunning) return;
    const data = payload as { amount: { amount: string; currency: string; scale: number } };
    const amount = Money.fromSnapshot(data.amount);
    state.recordOutcome("refund", amount, Money.of(0n));
    return;
  }

  if (event === "round:settled") {
    const state = useAutoBetStore.getState();
    if (!state.isRunning) return;
    const bet = useBetStore.getState().myBet;
    if (bet !== null && bet.status === "LOST") {
      state.recordOutcome("loss", Money.fromSnapshot(bet.amount), Money.of(0n));
    }
    return;
  }

  if (event !== "round:started") return;

  const state = useAutoBetStore.getState();
  if (!state.isRunning || state.config === null) return;

  if (plGreaterOrEqual(state.sessionPL, state.sessionPLSign, state.config.stopWin)) {
    state.stop({ reason: "stop-win" });
    deps.toastWarning(
      "stop-win",
      `Stop-win reached. Auto-bet halted at ${signedCrd(state.sessionPL, state.sessionPLSign)}.`,
    );
    return;
  }

  if (plLossExceedsThreshold(state.sessionPL, state.sessionPLSign, state.config.stopLoss)) {
    state.stop({ reason: "stop-loss" });
    deps.toastWarning(
      "stop-loss",
      `Stop-loss reached. Auto-bet halted at ${signedCrd(state.sessionPL, state.sessionPLSign)}.`,
    );
    return;
  }

  const next = nextBetAmount(
    state.config.strategy,
    state.config.baseAmount,
    state.lastOutcome,
    { lastBet: state.lastBetAmount },
  );

  const balanceSnap = useWalletStore.getState().balance;
  const balance = balanceSnap ? Money.fromSnapshot(balanceSnap) : Money.of(0n);
  const betMaxCents = BigInt(getConfig().bet.maxCents);

  if (next.toCents() > balance.toCents() || next.toCents() > betMaxCents) {
    state.stop({ reason: "insufficient-balance" });
    deps.toastWarning(
      "insufficient-balance",
      "Auto-bet halted: insufficient balance for the next bet.",
    );
    return;
  }

  try {
    await deps.placeBet({ money: next, autoCashoutTarget: state.config.target });
    useAutoBetStore.getState().recordPostedBet(next);
  } catch (error: unknown) {
    const key =
      typeof error === "object" && error !== null && "key" in error
        ? (error as { key: string }).key
        : "unknown";
    if (key === "insufficient-balance") {
      useAutoBetStore.getState().stop({ reason: "insufficient-balance" });
      deps.toastWarning(
        "insufficient-balance",
        "Auto-bet halted: insufficient balance for the next bet.",
      );
    }
  }
}

export function useAutoBetDriver(): void {
  const placeBet = usePlaceBet();
  useEffect(() => {
    const deps: AutoBetDriverDeps = {
      placeBet: ({ money, autoCashoutTarget }) =>
        new Promise<void>((resolveCall, rejectCall) => {
          placeBet.mutate(
            { money, autoCashoutTarget },
            {
              onSuccess: () => resolveCall(),
              onError: (err) => rejectCall(err),
            },
          );
        }),
      toastWarning: (key, message) => dedupedToast(key, message),
    };
    const unsubStarted = subscribeWsEvent("round:started", (payload) => {
      void handleAutoBetEvent("round:started", payload, deps);
    });
    const unsubCashed = subscribeWsEvent("bet:my_cashed_out", (payload) => {
      void handleAutoBetEvent("bet:my_cashed_out", payload, deps);
    });
    const unsubRefunded = subscribeWsEvent("bet:my_refunded", (payload) => {
      void handleAutoBetEvent("bet:my_refunded", payload, deps);
    });
    const unsubSettled = subscribeWsEvent("round:settled", (payload) => {
      void handleAutoBetEvent("round:settled", payload, deps);
    });
    return () => {
      unsubStarted();
      unsubCashed();
      unsubRefunded();
      unsubSettled();
    };
  }, [placeBet]);
}
