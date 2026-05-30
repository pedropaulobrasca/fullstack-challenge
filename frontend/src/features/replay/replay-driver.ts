import { multiplierAt } from "@crash/contracts/multiplier";
import type { RafCurveDriver } from "@/features/curve/use-raf-curve";

export type ReplayDriverState = {
  startedAtWall: number;
  growthRate: number;
  crashPoint: number;
  speed: number;
  paused: boolean;
  lastMultiplier: number;
};

const BASELINE_MULTIPLIER = 1;

export function sampleReplayMultiplier(
  state: ReplayDriverState,
  now: number,
): number {
  if (state.paused) {
    return state.lastMultiplier > 0 ? state.lastMultiplier : BASELINE_MULTIPLIER;
  }
  const elapsedWall = Math.max(0, now - state.startedAtWall);
  const replayElapsed = elapsedWall * state.speed;
  const raw = multiplierAt(replayElapsed, state.growthRate);
  return Math.min(raw, state.crashPoint);
}

type MakeReplayDriverArgs = {
  growthRate: number;
  crashPoint: number;
  speed: () => number;
  paused: () => boolean;
  now?: () => number;
};

export function makeReplayDriver(args: MakeReplayDriverArgs): RafCurveDriver {
  const clock = args.now ?? (() => performance.now());
  const startedAtWall = clock();
  let lastMultiplier = BASELINE_MULTIPLIER;
  let stopped = false;

  return {
    multiplier: () => {
      const state: ReplayDriverState = {
        startedAtWall,
        growthRate: args.growthRate,
        crashPoint: args.crashPoint,
        speed: args.speed(),
        paused: args.paused(),
        lastMultiplier,
      };
      const value = sampleReplayMultiplier(state, clock());
      lastMultiplier = value;
      if (value >= args.crashPoint) {
        stopped = true;
      }
      return value;
    },
    status: () => (stopped ? "CRASHED" : "RUNNING"),
    crashValue: () => (stopped ? args.crashPoint : null),
    shouldStop: () => stopped,
  };
}
