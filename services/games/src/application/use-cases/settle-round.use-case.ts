import { Inject, Injectable } from "@nestjs/common";
import { Round } from "../../domain/round.aggregate";
import type { RoundRepository } from "../../domain/round.repository";
import type { SeedChainRepository } from "../../domain/seed-chain.repository";
import { ROUND_REPOSITORY, SEED_CHAIN_REPOSITORY } from "../tokens";

@Injectable()
export class SettleRoundUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(SEED_CHAIN_REPOSITORY) private readonly chain: SeedChainRepository,
  ) {}

  async execute(round: Round, now: Date): Promise<Round> {
    const serverSeed = await this.chain.findSeedByNonce(round.nonce);
    if (serverSeed === null) {
      throw new Error(
        `Seed chain missing seed at nonce ${round.nonce.toString()}`,
      );
    }

    const settled = await this.rounds.transitionFromCrashedToSettled(
      round.id,
      serverSeed,
      now,
    );
    if (settled === null) {
      const reloaded = await this.rounds.findById(round.id);
      if (reloaded === null || reloaded.status !== "SETTLED") {
        throw new Error(
          `Round ${round.id as unknown as string} not in CRASHED — settle transition rejected`,
        );
      }
      await this.chain.revealSeedAtNonce(round.nonce, serverSeed, now);
      return reloaded;
    }

    await this.chain.revealSeedAtNonce(round.nonce, serverSeed, now);
    return settled;
  }
}
