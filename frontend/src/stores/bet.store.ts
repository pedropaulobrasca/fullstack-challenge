import { create } from "zustand";
import type { MoneySnapshot } from "@crash/shared-kernel";

export type MyBetStatus =
  | "PENDING"
  | "ACTIVE"
  | "CASHED_OUT"
  | "LOST"
  | "REFUNDED";

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
        ? { celebrate: true }
        : {
            myBet: {
              ...state.myBet,
              status: "CASHED_OUT",
              cashoutMultiplier: multiplier,
            },
            celebrate: true,
          },
    ),
  resolveLostForRound: (roundId) =>
    set((state) => {
      if (
        state.myBet === null ||
        state.myBet.roundId !== roundId ||
        state.myBet.status !== "ACTIVE"
      ) {
        return state;
      }
      return { myBet: null };
    }),
  setPending: (pending) => set({ pending }),
  clearCelebration: () => set({ celebrate: false }),
}));
