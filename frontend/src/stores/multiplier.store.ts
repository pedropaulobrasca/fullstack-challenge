import { create } from "zustand";
import { getConfig } from "@/lib/config";

type MultiplierState = {
  serverOffsetMs: number | null;
  reconcileTarget: number;
  renderedMultiplier: number;
  seedOffset: (serverTime: number, now?: number) => void;
  reconcile: (params: { serverTimestamp: number; multiplier: number; now?: number }) => void;
  setRendered: (value: number) => void;
  reset: () => void;
};

export const useMultiplierStore = create<MultiplierState>((set) => ({
  serverOffsetMs: null,
  reconcileTarget: 1,
  renderedMultiplier: 1,
  seedOffset: (serverTime, now = Date.now()) =>
    set({ serverOffsetMs: serverTime - now }),
  reconcile: ({ serverTimestamp, multiplier, now = Date.now() }) =>
    set((state) => {
      const instantaneousOffset = serverTimestamp - now;
      const alpha = getConfig().ewmaAlpha;
      const serverOffsetMs =
        state.serverOffsetMs === null
          ? instantaneousOffset
          : state.serverOffsetMs +
            alpha * (instantaneousOffset - state.serverOffsetMs);
      return { serverOffsetMs, reconcileTarget: multiplier };
    }),
  setRendered: (value) => set({ renderedMultiplier: value }),
  reset: () =>
    set({ serverOffsetMs: null, reconcileTarget: 1, renderedMultiplier: 1 }),
}));
