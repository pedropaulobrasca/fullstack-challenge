import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { MoneySnapshot, PlayerId } from "@crash/shared-kernel";
import { multiplierAt } from "@crash/contracts";
import { env } from "../../config/defaults";
import { BET_REPOSITORY, ROUND_REPOSITORY } from "../tokens";
import type { RoundRepository } from "../../domain/round.repository";
import type { BetRepository } from "../../domain/bet.repository";
import type { Bet } from "../../domain/bet.aggregate";
import type { Round } from "../../domain/round.aggregate";
import type { RoundStatus } from "../../domain/value-objects/round-status";
import type { BetStatus } from "../../domain/value-objects/bet-status";

export type CurrentRoundBetView = {
  betId: string;
  playerIdMasked: string;
  amount: MoneySnapshot;
  status: BetStatus;
  cashedOutMultiplier: number | null;
  payout: MoneySnapshot | null;
};

export type CurrentRoundView = {
  roundId: string;
  status: RoundStatus;
  nonce: string;
  seedHash: string;
  clientSeed: string;
  formulaVersion: number;
  bettingEndsAt: string;
  startedAt: string | null;
  crashedAt: string | null;
  settledAt: string | null;
  crashPoint: number | null;
  serverSeed: string | null;
  currentMultiplier: number | null;
  bets: CurrentRoundBetView[];
};

function maskPlayerId(playerId: PlayerId): string {
  return createHash("sha256")
    .update(playerId as unknown as string)
    .digest("hex")
    .substring(0, 8);
}

@Injectable()
export class GetCurrentRoundUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
  ) {}

  async execute(now: Date = new Date()): Promise<CurrentRoundView | null> {
    const round = await this.rounds.findOpen();
    if (!round) return null;

    const activeBets = await this.bets.findActiveByRound(round.id);
    return this.toView(round, activeBets, now);
  }

  private toView(round: Round, bets: Bet[], now: Date): CurrentRoundView {
    const currentMultiplier =
      round.status === "RUNNING" && round.startedAt
        ? multiplierAt(now.getTime() - round.startedAt.getTime(), env.GROWTH_RATE)
        : null;

    const serverSeed = round.status === "SETTLED" ? round.serverSeed : null;

    return {
      roundId: round.id as unknown as string,
      status: round.status,
      nonce: round.nonce.toString(),
      seedHash: round.seedHash,
      clientSeed: round.clientSeed,
      formulaVersion: round.formulaVersion,
      bettingEndsAt: round.bettingEndsAt.toISOString(),
      startedAt: round.startedAt?.toISOString() ?? null,
      crashedAt: round.crashedAt?.toISOString() ?? null,
      settledAt: round.settledAt?.toISOString() ?? null,
      crashPoint: round.crashPoint?.toNumber() ?? null,
      serverSeed,
      currentMultiplier,
      bets: bets.map((bet) => ({
        betId: bet.id as unknown as string,
        playerIdMasked: maskPlayerId(bet.playerId),
        amount: bet.amount.toSnapshot(),
        status: bet.status,
        cashedOutMultiplier: bet.cashedOutMultiplier?.toNumber() ?? null,
        payout: bet.payout?.toSnapshot() ?? null,
      })),
    };
  }
}
