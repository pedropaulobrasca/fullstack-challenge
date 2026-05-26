import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { RoundId } from "@crash/shared-kernel";
import { deriveCrashPoint, FORMULA_VERSION } from "@crash/contracts";
import { env } from "../../config/defaults";
import { ROUND_REPOSITORY } from "../tokens";
import type { RoundRepository } from "../../domain/round.repository";

export type VerifyRoundView = {
  roundId: string;
  nonce: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  crashPoint: number;
  recomputedCrashPoint: number;
  matches: boolean;
  formulaVersion: number;
  previousServerSeed: string | null;
};

@Injectable()
export class VerifyRoundUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
  ) {}

  async execute(roundId: RoundId): Promise<VerifyRoundView> {
    const round = await this.rounds.findById(roundId);
    if (!round) {
      throw new NotFoundException({ code: "ROUND_NOT_FOUND" });
    }
    if (round.status !== "SETTLED") {
      throw new BadRequestException({ code: "ROUND_NOT_YET_SETTLED" });
    }

    const recomputed = deriveCrashPoint({
      serverSeed: round.serverSeed!,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      instantCrashBucket: env.INSTANT_CRASH_BUCKET,
    });
    const recorded = round.crashPoint!.toNumber();

    const previousServerSeed =
      round.nonce > 0n
        ? await this.rounds.findServerSeedByNonce(round.nonce - 1n)
        : null;

    return {
      roundId: round.id as unknown as string,
      nonce: round.nonce.toString(),
      serverSeed: round.serverSeed!,
      serverSeedHash: round.seedHash,
      clientSeed: round.clientSeed,
      crashPoint: recorded,
      recomputedCrashPoint: recomputed,
      matches: recomputed === recorded,
      formulaVersion: FORMULA_VERSION,
      previousServerSeed,
    };
  }
}
