import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCountUp } from "@/features/juice/use-count-up";
import { useReducedMotion } from "@/features/juice/use-reduced-motion";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  mockMatchMedia(false);
});

describe("useReducedMotion", () => {
  it("returns true when the reduced-motion query matches", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when the reduced-motion query does not match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});

describe("useCountUp", () => {
  it("snaps to the target instantly when reduced-motion is on", () => {
    mockMatchMedia(true);
    const { result, rerender } = renderHook(
      ({ cents }: { cents: bigint }) => useCountUp(cents),
      { initialProps: { cents: 0n } },
    );

    act(() => {
      rerender({ cents: 5000n });
    });

    expect(result.current.toCents()).toBe(5000n);
  });

  it("renders the value as a Money string, never a bare number", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useCountUp(12345n));
    expect(result.current.toString()).toMatch(/\d+\.\d{2} CRD/);
  });

  it("eventually reaches the target when motion is allowed", async () => {
    vi.useRealTimers();
    mockMatchMedia(false);
    const { result, rerender } = renderHook(
      ({ cents }: { cents: bigint }) => useCountUp(cents),
      { initialProps: { cents: 0n } },
    );

    act(() => {
      rerender({ cents: 1000n });
    });

    await waitFor(
      () => expect(result.current.toCents()).toBe(1000n),
      { timeout: 2000, interval: 25 },
    );
  });
});
