import { Inject, Injectable } from "@nestjs/common";
import type { MoneySnapshot, PlayerId } from "@crash/shared-kernel";
import { BET_REPOSITORY } from "../tokens";
import type { BetRepository } from "../../domain/bet.repository";
import type { BetStatus } from "../../domain/value-objects/bet-status";

export type PlayerBetEntry = {
  betId: string;
  roundId: string;
  amount: MoneySnapshot;
  status: BetStatus;
  cashedOutMultiplier: number | null;
  payout: MoneySnapshot | null;
  createdAt: string;
};

export type PlayerBetsView = {
  bets: PlayerBetEntry[];
  limit: number;
  offset: number;
};

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const MIN_OFFSET = 0;

@Injectable()
export class GetPlayerBetsUseCase {
  constructor(
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
  ) {}

  async execute(
    playerId: PlayerId,
    limit: number,
    offset: number,
  ): Promise<PlayerBetsView> {
    const clampedLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.floor(limit)));
    const clampedOffset = Math.max(MIN_OFFSET, Math.floor(offset));

    const bets = await this.bets.listByPlayer(playerId, clampedLimit, clampedOffset);

    return {
      bets: bets.map((bet) => ({
        betId: bet.id as unknown as string,
        roundId: bet.roundId as unknown as string,
        amount: bet.amount.toSnapshot(),
        status: bet.status,
        cashedOutMultiplier: bet.cashedOutMultiplier?.toNumber() ?? null,
        payout: bet.payout?.toSnapshot() ?? null,
        createdAt: bet.createdAt.toISOString(),
      })),
      limit: clampedLimit,
      offset: clampedOffset,
    };
  }
}
