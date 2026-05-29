import { useEffect, useRef } from "react";
import { getConfig } from "@/lib/config";
import { useRoundStore } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";
import { localMultiplier, reconcileOffset } from "@/features/curve/local-multiplier";

const BASELINE_MULTIPLIER = 1;

export type CurveFrame = {
  multiplier: number;
};

export function useRafCurve(onFrame?: (frame: CurveFrame) => void) {
  const frameRef = useRef<CurveFrame>({ multiplier: BASELINE_MULTIPLIER });
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const cancel = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const writeFrame = (value: number) => {
      frameRef.current = { multiplier: value };
      useMultiplierStore.getState().setRendered(value);
      onFrame?.(frameRef.current);
    };

    const tick = () => {
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

      rafIdRef.current = requestAnimationFrame(tick);
    };

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
  }, [onFrame]);

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
