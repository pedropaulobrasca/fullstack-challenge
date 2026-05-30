import { useCallback, useEffect, useRef, useState } from "react";
import { sha256OfHexEncodedSeed } from "@crash/contracts/provably-fair-browser";
import { protectedFetch } from "@/lib/api";
import {
  selectVerdict,
  useFairnessStore,
} from "@/features/fairness/fairness.store";

export type VerifyStatus =
  | "idle"
  | "loading"
  | "computing"
  | "match"
  | "mismatch"
  | "error";

export type VerifyErrorCode =
  | "ROUND_NOT_YET_SETTLED"
  | "CRYPTO_UNAVAILABLE"
  | "NETWORK";

export type VerifyPreviousState = {
  status: VerifyStatus;
  computedHash: string | null;
  previousRoundId: string | null;
  previousServerSeed: string | null;
  previousSeedHash: string | null;
  errorMessage: string | null;
  errorCode: VerifyErrorCode | null;
  retry: () => void;
};

const ROUND_NOT_YET_SETTLED_COPY =
  "The previous round is still settling. Try again in a moment.";
const NETWORK_COPY =
  "Couldn't load round data. Check your connection and try again.";
const CRYPTO_UNAVAILABLE_COPY =
  "Browser cryptography unavailable. Open the app via http://localhost or HTTPS.";

export type VerifyResponse = {
  serverSeed: string;
  serverSeedHash: string;
};

type VerifyErrorBody = {
  code?: string;
  message?: string;
};

async function defaultFetchVerify(
  previousRoundId: string,
  signal: AbortSignal,
): Promise<VerifyResponse> {
  const response = await protectedFetch(
    `/games/rounds/${previousRoundId}/verify`,
    { signal },
  );
  if (response.status === 400) {
    const body = (await response.json().catch(() => ({}))) as VerifyErrorBody;
    const err = new Error(body.message ?? "Round not yet settled");
    (err as Error & { code?: string }).code =
      body.code ?? "ROUND_NOT_YET_SETTLED";
    throw err;
  }
  if (!response.ok) {
    throw new Error("network");
  }
  return (await response.json()) as VerifyResponse;
}

type VerifyDeps = {
  fetchVerifyImpl?: (
    previousRoundId: string,
    signal: AbortSignal,
  ) => Promise<VerifyResponse>;
};

export function useVerifyPrevious(
  previousRoundId: string | null,
  deps: VerifyDeps = {},
): VerifyPreviousState {
  const [status, setStatus] = useState<VerifyStatus>("idle");
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const [previousServerSeed, setPreviousServerSeed] = useState<string | null>(
    null,
  );
  const [previousSeedHash, setPreviousSeedHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VerifyErrorCode | null>(null);
  const [version, setVersion] = useState(0);
  const fetchRef = useRef(deps.fetchVerifyImpl);
  fetchRef.current = deps.fetchVerifyImpl;

  const retry = useCallback(() => {
    if (previousRoundId === null) return;
    useFairnessStore.setState((state) => {
      const verdicts = new Map(state.verdicts);
      verdicts.delete(previousRoundId);
      return { verdicts };
    });
    setVersion((n) => n + 1);
  }, [previousRoundId]);

  useEffect(() => {
    if (previousRoundId === null) {
      setStatus("idle");
      setComputedHash(null);
      setPreviousServerSeed(null);
      setPreviousSeedHash(null);
      setErrorMessage(null);
      setErrorCode(null);
      return;
    }

    const cached = selectVerdict(useFairnessStore.getState(), previousRoundId);
    if (cached !== undefined) {
      setStatus(cached === "MATCH" ? "match" : "mismatch");
      setErrorMessage(null);
      setErrorCode(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      setStatus("loading");
      setErrorMessage(null);
      setErrorCode(null);
      setComputedHash(null);

      let response: VerifyResponse;
      try {
        const impl = fetchRef.current ?? defaultFetchVerify;
        response = await impl(previousRoundId, controller.signal);
      } catch (err) {
        if (cancelled) return;
        const code = (err as Error & { code?: string }).code;
        if (code === "ROUND_NOT_YET_SETTLED") {
          setStatus("error");
          setErrorCode("ROUND_NOT_YET_SETTLED");
          setErrorMessage(ROUND_NOT_YET_SETTLED_COPY);
          return;
        }
        setStatus("error");
        setErrorCode("NETWORK");
        setErrorMessage(NETWORK_COPY);
        return;
      }

      if (cancelled) return;
      setPreviousServerSeed(response.serverSeed);
      setPreviousSeedHash(response.serverSeedHash);
      setStatus("computing");

      let digest: string;
      try {
        digest = await sha256OfHexEncodedSeed(response.serverSeed);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof TypeError) {
          setStatus("error");
          setErrorCode("CRYPTO_UNAVAILABLE");
          setErrorMessage(CRYPTO_UNAVAILABLE_COPY);
          return;
        }
        throw err;
      }

      if (cancelled) return;
      setComputedHash(digest);
      const matches = digest === response.serverSeedHash;
      const verdict = matches ? "match" : "mismatch";
      useFairnessStore
        .getState()
        .recordVerdict(previousRoundId, matches ? "MATCH" : "MISMATCH");
      setStatus(verdict);
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [previousRoundId, version]);

  return {
    status,
    computedHash,
    previousRoundId,
    previousServerSeed,
    previousSeedHash,
    errorMessage,
    errorCode,
    retry,
  };
}
