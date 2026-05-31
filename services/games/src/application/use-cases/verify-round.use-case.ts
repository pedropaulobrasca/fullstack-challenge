import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { RoundId } from "@crash/shared-kernel/identity";
import { deriveCrashPoint, FORMULA_VERSION } from "@crash/contracts";
import { env } from "../../config/defaults";
import { BET_REPOSITORY, ROUND_REPOSITORY } from "../tokens";
import type { RoundRepository } from "../../domain/round.repository";
import type { BetRepository } from "../../domain/bet.repository";
import type { RoundBetView } from "../../presentation/dtos/round-bet-view.dto";
import { maskPlayerId } from "@crash/shared-kernel/identity";
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
  bets: RoundBetView[];
  /**
   * Growth rate snapshot read from env at verify-response time. Replay overlays
   * MUST consume this value instead of their own env so a future ops change to
   * GROWTH_RATE never invalidates an older round's replay. A persisted
   * per-round growthRate column is a follow-up if GROWTH_RATE ever shifts in
   * production (RESEARCH Open Question 4).
   */
  growthRate: number;
};

@Injectable()
export class VerifyRoundUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
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

    const betsForRound = await this.bets.findByRound(round.id);
    const bets: RoundBetView[] = betsForRound.map((bet) => ({
      betId: bet.id as unknown as string,
      playerIdMasked: maskPlayerId(bet.playerId),
      amount: bet.amount.toSnapshot(),
      status: bet.status,
      cashedOutMultiplier: bet.cashedOutMultiplier?.toNumber() ?? null,
      payout: bet.payout?.toSnapshot() ?? null,
    }));

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
      bets,
      growthRate: env.GROWTH_RATE,
    };
  }
}
