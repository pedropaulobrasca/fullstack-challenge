import type { RoundId } from "@crash/shared-kernel/identity";
import type {
  RoundStartedPayload,
  RoundRunningPayload,
  RoundCrashedPayload,
  RoundSettledPayload,
} from "../presentation/dtos/ws-event.payloads";
import type { LeaderboardSnapshotEntry } from "../domain/leaderboard.repository";

export const GAME_EVENTS = {
  ROUND_STARTED: "round.started",
  ROUND_RUNNING: "round.running",
  ROUND_CRASHED: "round.crashed",
  ROUND_SETTLED: "round.settled",
  ROUND_TICK: "round.tick",
  LEADERBOARD_UPDATED: "game.leaderboard.updated",
} as const;

export type GameEventName = (typeof GAME_EVENTS)[keyof typeof GAME_EVENTS];

export type RoundStartedEvent = RoundStartedPayload;
export type RoundRunningEvent = RoundRunningPayload;
export type RoundCrashedEvent = RoundCrashedPayload;
export type RoundSettledEvent = RoundSettledPayload;

export interface RoundTickPayload {
  roundId: RoundId;
  multiplier: number;
  t: number;
}

export interface LeaderboardUpdatedPayload {
  entries: LeaderboardSnapshotEntry[];
  updatedAt: string;
}
