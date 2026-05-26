export type SeedChainEntry = {
  nonce: bigint;
  seed: string;
  hash: string;
};

export type DeriveCrashPointInput = {
  serverSeed: string;
  clientSeed: string;
  nonce: bigint;
  instantCrashBucket: number;
};

export type VerifyCrashPointResult = {
  matches: boolean;
  recomputed: number;
};
