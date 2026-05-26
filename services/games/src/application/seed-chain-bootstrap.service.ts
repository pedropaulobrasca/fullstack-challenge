import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { generateSeedChain } from "@crash/contracts";
import { env } from "../config/defaults";
import { SEED_CHAIN_REPOSITORY } from "./tokens";
import type {
  SeedChainEntry,
  SeedChainRepository,
} from "../domain/seed-chain.repository";

const INSERT_PROGRESS_STEP = 100_000;
const INSERT_BATCH_SIZE = 1_000;

@Injectable()
export class SeedChainBootstrap implements OnApplicationBootstrap {
  private readonly log = new Logger(SeedChainBootstrap.name);

  constructor(
    @Inject(SEED_CHAIN_REPOSITORY)
    private readonly chain: SeedChainRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.chain.countEntries();
    if (existing > 0n) {
      this.log.log(`seed chain already initialized at depth ${existing}`);
      return;
    }

    const length = this.resolveChainLength();
    const genStart = performance.now();
    const entries = generateSeedChain(length);
    const genMs = Math.round(performance.now() - genStart);

    const insertStart = performance.now();
    await this.insertWithProgress(entries);
    const insertMs = Math.round(performance.now() - insertStart);

    this.log.log(
      `seed chain bootstrapped: ${length} entries, gen=${genMs}ms, insert=${insertMs}ms`,
    );
  }

  protected resolveChainLength(): bigint {
    return BigInt(env.HASH_CHAIN_LENGTH);
  }

  private async insertWithProgress(entries: SeedChainEntry[]): Promise<void> {
    let inserted = 0;
    let nextProgressMark = INSERT_PROGRESS_STEP;
    for (
      let offset = 0;
      offset < entries.length;
      offset += INSERT_BATCH_SIZE
    ) {
      const slice = entries.slice(offset, offset + INSERT_BATCH_SIZE);
      await this.chain.insertChain(slice);
      inserted += slice.length;
      if (inserted >= nextProgressMark) {
        this.log.log(`seed chain insert progress: ${inserted}/${entries.length}`);
        nextProgressMark += INSERT_PROGRESS_STEP;
      }
    }
  }
}
