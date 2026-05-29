import { toast } from "sonner";

const activeKeys = new Map<string, string | number>();

export type ToastKey = "insufficient-balance" | "bet-window-closed" | "network";

const copy: Record<ToastKey, string> = {
  "insufficient-balance": "Not enough balance. Lower your bet or wait for a win.",
  "bet-window-closed": "Betting window closed — your bet was refunded.",
  network: "Connection lost. Reconnecting…",
};

export function dedupedToast(key: string, message: string): void {
  if (activeKeys.has(key)) {
    return;
  }
  const id = toast.warning(message, {
    onDismiss: () => activeKeys.delete(key),
    onAutoClose: () => activeKeys.delete(key),
  });
  activeKeys.set(key, id);
}

export function clearToastKey(key: string): void {
  const id = activeKeys.get(key);
  if (id !== undefined) {
    toast.dismiss(id);
    activeKeys.delete(key);
  }
}

export function toastInsufficientBalance(): void {
  dedupedToast("insufficient-balance", copy["insufficient-balance"]);
}

export function toastBetWindowClosed(): void {
  dedupedToast("bet-window-closed", copy["bet-window-closed"]);
}

export function toastNetwork(): void {
  dedupedToast("network", copy.network);
}
