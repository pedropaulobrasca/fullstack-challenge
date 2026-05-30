import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { deriveCrashPointWithHmacHex } from "@crash/contracts/provably-fair-browser";

import { useRecomputeCrashpoint } from "@/features/verify/use-recompute-crashpoint";

const LOCK_SEED = "0000000000000000000000000000000000000000000000000000000000000001";
const LOCK_CLIENT = "test";
const LOCK_NONCE = "0";
const LOCK_CRASH = 2.94;

let lockedHmacHex = "";

beforeEach(async () => {
  if (!lockedHmacHex) {
    const derived = await deriveCrashPointWithHmacHex({
      serverSeed: LOCK_SEED,
      clientSeed: LOCK_CLIENT,
      nonce: BigInt(LOCK_NONCE),
      instantCrashBucket: 101,
    });
    lockedHmacHex = derived.hmacHex;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function lockedResponse(overrides: Partial<{ crashPoint: number; matches: boolean; recomputedCrashPoint: number }> = {}) {
  return {
    roundId: "r1",
    nonce: LOCK_NONCE,
    serverSeed: LOCK_SEED,
    serverSeedHash: "ignored",
    clientSeed: LOCK_CLIENT,
    crashPoint: overrides.crashPoint ?? LOCK_CRASH,
    formulaVersion: 1,
    previousServerSeed: null,
  };
}

describe("useRecomputeCrashpoint", () => {
  it("returns idle when roundId is null", () => {
    const { result } = renderHook(() => useRecomputeCrashpoint(null));
    expect(result.current.status).toBe("idle");
    expect(result.current.verifyResponse).toBeNull();
    expect(result.current.computedCrashPoint).toBeNull();
  });

  it("transitions loading -> computing -> match against the Phase 4 locked-byte fixture", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ kind: "ok", data: lockedResponse() });

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("match");
    });

    expect(result.current.computedCrashPoint).toBe(LOCK_CRASH);
    expect(result.current.computedHmacHex).toBe(lockedHmacHex);
    expect(result.current.computedHmacHex?.length).toBe(64);
    expect(result.current.computedFirst13Hex).toBe(lockedHmacHex.substring(0, 13));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ends in mismatch when the reported crashPoint is tampered with", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ kind: "ok", data: lockedResponse({ crashPoint: 3.5 }) });

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("mismatch");
    });

    expect(result.current.computedCrashPoint).toBe(LOCK_CRASH);
    expect(result.current.verifyResponse?.crashPoint).toBe(3.5);
  });

  it("reports MATCH even when the server claims matches=false (ignores server verdict)", async () => {
    const tamperedServerVerdict = {
      ...lockedResponse(),
      matches: false,
      recomputedCrashPoint: 1.0,
    };
    const fetchSpy = vi.fn().mockResolvedValue({ kind: "ok", data: tamperedServerVerdict });

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("match");
    });
    expect(result.current.computedCrashPoint).toBe(LOCK_CRASH);
  });

  it("surfaces not-settled when the fetch returns the ROUND_NOT_YET_SETTLED branch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ kind: "not-settled" });

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("not-settled");
    });
  });

  it("surfaces not-found when the fetch returns the ROUND_NOT_FOUND branch", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ kind: "not-found" });

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("not-found");
    });
  });

  it("surfaces error with locked network copy on a thrown network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.errorMessage).toBe(
      "Couldn't load round data. Check your connection and try again.",
    );
  });

  it("retry() re-fires the fetch", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ kind: "not-settled" })
      .mockResolvedValueOnce({ kind: "ok", data: lockedResponse() });

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("not-settled");
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("match");
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("catches TypeError when crypto.subtle is unavailable and surfaces locked fallback (Pitfall 4, Test 9)", async () => {
    const originalSubtle = globalThis.crypto?.subtle;
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      get: () => undefined,
    });

    const fetchSpy = vi.fn().mockResolvedValue({ kind: "ok", data: lockedResponse() });

    const { result } = renderHook(() =>
      useRecomputeCrashpoint("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.errorMessage).toBe(
      "Browser cryptography unavailable. Open the app via http://localhost or HTTPS.",
    );

    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: originalSubtle,
    });
  });
});
