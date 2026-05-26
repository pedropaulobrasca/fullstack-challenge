import type { BetId, PlayerId, RoundId } from "@crash/shared-kernel";
import type { Bet, BetProps } from "./bet.aggregate";
import type { BetStatus } from "./value-objects/bet-status";

export interface BetRepository {
  findById(id: BetId): Promise<Bet | null>;
  findActiveByRoundAndPlayer(roundId: RoundId, playerId: PlayerId): Promise<Bet | null>;
  findActiveByRound(roundId: RoundId): Promise<Bet[]>;
  listByPlayer(playerId: PlayerId, limit: number, offset: number): Promise<Bet[]>;
  save(bet: Bet, txEm?: unknown): Promise<void>;
  tryTransition(
    id: BetId,
    fromStatus: BetStatus,
    toStatus: BetStatus,
    patch: Partial<BetProps>,
    txEm?: unknown,
  ): Promise<Bet | null>;
}
