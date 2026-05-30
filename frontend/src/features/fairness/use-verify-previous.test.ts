import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { sha256OfHexEncodedSeed } from "@crash/contracts/provably-fair-browser";

import {
  initialFairnessState,
  useFairnessStore,
} from "@/features/fairness/fairness.store";
import { useVerifyPrevious } from "@/features/fairness/use-verify-previous";

const SEED = "0000000000000000000000000000000000000000000000000000000000000001";

let matchSeedHash = "";

beforeEach(async () => {
  useFairnessStore.setState({
    ...initialFairnessState,
    verdicts: new Map(),
  });
  if (!matchSeedHash) {
    matchSeedHash = await sha256OfHexEncodedSeed(SEED);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useVerifyPrevious", () => {
  it("returns idle when previousRoundId is null", () => {
    const { result } = renderHook(() => useVerifyPrevious(null));
    expect(result.current.status).toBe("idle");
    expect(result.current.previousRoundId).toBeNull();
  });

  it("transitions loading -> computing -> match against the Phase 4 locked-byte fixture", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      serverSeed: SEED,
      serverSeedHash: matchSeedHash,
    });

    const { result } = renderHook(() =>
      useVerifyPrevious("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("match");
    });

    expect(result.current.computedHash).toBe(matchSeedHash);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(useFairnessStore.getState().verdicts.get("r1")).toBe("MATCH");
  });

  it("ends in mismatch when the server-reported hash differs", async () => {
    const corrupted = matchSeedHash.slice(0, -1) + "0";
    const fetchSpy = vi.fn().mockResolvedValue({
      serverSeed: SEED,
      serverSeedHash: corrupted,
    });

    const { result } = renderHook(() =>
      useVerifyPrevious("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("mismatch");
    });

    expect(useFairnessStore.getState().verdicts.get("r1")).toBe("MISMATCH");
  });

  it("surfaces the ROUND_NOT_YET_SETTLED locked copy on 400", async () => {
    const err = new Error("not yet");
    (err as Error & { code?: string }).code = "ROUND_NOT_YET_SETTLED";
    const fetchSpy = vi.fn().mockRejectedValue(err);

    const { result } = renderHook(() =>
      useVerifyPrevious("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.errorCode).toBe("ROUND_NOT_YET_SETTLED");
    expect(result.current.errorMessage).toBe(
      "The previous round is still settling. Try again in a moment.",
    );
  });

  it("returns cached MATCH without calling the fetch", async () => {
    useFairnessStore.setState({
      verdicts: new Map([["r1", "MATCH"]]),
    });
    const fetchSpy = vi.fn();

    const { result } = renderHook(() =>
      useVerifyPrevious("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("match");
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retry() clears the cached verdict and re-fires the fetch", async () => {
    useFairnessStore.setState({
      verdicts: new Map([["r1", "MATCH"]]),
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      serverSeed: SEED,
      serverSeedHash: matchSeedHash,
    });

    const { result } = renderHook(() =>
      useVerifyPrevious("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("match");
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.status).toBe("match");
    });
  });

  it("catches TypeError when crypto.subtle is unavailable and surfaces locked fallback (Pitfall 4)", async () => {
    const originalSubtle = globalThis.crypto?.subtle;
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      get: () => undefined,
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      serverSeed: SEED,
      serverSeedHash: matchSeedHash,
    });

    const { result } = renderHook(() =>
      useVerifyPrevious("r1", { fetchVerifyImpl: fetchSpy }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    expect(result.current.errorCode).toBe("CRYPTO_UNAVAILABLE");
    expect(result.current.errorMessage).toBe(
      "Browser cryptography unavailable. Open the app via http://localhost or HTTPS.",
    );

    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: originalSubtle,
    });
  });
});
