import { useEffect, useRef } from "react";
import { getConfig } from "@/lib/config";
import { useRoundStore, type RoundStatus } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";
import { localMultiplier, reconcileOffset } from "@/features/curve/local-multiplier";

const BASELINE_MULTIPLIER = 1;

export type CurveFrame = {
  multiplier: number;
};

export type RafCurveDriver = {
  multiplier: () => number;
  status: () => RoundStatus;
  crashValue: () => number | null;
  shouldStop: () => boolean;
};

export const liveDriver: RafCurveDriver = {
  multiplier: () => {
    const round = useRoundStore.getState();
    if (round.status !== "RUNNING" || round.roundStartedAt === null) {
      return BASELINE_MULTIPLIER;
    }
    const mult = useMultiplierStore.getState();
    return localMultiplier(round.roundStartedAt, mult.serverOffsetMs ?? 0);
  },
  status: () => useRoundStore.getState().status,
  crashValue: () => useRoundStore.getState().crashValue,
  shouldStop: () => {
    const round = useRoundStore.getState();
    if (round.status === "CRASHED") {
      return true;
    }
    if (round.status !== "RUNNING" || round.roundStartedAt === null) {
      return true;
    }
    return false;
  },
};

export function useRafCurve(
  onFrame?: (frame: CurveFrame) => void,
  driver: RafCurveDriver = liveDriver,
) {
  const frameRef = useRef<CurveFrame>({ multiplier: BASELINE_MULTIPLIER });
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const isLive = driver === liveDriver;

    const cancel = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const writeFrame = (value: number) => {
      frameRef.current = { multiplier: value };
      if (isLive) {
        useMultiplierStore.getState().setRendered(value);
      }
      onFrame?.(frameRef.current);
    };

    const tickLive = () => {
      const round = useRoundStore.getState();

      if (round.status === "CRASHED") {
        const frozen = round.crashValue ?? frameRef.current.multiplier;
        writeFrame(frozen);
        cancel();
        return;
      }

      if (round.status !== "RUNNING" || round.roundStartedAt === null) {
        writeFrame(BASELINE_MULTIPLIER);
        cancel();
        return;
      }

      const mult = useMultiplierStore.getState();
      const baseOffset = mult.serverOffsetMs ?? 0;
      const value = localMultiplier(round.roundStartedAt, baseOffset);
      writeFrame(value);

      rafIdRef.current = requestAnimationFrame(tickLive);
    };

    const tickDriver = () => {
      const value = driver.multiplier();
      writeFrame(value);

      if (driver.shouldStop()) {
        cancel();
        return;
      }

      rafIdRef.current = requestAnimationFrame(tickDriver);
    };

    const tick = isLive ? tickLive : tickDriver;

    if (isLive) {
      const unsubscribe = useRoundStore.subscribe((state, prev) => {
        if (state.status === prev.status) {
          return;
        }
        cancel();
        if (state.status === "RUNNING" && state.roundStartedAt !== null) {
          rafIdRef.current = requestAnimationFrame(tick);
        } else {
          tick();
        }
      });

      tick();

      return () => {
        unsubscribe();
        cancel();
      };
    }

    tick();

    return () => {
      cancel();
    };
  }, [onFrame, driver]);

  return frameRef;
}

export function nudgeOffsetTowardServer(
  prevOffset: number,
  reconcileTarget: number,
  roundStartedAt: number,
  now: number = Date.now(),
): number {
  const growthRate = getConfig().growthRate;
  const elapsedAtTarget = (Math.log(reconcileTarget) / growthRate) * 1000;
  const impliedServerNow = roundStartedAt + elapsedAtTarget;
  const instantaneousOffset = impliedServerNow - now;
  return reconcileOffset(prevOffset, instantaneousOffset, getConfig().ewmaAlpha);
}
