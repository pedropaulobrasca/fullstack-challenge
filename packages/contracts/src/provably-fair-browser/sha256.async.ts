export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  const buf = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Mirrors packages/contracts/src/provably-fair/generate-seed-chain.ts:32-34
 * (Node sha256 with the "hex" update encoding): the input is HEX-DECODED to
 * 32 bytes before hashing. Pitfall 2 anchor — the chain-proof path is the
 * OPPOSITE encoding of the HMAC-key path in deriveCrashPointAsync.
 */
export async function sha256OfHexEncodedSeed(seedHex: string): Promise<string> {
  const digestBuf = await crypto.subtle.digest("SHA-256", hexToBytes(seedHex));
  return bytesToHex(digestBuf);
}
