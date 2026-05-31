import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { FORMULA_VERSION } from "@crash/contracts";
import { RoundId } from "@crash/shared-kernel/identity";
import { env } from "../../config/defaults";
import { Round } from "../../domain/round.aggregate";
import type { RoundRepository } from "../../domain/round.repository";
import type { SeedChainRepository } from "../../domain/seed-chain.repository";
import { ROUND_REPOSITORY, SEED_CHAIN_REPOSITORY } from "../tokens";
import { deriveClientSeed } from "../client-seed.derivation";

@Injectable()
export class StartNewRoundUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(SEED_CHAIN_REPOSITORY) private readonly chain: SeedChainRepository,
  ) {}

  async execute(now: Date): Promise<Round> {
    const settledHistory = await this.rounds.listSettledHistory(1, 0);
    const previous = settledHistory[0] ?? null;

    const highestNonce = await this.rounds.maxNonce();
    const nextNonce = highestNonce === null ? 0n : highestNonce + 1n;
    const clientSeed = deriveClientSeed(
      previous && previous.crashedAt
        ? { id: previous.id, crashedAt: previous.crashedAt }
        : null,
    );

    const seedHash = await this.chain.findHashByNonce(nextNonce);
    if (seedHash === null) {
      throw new Error(
        `Seed chain not populated for nonce ${nextNonce.toString()} — bootstrap incomplete`,
      );
    }

    const id = RoundId(randomUUID());
    const bettingEndsAt = new Date(now.getTime() + env.BETTING_WINDOW_MS);
    const round = Round.schedule(
      id,
      nextNonce,
      seedHash,
      clientSeed,
      FORMULA_VERSION,
      bettingEndsAt,
      now,
    );

    await this.rounds.saveScheduled(round);
    return round;
  }
}
