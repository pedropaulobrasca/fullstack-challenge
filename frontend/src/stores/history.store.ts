import { create } from "zustand";
import { getConfig } from "@/lib/config";

export type HistoryEntry = {
  roundId: string;
  crashPoint: number;
};

type HistoryState = {
  entries: HistoryEntry[];
  seed: (entries: HistoryEntry[]) => void;
  prependCrash: (entry: HistoryEntry) => void;
};

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  seed: (entries) =>
    set(() => ({ entries: entries.slice(0, getConfig().historySize) })),
  prependCrash: (entry) =>
    set((state) => {
      if (state.entries.some((existing) => existing.roundId === entry.roundId)) {
        return state;
      }
      return {
        entries: [entry, ...state.entries].slice(0, getConfig().historySize),
      };
    }),
}));
