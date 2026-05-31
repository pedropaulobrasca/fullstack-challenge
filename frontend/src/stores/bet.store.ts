import { create } from "zustand";
import type { MoneySnapshot } from "@crash/shared-kernel";

export type MyBetStatus =
  | "PENDING"
  | "ACTIVE"
  | "CASHED_OUT"
  | "LOST"
  | "REFUNDED";

export type LastBetOutcome = "CASHED_OUT" | "LOST" | null;

export type MyBet = {
  betId: string;
  roundId: string;
  amount: MoneySnapshot;
  status: MyBetStatus;
  cashoutMultiplier: number | null;
};

type BetState = {
  myBet: MyBet | null;
  pending: boolean;
  celebrate: boolean;
  lastOutcome: LastBetOutcome;
  setMyBet: (bet: MyBet | null) => void;
  setStatus: (status: MyBetStatus) => void;
  setCashedOut: (params: { multiplier: number }) => void;
  resolveLostForRound: (roundId: string) => void;
  setPending: (pending: boolean) => void;
  clearCelebration: () => void;
};

export const useBetStore = create<BetState>((set) => ({
  myBet: null,
  pending: false,
  celebrate: false,
  lastOutcome: null,
  setMyBet: (bet) => set({ myBet: bet, pending: false }),
  setStatus: (status) =>
    set((state) =>
      state.myBet === null
        ? state
        : { myBet: { ...state.myBet, status } },
    ),
  setCashedOut: ({ multiplier }) =>
    set((state) =>
      state.myBet === null
        ? { celebrate: true, lastOutcome: "CASHED_OUT" }
        : {
            myBet: {
              ...state.myBet,
              status: "CASHED_OUT",
              cashoutMultiplier: multiplier,
            },
            celebrate: true,
            lastOutcome: "CASHED_OUT",
          },
    ),
  resolveLostForRound: (roundId) =>
    set((state) => {
      if (state.myBet === null || state.myBet.roundId !== roundId) {
        return state;
      }
      const lastOutcome =
        state.myBet.status === "ACTIVE" ? "LOST" : state.lastOutcome;
      return { myBet: null, lastOutcome };
    }),
  setPending: (pending) => set({ pending }),
  clearCelebration: () => set({ celebrate: false }),
}));
