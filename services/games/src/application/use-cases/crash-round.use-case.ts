import { Inject, Injectable, Logger } from "@nestjs/common";
import { Round } from "../../domain/round.aggregate";
import { CrashPoint } from "../../domain/value-objects/crash-point";
import type { RoundRepository } from "../../domain/round.repository";
import type { BetRepository } from "../../domain/bet.repository";
import { BET_REPOSITORY, ROUND_REPOSITORY } from "../tokens";

@Injectable()
export class CrashRoundUseCase {
  private readonly log = new Logger(CrashRoundUseCase.name);

  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
  ) {}

  async execute(
    round: Round,
    crashPoint: CrashPoint,
    now: Date,
  ): Promise<Round> {
    let crashed: Round | null;
    if (round.status === "CRASHED") {
      crashed = round;
    } else {
      crashed = await this.rounds.transitionFromRunningToCrashed(
        round.id,
        crashPoint,
        now,
      );
      if (crashed === null) {
        const reloaded = await this.rounds.findById(round.id);
        if (reloaded === null || reloaded.status !== "CRASHED") {
          throw new Error(
            `Round ${round.id as unknown as string} not in RUNNING — crash transition rejected`,
          );
        }
        crashed = reloaded;
      }
    }

    await this.sweepActiveBetsToLost(crashed);
    return crashed;
  }

  private async sweepActiveBetsToLost(round: Round): Promise<void> {
    const activeBets = await this.bets.findActiveByRound(round.id);
    for (const bet of activeBets) {
      if (bet.status !== "ACTIVE") continue;
      const result = await this.bets.tryTransition(bet.id, "ACTIVE", "LOST", {});
      if (result === null) {
        this.log.debug(
          `bet ${bet.id as unknown as string} no longer ACTIVE during sweep (race)`,
        );
      }
    }
  }
}
