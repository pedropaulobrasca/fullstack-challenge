import { useMutation } from "@tanstack/react-query";
import { protectedFetch } from "@/lib/api";
import { useBetStore } from "@/stores/bet.store";
import { toastNetwork } from "@/lib/toast";

export type CashoutErrorKey = "network";

export class CashoutError extends Error {
  constructor(readonly key: CashoutErrorKey) {
    super(key);
    this.name = "CashoutError";
  }
}

async function cashout(betId: string): Promise<void> {
  let response: Response;
  try {
    response = await protectedFetch("/games/bet/cashout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ betId }),
    });
  } catch {
    throw new CashoutError("network");
  }

  if (response.ok || response.status === 409) {
    return;
  }
  throw new CashoutError("network");
}

export function useCashout() {
  return useMutation<void, CashoutError, void>({
    mutationFn: () => {
      const betId = useBetStore.getState().myBet?.betId;
      if (betId === undefined) {
        return Promise.resolve();
      }
      return cashout(betId);
    },
    onError: () => {
      toastNetwork();
    },
  });
}
