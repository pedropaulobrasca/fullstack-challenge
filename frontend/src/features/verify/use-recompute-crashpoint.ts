import { useCallback, useEffect, useRef, useState } from "react";
import { deriveCrashPointWithHmacHex } from "@crash/contracts/provably-fair-browser";
import { protectedFetch } from "@/lib/api";
import { getConfig } from "@/lib/config";

export type RecomputeStatus =
  | "idle"
  | "loading"
  | "computing"
  | "match"
  | "mismatch"
  | "not-settled"
  | "not-found"
  | "error";

export type VerifyRoundView = {
  roundId: string;
  nonce: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  crashPoint: number;
  formulaVersion: number;
  previousServerSeed: string | null;
};

export type RecomputeState = {
  status: RecomputeStatus;
  verifyResponse: VerifyRoundView | null;
  computedCrashPoint: number | null;
  computedHmacHex: string | null;
  computedFirst13Hex: string | null;
  errorMessage: string | null;
  retry: () => void;
};

const NETWORK_COPY = "Couldn't load round data. Check your connection and try again.";
const CRYPTO_UNAVAILABLE_COPY =
  "Browser cryptography unavailable. Open the app via http://localhost or HTTPS.";

type VerifyErrorBody = {
  code?: string;
  message?: string;
};

async function defaultFetchVerify(
  roundId: string,
  signal: AbortSignal,
): Promise<{ kind: "ok"; data: VerifyRoundView } | { kind: "not-settled" } | { kind: "not-found" } | { kind: "error" }> {
  const response = await protectedFetch(`/games/rounds/${roundId}/verify`, {
    signal,
  });
  if (response.status === 400) {
    const body = (await response.json().catch(() => ({}))) as VerifyErrorBody;
    if (body.code === "ROUND_NOT_YET_SETTLED") return { kind: "not-settled" };
    if (body.code === "ROUND_NOT_FOUND" || body.code === "INVALID_ROUND_ID") {
      return { kind: "not-found" };
    }
    return { kind: "error" };
  }
  if (response.status === 404) return { kind: "not-found" };
  if (!response.ok) return { kind: "error" };
  const data = (await response.json()) as VerifyRoundView;
  return { kind: "ok", data };
}

type RecomputeDeps = {
  fetchVerifyImpl?: typeof defaultFetchVerify;
};

export function useRecomputeCrashpoint(
  roundId: string | null,
  deps: RecomputeDeps = {},
): RecomputeState {
  const [status, setStatus] = useState<RecomputeStatus>("idle");
  const [verifyResponse, setVerifyResponse] = useState<VerifyRoundView | null>(null);
  const [computedCrashPoint, setComputedCrashPoint] = useState<number | null>(null);
  const [computedHmacHex, setComputedHmacHex] = useState<string | null>(null);
  const [computedFirst13Hex, setComputedFirst13Hex] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const fetchRef = useRef(deps.fetchVerifyImpl);
  fetchRef.current = deps.fetchVerifyImpl;

  const retry = useCallback(() => {
    setVersion((n) => n + 1);
  }, []);

  useEffect(() => {
    if (roundId === null) {
      setStatus("idle");
      setVerifyResponse(null);
      setComputedCrashPoint(null);
      setComputedHmacHex(null);
      setComputedFirst13Hex(null);
      setErrorMessage(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      setStatus("loading");
      setVerifyResponse(null);
      setComputedCrashPoint(null);
      setComputedHmacHex(null);
      setComputedFirst13Hex(null);
      setErrorMessage(null);

      const impl = fetchRef.current ?? defaultFetchVerify;
      let fetchResult: Awaited<ReturnType<typeof defaultFetchVerify>>;
      try {
        fetchResult = await impl(roundId, controller.signal);
      } catch {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(NETWORK_COPY);
        return;
      }

      if (cancelled) return;

      if (fetchResult.kind === "not-settled") {
        setStatus("not-settled");
        return;
      }
      if (fetchResult.kind === "not-found") {
        setStatus("not-found");
        return;
      }
      if (fetchResult.kind === "error") {
        setStatus("error");
        setErrorMessage(NETWORK_COPY);
        return;
      }

      const response = fetchResult.data;
      setVerifyResponse(response);
      setStatus("computing");

      let derived: { crashPoint: number; hmacHex: string; first13Hex: string };
      try {
        derived = await deriveCrashPointWithHmacHex({
          serverSeed: response.serverSeed,
          clientSeed: response.clientSeed,
          nonce: BigInt(response.nonce),
          instantCrashBucket: getConfig().fairness.instantCrashBucket,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof TypeError) {
          setStatus("error");
          setErrorMessage(CRYPTO_UNAVAILABLE_COPY);
          return;
        }
        throw err;
      }

      if (cancelled) return;
      setComputedCrashPoint(derived.crashPoint);
      setComputedHmacHex(derived.hmacHex);
      setComputedFirst13Hex(derived.first13Hex);
      setStatus(derived.crashPoint === response.crashPoint ? "match" : "mismatch");
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roundId, version]);

  return {
    status,
    verifyResponse,
    computedCrashPoint,
    computedHmacHex,
    computedFirst13Hex,
    errorMessage,
    retry,
  };
}
