import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Gauge } from "prom-client";
import { Round } from "../../domain/round.aggregate";
import type { RoundRepository } from "../../domain/round.repository";
import type { SeedChainRepository } from "../../domain/seed-chain.repository";
import type { BetRepository } from "../../domain/bet.repository";
import {
  BET_REPOSITORY,
  ROUND_REPOSITORY,
  SEED_CHAIN_REPOSITORY,
} from "../tokens";
import { env } from "../../config/defaults";
import { CRASH_RTP_WINDOW } from "../../observability/metrics/crash-rtp-window.metric";

@Injectable()
export class SettleRoundUseCase {
  private readonly log = new Logger(SettleRoundUseCase.name);

  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(SEED_CHAIN_REPOSITORY) private readonly chain: SeedChainRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    @InjectMetric(CRASH_RTP_WINDOW) private readonly crashRtp: Gauge<string>,
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
      await this.updateRollingRtpGauge();
      return reloaded;
    }

    await this.chain.revealSeedAtNonce(round.nonce, serverSeed, now);
    await this.updateRollingRtpGauge();
    return settled;
  }

  private async updateRollingRtpGauge(): Promise<void> {
    try {
      const { payoutTotalCents, betTotalCents } = await this.bets.getRollingRtp(
        env.CRASH_RTP_WINDOW_ROUNDS,
      );
      const rtp =
        betTotalCents === 0n
          ? 0
          : Number(payoutTotalCents) / Number(betTotalCents);
      this.crashRtp.set(rtp);
    } catch (err) {
      this.log.warn(
        `rolling RTP gauge update failed — metric stale, settle path unaffected: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
