import type {
  RoundStartedPayload,
  RoundRunningPayload,
  RoundCrashedPayload,
  RoundSettledPayload,
} from "../presentation/dtos/ws-event.payloads";

export const GAME_EVENTS = {
  ROUND_STARTED: "round.started",
  ROUND_RUNNING: "round.running",
  ROUND_CRASHED: "round.crashed",
  ROUND_SETTLED: "round.settled",
} as const;

export type GameEventName = (typeof GAME_EVENTS)[keyof typeof GAME_EVENTS];

export type RoundStartedEvent = RoundStartedPayload;
export type RoundRunningEvent = RoundRunningPayload;
export type RoundCrashedEvent = RoundCrashedPayload;
export type RoundSettledEvent = RoundSettledPayload;
