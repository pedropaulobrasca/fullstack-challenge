import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type {
  SeedChainEntry,
  SeedChainRepository,
} from "../../domain/seed-chain.repository";
import { SeedChainEntitySchema } from "../persistence/seed-chain.entity";

const INSERT_BATCH_SIZE = 1000;

@Injectable()
export class MikroSeedChainRepository implements SeedChainRepository {
  constructor(private readonly em: EntityManager) {}

  async countEntries(): Promise<bigint> {
    const count = await this.em.count(SeedChainEntitySchema, {});
    return BigInt(count);
  }

  async insertChain(entries: SeedChainEntry[]): Promise<void> {
    if (entries.length === 0) return;
    for (let offset = 0; offset < entries.length; offset += INSERT_BATCH_SIZE) {
      const slice = entries.slice(offset, offset + INSERT_BATCH_SIZE);
      const placeholders = slice.map(() => "(?, ?)").join(", ");
      const params: Array<string> = [];
      for (const entry of slice) {
        params.push(entry.nonce.toString());
        params.push(entry.hash);
      }
      await this.em
        .getConnection()
        .execute(
          `INSERT INTO seed_chain (nonce, hash) VALUES ${placeholders}`,
          params,
          "run",
          this.em.getTransactionContext(),
        );
    }
  }

  async findHashByNonce(nonce: bigint): Promise<string | null> {
    const row = await this.em.findOne(SeedChainEntitySchema, { nonce });
    return row?.hash ?? null;
  }

  async findSeedByNonce(nonce: bigint): Promise<string | null> {
    const row = await this.em.findOne(SeedChainEntitySchema, { nonce });
    return row?.seed ?? null;
  }

  async revealSeedAtNonce(
    nonce: bigint,
    seed: string,
    revealedAt: Date,
    txEm?: unknown,
  ): Promise<void> {
    const em = this.resolveEm(txEm);
    await em
      .getConnection()
      .execute(
        `UPDATE seed_chain
         SET seed = ?, revealed_at = ?
         WHERE nonce = ? AND seed IS NULL`,
        [seed, revealedAt, nonce.toString()],
        "run",
        em.getTransactionContext(),
      );
  }

  private resolveEm(txEm: unknown): EntityManager {
    if (txEm && txEm instanceof EntityManager) {
      return txEm;
    }
    return this.em;
  }
}
