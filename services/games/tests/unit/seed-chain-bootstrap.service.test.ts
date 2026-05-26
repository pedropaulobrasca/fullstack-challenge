import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import { SeedChainBootstrap } from "../../src/application/seed-chain-bootstrap.service";
import type {
  SeedChainEntry,
  SeedChainRepository,
} from "../../src/domain/seed-chain.repository";

const SMALL_CHAIN_LENGTH = 32n;

class InMemorySeedChainRepository implements SeedChainRepository {
  public readonly stored: SeedChainEntry[] = [];
  public countCalls = 0;
  public insertCalls = 0;

  async countEntries(): Promise<bigint> {
    this.countCalls += 1;
    return BigInt(this.stored.length);
  }

  async insertChain(entries: SeedChainEntry[]): Promise<void> {
    this.insertCalls += 1;
    for (const entry of entries) {
      this.stored.push(entry);
    }
  }

  async findHashByNonce(nonce: bigint): Promise<string | null> {
    const match = this.stored.find((entry) => entry.nonce === nonce);
    return match?.hash ?? null;
  }

  async findSeedByNonce(nonce: bigint): Promise<string | null> {
    const match = this.stored.find((entry) => entry.nonce === nonce);
    return match?.seed ?? null;
  }

  async revealSeedAtNonce(): Promise<void> {
    return;
  }
}

class TestableBootstrap extends SeedChainBootstrap {
  protected resolveChainLength(): bigint {
    return SMALL_CHAIN_LENGTH;
  }
}

describe("SeedChainBootstrap", () => {
  let repo: InMemorySeedChainRepository;
  let service: TestableBootstrap;

  beforeEach(() => {
    repo = new InMemorySeedChainRepository();
    service = new TestableBootstrap(repo);
  });

  test("first boot populates the chain with the configured length", async () => {
    await service.onApplicationBootstrap();

    expect(repo.stored).toHaveLength(Number(SMALL_CHAIN_LENGTH));
    expect(repo.stored[0]!.nonce).toBe(0n);
    expect(repo.stored[Number(SMALL_CHAIN_LENGTH) - 1]!.nonce).toBe(
      SMALL_CHAIN_LENGTH - 1n,
    );
    expect(repo.insertCalls).toBeGreaterThan(0);
    for (const entry of repo.stored) {
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.seed).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("re-running on a populated repository short-circuits without inserting", async () => {
    await service.onApplicationBootstrap();
    const populatedCount = repo.stored.length;
    const insertCallsAfterFirst = repo.insertCalls;

    await service.onApplicationBootstrap();

    expect(repo.stored).toHaveLength(populatedCount);
    expect(repo.insertCalls).toBe(insertCallsAfterFirst);
  });

  test("idempotency guard checks the count before generating", async () => {
    repo.stored.push({
      nonce: 0n,
      hash: "f".repeat(64),
      seed: "0".repeat(64),
    });

    await service.onApplicationBootstrap();

    expect(repo.stored).toHaveLength(1);
    expect(repo.insertCalls).toBe(0);
    expect(repo.countCalls).toBe(1);
  });
});
