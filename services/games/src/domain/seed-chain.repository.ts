export type SeedChainEntry = {
  nonce: bigint;
  hash: string;
};

export interface SeedChainRepository {
  countEntries(): Promise<bigint>;
  insertChain(entries: SeedChainEntry[]): Promise<void>;
  findHashByNonce(nonce: bigint): Promise<string | null>;
  findSeedByNonce(nonce: bigint): Promise<string | null>;
  revealSeedAtNonce(
    nonce: bigint,
    seed: string,
    revealedAt: Date,
    txEm?: unknown,
  ): Promise<void>;
}
