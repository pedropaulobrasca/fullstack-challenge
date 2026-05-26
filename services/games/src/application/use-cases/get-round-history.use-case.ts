import { Inject, Injectable } from "@nestjs/common";
import { BET_REPOSITORY, ROUND_REPOSITORY } from "../tokens";
import type { RoundRepository } from "../../domain/round.repository";
import type { BetRepository } from "../../domain/bet.repository";

export type RoundHistoryEntry = {
  roundId: string;
  nonce: string;
  crashPoint: number;
  settledAt: string;
  totalBetCount: number;
};

export type RoundHistoryView = {
  rounds: RoundHistoryEntry[];
  limit: number;
  offset: number;
};

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const MIN_OFFSET = 0;

@Injectable()
export class GetRoundHistoryUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
  ) {}

  async execute(limit: number, offset: number): Promise<RoundHistoryView> {
    const clampedLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.floor(limit)));
    const clampedOffset = Math.max(MIN_OFFSET, Math.floor(offset));

    const rounds = await this.rounds.listSettledHistory(clampedLimit, clampedOffset);

    const entries = await Promise.all(
      rounds.map(async (round) => ({
        roundId: round.id as unknown as string,
        nonce: round.nonce.toString(),
        crashPoint: round.crashPoint!.toNumber(),
        settledAt: round.settledAt!.toISOString(),
        totalBetCount: await this.bets.countByRoundId(round.id),
      })),
    );

    return { rounds: entries, limit: clampedLimit, offset: clampedOffset };
  }
}
