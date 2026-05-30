import { create } from "zustand";

export type Verdict = "MATCH" | "MISMATCH";

const RECENTLY_VERIFIED_TTL_MS = 4000;

type FairnessState = {
  verdicts: Map<string, Verdict>;
  recentlyVerifiedRoundId: string | null;
  recentlyVerifiedExpiresAt: number | null;
  drawerOpen: boolean;
};

type FairnessActions = {
  recordVerdict: (roundId: string, verdict: Verdict) => void;
  clearRecentlyVerified: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
};

export const initialFairnessState: FairnessState = {
  verdicts: new Map(),
  recentlyVerifiedRoundId: null,
  recentlyVerifiedExpiresAt: null,
  drawerOpen: false,
};

export const useFairnessStore = create<FairnessState & FairnessActions>((set) => ({
  ...initialFairnessState,
  recordVerdict: (roundId, verdict) =>
    set((state) => {
      const verdicts = new Map(state.verdicts);
      verdicts.set(roundId, verdict);
      if (verdict === "MATCH") {
        return {
          verdicts,
          recentlyVerifiedRoundId: roundId,
          recentlyVerifiedExpiresAt: Date.now() + RECENTLY_VERIFIED_TTL_MS,
        };
      }
      return { verdicts };
    }),
  clearRecentlyVerified: () =>
    set({ recentlyVerifiedRoundId: null, recentlyVerifiedExpiresAt: null }),
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
}));

export function selectVerdict(
  state: FairnessState,
  roundId: string,
): Verdict | undefined {
  return state.verdicts.get(roundId);
}

export function selectRecentlyVerified(
  state: FairnessState,
  roundId: string,
  now: number = Date.now(),
): boolean {
  return (
    state.recentlyVerifiedRoundId === roundId &&
    state.recentlyVerifiedExpiresAt !== null &&
    now < state.recentlyVerifiedExpiresAt
  );
}
