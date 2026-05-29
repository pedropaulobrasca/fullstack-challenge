import { create } from "zustand";

export type RoundStatus = "BETTING" | "RUNNING" | "CRASHED" | "SETTLED" | "IDLE";

type RoundState = {
  roundId: string | null;
  status: RoundStatus;
  bettingEndsAt: number | null;
  roundStartedAt: number | null;
  crashValue: number | null;
  setBetting: (params: { roundId: string; bettingEndsAt: number }) => void;
  setRunning: (params: { roundId: string; roundStartedAt: number }) => void;
  setCrashed: (params: { roundId: string; crashValue: number }) => void;
  setSettled: (params: { roundId: string }) => void;
  applySnapshot: (params: {
    roundId: string;
    status: RoundStatus;
    bettingEndsAt: number | null;
    roundStartedAt: number | null;
    crashValue: number | null;
  }) => void;
};

export const useRoundStore = create<RoundState>((set) => ({
  roundId: null,
  status: "IDLE",
  bettingEndsAt: null,
  roundStartedAt: null,
  crashValue: null,
  setBetting: ({ roundId, bettingEndsAt }) =>
    set({
      roundId,
      status: "BETTING",
      bettingEndsAt,
      roundStartedAt: null,
      crashValue: null,
    }),
  setRunning: ({ roundId, roundStartedAt }) =>
    set({ roundId, status: "RUNNING", roundStartedAt, crashValue: null }),
  setCrashed: ({ roundId, crashValue }) =>
    set({ roundId, status: "CRASHED", crashValue }),
  setSettled: ({ roundId }) => set({ roundId, status: "SETTLED" }),
  applySnapshot: ({ roundId, status, bettingEndsAt, roundStartedAt, crashValue }) =>
    set({ roundId, status, bettingEndsAt, roundStartedAt, crashValue }),
}));
