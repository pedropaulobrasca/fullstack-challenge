import { Inject, Injectable } from "@nestjs/common";
import { crashTimeMs, deriveCrashPoint } from "@crash/contracts";
import { env } from "../../config/defaults";
import { Round } from "../../domain/round.aggregate";
import { CrashPoint } from "../../domain/value-objects/crash-point";
import type { RoundRepository } from "../../domain/round.repository";
import type { SeedChainRepository } from "../../domain/seed-chain.repository";
import { ROUND_REPOSITORY, SEED_CHAIN_REPOSITORY } from "../tokens";

export type TransitionToRunningResult = {
  round: Round;
  crashPoint: CrashPoint;
  crashTimeMs: number;
};

@Injectable()
export class TransitionToRunningUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(SEED_CHAIN_REPOSITORY) private readonly chain: SeedChainRepository,
  ) {}

  async execute(round: Round, now: Date): Promise<TransitionToRunningResult> {
    const serverSeed = await this.chain.findSeedByNonce(round.nonce);
    if (serverSeed === null) {
      throw new Error(
        `Seed chain missing seed at nonce ${round.nonce.toString()}`,
      );
    }

    const crashPointValue = deriveCrashPoint({
      serverSeed,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      instantCrashBucket: env.INSTANT_CRASH_BUCKET,
    });
    const crashPoint = CrashPoint.of(crashPointValue);
    const targetMs = crashTimeMs(env.GROWTH_RATE, crashPointValue);

    const transitioned = await this.rounds.transitionFromBettingToRunning(
      round.id,
      now,
    );
    if (transitioned === null) {
      throw new Error(
        `Round ${round.id as unknown as string} not in BETTING — transition rejected`,
      );
    }

    return { round: transitioned, crashPoint, crashTimeMs: targetMs };
  }
}
