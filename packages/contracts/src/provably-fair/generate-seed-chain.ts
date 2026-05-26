import { createHash, randomBytes } from "node:crypto";
import type { SeedChainEntry } from "./types";

export function generateSeedChain(length: bigint, finalSeed?: string): SeedChainEntry[] {
  if (length <= 0n) {
    throw new Error("generateSeedChain: length must be greater than zero");
  }

  const size = Number(length);
  const result: SeedChainEntry[] = new Array(size);

  const terminalSeed = finalSeed ?? randomBytes(32).toString("hex");
  result[size - 1] = {
    nonce: length - 1n,
    seed: terminalSeed,
    hash: sha256Hex(terminalSeed),
  };

  for (let i = size - 2; i >= 0; i--) {
    const nextSeed = result[i + 1]!.seed;
    const seed = sha256Hex(nextSeed);
    result[i] = {
      nonce: BigInt(i),
      seed,
      hash: sha256Hex(seed),
    };
  }

  return result;
}

function sha256Hex(hexInput: string): string {
  return createHash("sha256").update(hexInput, "hex").digest("hex");
}
