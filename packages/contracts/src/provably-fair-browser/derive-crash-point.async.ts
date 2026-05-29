import { HEX_CHARS, TWO_POW_52 } from "../provably-fair/formulas.constants";
import type { DeriveCrashPointInput } from "../provably-fair/types";
import { bytesToHex } from "./sha256.async";

/**
 * CRITICAL — Pitfall 1 (HMAC key encoding).
 *
 * The backend computes the HMAC-SHA-256 with serverSeed (a HEX STRING) as the
 * key. Node interprets a STRING key as its UTF-8 bytes, NOT as the
 * hex-decoded 32-byte payload. To stay byte-equal in the browser, importKey
 * MUST receive the same UTF-8 bytes (TextEncoder().encode(seed)), NOT
 * hexToBytes(seed). Hex-decoding the key here silently MISMATCHES every round
 * and the Phase 4 oracle (2.94 for seed 0000...0001, client "test", nonce 0n,
 * bucket 101) is the test that catches it.
 *
 * The SHA-256-chain path in sha256.async.ts uses the OPPOSITE encoding —
 * see that file's Pitfall 2 header.
 */
async function computeHmacHexInternal(
  input: DeriveCrashPointInput,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(input.serverSeed);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const messageBytes = encoder.encode(
    `${input.clientSeed}:${input.nonce.toString()}`,
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, messageBytes);
  return bytesToHex(sigBuf);
}

function bustabitCrashFromHmacHex(
  hmacHex: string,
  instantCrashBucket: number,
): number {
  const first13 = hmacHex.substring(0, HEX_CHARS);
  const intH = parseInt(first13, 16);
  if (intH % instantCrashBucket === 0) {
    return 1.0;
  }
  const crash =
    Math.floor((100 * TWO_POW_52 - intH) / (TWO_POW_52 - intH)) / 100;
  return Math.max(1.0, crash);
}

export async function deriveCrashPointAsync(
  input: DeriveCrashPointInput,
): Promise<number> {
  const hmacHex = await computeHmacHexInternal(input);
  return bustabitCrashFromHmacHex(hmacHex, input.instantCrashBucket);
}

export async function deriveCrashPointWithHmacHex(
  input: DeriveCrashPointInput,
): Promise<{ crashPoint: number; hmacHex: string; first13Hex: string }> {
  const hmacHex = await computeHmacHexInternal(input);
  const crashPoint = bustabitCrashFromHmacHex(hmacHex, input.instantCrashBucket);
  return {
    crashPoint,
    hmacHex,
    first13Hex: hmacHex.substring(0, HEX_CHARS),
  };
}
