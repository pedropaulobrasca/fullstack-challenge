import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Money } from "@crash/shared-kernel";
import type { MoneySnapshot } from "@crash/shared-kernel";
import { protectedFetch } from "@/lib/api";
import { useWalletStore } from "@/stores/wallet.store";
import { registerWalletRefetch } from "@/lib/wallet-refetch";

export const walletQueryKey = ["wallet", "me"] as const;

type WalletResponse = {
  balance: { amount: string; currency: string; scale: number };
};

async function fetchWallet(): Promise<MoneySnapshot> {
  const response = await protectedFetch("/wallets/me");
  if (!response.ok) {
    throw new Error(`GET /wallets/me failed with ${response.status}`);
  }
  const body = (await response.json()) as WalletResponse;
  return Money.fromSnapshot(body.balance).toSnapshot();
}

export function useWallet() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: walletQueryKey,
    queryFn: fetchWallet,
  });

  const setBalance = useWalletStore((state) => state.setBalance);

  useEffect(() => {
    if (query.data !== undefined) {
      setBalance(query.data);
    }
  }, [query.data, setBalance]);

  useEffect(() => {
    return registerWalletRefetch(() => {
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    });
  }, [queryClient]);

  return query;
}
