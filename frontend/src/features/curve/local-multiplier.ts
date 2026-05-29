import { multiplierAt } from "@crash/contracts/multiplier";
import { getConfig } from "@/lib/config";

export function localMultiplier(
  roundStartedAt: number,
  serverOffsetMs: number,
  now: number = Date.now(),
): number {
  const elapsedMs = now + serverOffsetMs - roundStartedAt;
  return multiplierAt(elapsedMs, getConfig().growthRate);
}

export function reconcileOffset(
  prevOffset: number,
  instantaneousOffset: number,
  alpha: number,
): number {
  return prevOffset + alpha * (instantaneousOffset - prevOffset);
}
