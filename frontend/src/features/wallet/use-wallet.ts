import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
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

async function postTopUp(): Promise<MoneySnapshot> {
  const response = await protectedFetch("/wallets/me/topup", { method: "POST" });
  if (response.status === 503) {
    throw new TopUpDisabledError();
  }
  if (!response.ok) {
    throw new Error(`POST /wallets/me/topup failed with ${response.status}`);
  }
  const body = (await response.json()) as WalletResponse;
  return Money.fromSnapshot(body.balance).toSnapshot();
}

export class TopUpDisabledError extends Error {
  constructor() {
    super("top-up-disabled");
    this.name = "TopUpDisabledError";
  }
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

export function useTopUp() {
  const queryClient = useQueryClient();
  const setBalance = useWalletStore((state) => state.setBalance);

  return useMutation<MoneySnapshot, Error, void>({
    mutationFn: postTopUp,
    onSuccess: (snapshot) => {
      setBalance(snapshot);
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
      toast.success("+1000 CRD credited (dev)");
    },
    onError: (error) => {
      if (error instanceof TopUpDisabledError) {
        toast.error("Top-up is disabled on this environment.");
        return;
      }
      toast.error("Top-up failed. Check connection and try again.");
    },
  });
}
