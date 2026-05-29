import { create } from "zustand";
import { getConfig } from "@/lib/config";

export type FeedEntryKind = "placed" | "cashed_out";

export type FeedEntry = {
  id: string;
  roundId: string;
  betId: string;
  playerIdMasked: string;
  kind: FeedEntryKind;
  amount?: { amount: string; currency: string; scale: number };
  multiplier?: number;
  isOwn: boolean;
};

type FeedState = {
  entries: FeedEntry[];
  push: (entry: FeedEntry) => void;
  clear: () => void;
};

export const useFeedStore = create<FeedState>((set) => ({
  entries: [],
  push: (entry) =>
    set((state) => {
      const cap = getConfig().feedBufferSize;
      const next = [entry, ...state.entries];
      return { entries: next.slice(0, cap) };
    }),
  clear: () => set({ entries: [] }),
}));
