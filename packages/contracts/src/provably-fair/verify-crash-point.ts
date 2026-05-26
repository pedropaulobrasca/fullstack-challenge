import { deriveCrashPoint } from "./derive-crash-point";
import type { DeriveCrashPointInput, VerifyCrashPointResult } from "./types";

export function verifyCrashPoint(
  input: DeriveCrashPointInput,
  expectedCrashPoint: number,
): VerifyCrashPointResult {
  const recomputed = deriveCrashPoint(input);
  return {
    matches: recomputed === expectedCrashPoint,
    recomputed,
  };
}
