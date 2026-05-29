import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Money } from "@crash/shared-kernel";
import type { MoneySnapshot } from "@crash/shared-kernel";
import { protectedFetch } from "@/lib/api";
import { useWalletStore } from "@/stores/wallet.store";

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
  const query = useQuery({
    queryKey: ["wallet", "me"],
    queryFn: fetchWallet,
  });

  const setBalance = useWalletStore((state) => state.setBalance);

  useEffect(() => {
    if (query.data !== undefined) {
      setBalance(query.data);
    }
  }, [query.data, setBalance]);

  return query;
}
