export const LOCKED_ROUND = {
  serverSeed:
    "0000000000000000000000000000000000000000000000000000000000000001",
  clientSeed: "test",
  nonce: 0n,
  instantCrashBucket: 101,
  expectedCrashPoint: 2.94,
  growthRate: 0.06,
  gridSteps: 60,
  gridStepMs: 16.6,
} as const;

export type LockedRound = typeof LOCKED_ROUND;
