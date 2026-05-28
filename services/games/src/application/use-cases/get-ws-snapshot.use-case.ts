import { Inject, Injectable } from "@nestjs/common";
import type { PlayerId } from "@crash/shared-kernel";
import { BET_REPOSITORY, ROUND_REPOSITORY } from "../tokens";
import type { RoundRepository } from "../../domain/round.repository";
import type { BetRepository } from "../../domain/bet.repository";
import type { Round } from "../../domain/round.aggregate";
import type { Bet } from "../../domain/bet.aggregate";
import type { RoundSnapshotPayload } from "../../presentation/dtos/ws-event.payloads";
import { maskPlayerId } from "./mask-player-id";

export interface Clock {
  now(): Date;
}

const systemClock: Clock = { now: () => new Date() };

@Injectable()
export class GetWsSnapshotUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(playerId: PlayerId | null): Promise<RoundSnapshotPayload | null> {
    const round = await this.rounds.findOpen();
    if (round === null) return null;

    const activeBets = await this.bets.findActiveByRound(round.id);
    const myBet = playerId
      ? await this.bets.findActiveByRoundAndPlayer(round.id, playerId)
      : null;

    return {
      round: this.toRoundShape(round),
      activeBets: activeBets.map((bet) => ({
        betId: bet.id as unknown as string,
        playerIdMasked: maskPlayerId(bet.playerId),
        amount: bet.amount.toSnapshot(),
      })),
      myBet: myBet ? this.toMyBetShape(myBet) : null,
      serverTime: this.clock.now().getTime(),
    };
  }

  private toRoundShape(round: Round): RoundSnapshotPayload["round"] {
    const serverSeed = round.status === "SETTLED" ? round.serverSeed : null;
    return {
      id: round.id as unknown as string,
      status: round.status,
      nonce: round.nonce.toString(),
      seedHash: round.seedHash,
      clientSeed: round.clientSeed,
      bettingEndsAt: round.bettingEndsAt.toISOString(),
      startedAt: round.startedAt?.toISOString() ?? null,
      crashedAt: round.crashedAt?.toISOString() ?? null,
      settledAt: round.settledAt?.toISOString() ?? null,
      crashPoint: round.crashPoint?.toNumber() ?? null,
      serverSeed,
    };
  }

  private toMyBetShape(bet: Bet): NonNullable<RoundSnapshotPayload["myBet"]> {
    return {
      betId: bet.id as unknown as string,
      amount: bet.amount.toSnapshot(),
      status: bet.status,
      cashoutMultiplier: bet.cashedOutMultiplier?.toNumber() ?? null,
    };
  }
}
