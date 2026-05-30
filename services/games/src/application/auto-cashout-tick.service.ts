import { Inject, Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import type { BetRepository } from "../domain/bet.repository";
import {
  BetNotCashableError,
  RoundNotRunningError,
} from "../domain/errors";
import { BET_REPOSITORY } from "./tokens";
import { GAME_EVENTS, type RoundTickPayload } from "./game-events";
import { CashOutUseCase } from "./use-cases/cash-out.use-case";

@Injectable()
export class AutoCashoutTickService {
  public readonly logger = new Logger(AutoCashoutTickService.name);

  constructor(
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    private readonly cashOut: CashOutUseCase,
  ) {}

  @OnEvent(GAME_EVENTS.ROUND_TICK, { async: true })
  async onTick(payload: RoundTickPayload): Promise<void> {
    const acceptedAt = new Date();
    const ceilingCentiX = Math.floor(payload.multiplier * 100);
    const candidates = await this.bets.findAutoCashoutCandidates(
      payload.roundId,
      ceilingCentiX,
    );
    for (const bet of candidates) {
      if (bet.autoCashoutTarget === null) {
        continue;
      }
      try {
        await this.cashOut.execute({
          playerId: bet.playerId,
          multiplier: bet.autoCashoutTarget,
          acceptedAt,
        });
      } catch (err) {
        if (
          err instanceof RoundNotRunningError ||
          err instanceof BetNotCashableError
        ) {
          continue;
        }
        this.logger.error(
          "Unexpected auto-cashout error",
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
