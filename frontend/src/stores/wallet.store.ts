import { create } from "zustand";
import { Money } from "@crash/shared-kernel";
import type { MoneySnapshot } from "@crash/shared-kernel";

type WalletState = {
  balance: MoneySnapshot | null;
  setBalance: (snapshot: MoneySnapshot) => void;
  credit: (snapshot: MoneySnapshot) => void;
};

export const useWalletStore = create<WalletState>((set) => ({
  balance: null,
  setBalance: (snapshot) => set({ balance: snapshot }),
  credit: (snapshot) =>
    set((state) => {
      if (state.balance === null) {
        return state;
      }
      const next = Money.fromSnapshot(state.balance).add(
        Money.fromSnapshot(snapshot),
      );
      return { balance: next.toSnapshot() };
    }),
}));
