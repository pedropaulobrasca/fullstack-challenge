import { describe, expect, it, vi, beforeEach } from "vitest";

const warning = vi.fn((_message: string, _opts?: unknown) => "toast-id");
const dismiss = vi.fn((_id: unknown) => undefined);

vi.mock("sonner", () => ({
  toast: {
    warning: (message: string, opts?: unknown) => warning(message, opts),
    dismiss: (id: unknown) => dismiss(id),
  },
}));

import { dedupedToast, clearToastKey } from "@/lib/toast";

const ALL_KEYS = ["insufficient-balance", "bet-window-closed", "network"];

beforeEach(() => {
  for (const key of ALL_KEYS) {
    clearToastKey(key);
  }
  warning.mockClear();
  dismiss.mockClear();
});

describe("dedupedToast", () => {
  it("shows one toast when the same key fires three times in quick succession", () => {
    dedupedToast("insufficient-balance", "msg");
    dedupedToast("insufficient-balance", "msg");
    dedupedToast("insufficient-balance", "msg");

    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("allows the key to show again after the toast is dismissed", () => {
    dedupedToast("network", "msg");
    expect(warning).toHaveBeenCalledTimes(1);

    const opts = warning.mock.calls[0]?.[1] as { onDismiss?: () => void };
    opts?.onDismiss?.();

    dedupedToast("network", "msg");
    expect(warning).toHaveBeenCalledTimes(2);
  });

  it("dedupes per key independently", () => {
    dedupedToast("insufficient-balance", "a");
    dedupedToast("network", "b");
    dedupedToast("insufficient-balance", "a");

    expect(warning).toHaveBeenCalledTimes(2);
  });

  it("clearToastKey dismisses the active toast and frees the key", () => {
    dedupedToast("network", "msg");
    clearToastKey("network");
    expect(dismiss).toHaveBeenCalledTimes(1);

    dedupedToast("network", "msg");
    expect(warning).toHaveBeenCalledTimes(2);
  });
});
