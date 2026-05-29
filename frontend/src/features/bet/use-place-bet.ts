import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Money } from "@crash/shared-kernel";
import { protectedFetch } from "@/lib/api";
import { useBetStore } from "@/stores/bet.store";
import { walletQueryKey } from "@/features/wallet/use-wallet";
import {
  toastInsufficientBalance,
  toastBetWindowClosed,
  toastNetwork,
} from "@/lib/toast";

export type PlaceBetErrorKey =
  | "insufficient-balance"
  | "bet-window-closed"
  | "network";

export class PlaceBetError extends Error {
  constructor(readonly key: PlaceBetErrorKey) {
    super(key);
    this.name = "PlaceBetError";
  }
}

async function placeBet(money: Money): Promise<void> {
  let response: Response;
  try {
    response = await protectedFetch("/games/bet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amountCents: money.toSnapshot().amount }),
    });
  } catch {
    throw new PlaceBetError("network");
  }

  if (response.ok) {
    return;
  }
  if (response.status === 402) {
    throw new PlaceBetError("insufficient-balance");
  }
  if (response.status === 409 || response.status === 410) {
    throw new PlaceBetError("bet-window-closed");
  }
  throw new PlaceBetError("network");
}

export function usePlaceBet() {
  const setPending = useBetStore((state) => state.setPending);
  const queryClient = useQueryClient();

  return useMutation<void, PlaceBetError, Money>({
    mutationFn: placeBet,
    onMutate: () => {
      setPending(true);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    },
    onError: (error) => {
      if (error.key === "insufficient-balance") {
        toastInsufficientBalance();
      } else if (error.key === "bet-window-closed") {
        toastBetWindowClosed();
      } else {
        toastNetwork();
      }
    },
    onSettled: () => {
      setPending(false);
    },
  });
}
