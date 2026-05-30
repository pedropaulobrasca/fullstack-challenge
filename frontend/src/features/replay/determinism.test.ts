// Phase 8 ROADMAP success criterion 4 (REQ-REPLAY-01). Samples are taken at a
// fixed grid (NOT rAF callbacks) per RESEARCH § Pitfall 7. This is the
// byte-match proof that live and replay paths produce the same curve from the
// same seeds.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { crashTimeMs, multiplierAt } from "@crash/contracts/multiplier";
import { deriveCrashPointAsync } from "@crash/contracts/provably-fair-browser";
import {
  HEX_CHARS,
  TWO_POW_52,
} from "@crash/contracts/formula";
import {
  sampleReplayMultiplier,
  type ReplayDriverState,
} from "./replay-driver";
import { LOCKED_ROUND } from "./__fixtures__/locked-round.fixture";

function bustabitCrashFromHmacHex(
  hmacHex: string,
  instantCrashBucket: number,
): number {
  const first13 = hmacHex.substring(0, HEX_CHARS);
  const intH = parseInt(first13, 16);
  if (intH % instantCrashBucket === 0) {
    return 1.0;
  }
  const crash =
    Math.floor((100 * TWO_POW_52 - intH) / (TWO_POW_52 - intH)) / 100;
  return Math.max(1.0, crash);
}

function deriveCrashPointSyncFallback(
  serverSeed: string,
  clientSeed: string,
  nonce: bigint,
  instantCrashBucket: number,
): number {
  const message = `${clientSeed}:${nonce.toString()}`;
  const hmacHex = createHmac("sha256", serverSeed).update(message).digest("hex");
  return bustabitCrashFromHmacHex(hmacHex, instantCrashBucket);
}

function buildGrid(): number[] {
  const crashAtMs = crashTimeMs(
    LOCKED_ROUND.growthRate,
    LOCKED_ROUND.expectedCrashPoint,
  );
  const grid: number[] = [];
  for (let i = 0; i < LOCKED_ROUND.gridSteps; i += 1) {
    const t = i * LOCKED_ROUND.gridStepMs;
    grid.push(t);
    if (t > crashAtMs) {
      break;
    }
  }
  return grid;
}

function replayStateAt(speed: number): ReplayDriverState {
  return {
    startedAtWall: 0,
    growthRate: LOCKED_ROUND.growthRate,
    crashPoint: LOCKED_ROUND.expectedCrashPoint,
    speed,
    paused: false,
    lastMultiplier: 1,
  };
}

describe("determinism.test — REQ-REPLAY-01 byte-match proof", () => {
  it("Test 1 — seed-to-crashpoint anchor returns 2.94 (Phase 4 oracle, never skipped)", async () => {
    const hasSubtle = typeof globalThis.crypto?.subtle?.importKey === "function";

    const actualCrashPoint = hasSubtle
      ? await deriveCrashPointAsync({
          serverSeed: LOCKED_ROUND.serverSeed,
          clientSeed: LOCKED_ROUND.clientSeed,
          nonce: LOCKED_ROUND.nonce,
          instantCrashBucket: LOCKED_ROUND.instantCrashBucket,
        })
      : deriveCrashPointSyncFallback(
          LOCKED_ROUND.serverSeed,
          LOCKED_ROUND.clientSeed,
          LOCKED_ROUND.nonce,
          LOCKED_ROUND.instantCrashBucket,
        );

    expect(actualCrashPoint).toBe(LOCKED_ROUND.expectedCrashPoint);
  });

  it("Test 2 — live multiplierAt and sampleReplayMultiplier byte-match at speed 1x across the fixed grid", () => {
    const grid = buildGrid();
    const state = replayStateAt(1);

    const liveSamples = grid.map((t) =>
      Math.min(
        multiplierAt(t, LOCKED_ROUND.growthRate),
        LOCKED_ROUND.expectedCrashPoint,
      ),
    );
    const replaySamples = grid.map((t) => sampleReplayMultiplier(state, t));

    expect(replaySamples).toEqual(liveSamples);
    expect(replaySamples.length).toBeGreaterThan(0);
  });

  it("Test 3 — speed-time equivalence: sample(speed=k, t) === sample(speed=1, k*t) for k in {2,4} (locks D-03)", () => {
    const grid = buildGrid();
    const stateAt1x = replayStateAt(1);

    for (const speed of [2, 4] as const) {
      const stateAtKx = replayStateAt(speed);
      for (const t of grid) {
        const fastSample = sampleReplayMultiplier(stateAtKx, t);
        const slowSample = sampleReplayMultiplier(stateAt1x, t * speed);
        expect(fastSample).toBe(slowSample);
      }
    }
  });

  it("Test 4 — sampleReplayMultiplier is pure: two independent states produce identical sample arrays", () => {
    const grid = buildGrid();
    const stateA = replayStateAt(1);
    const stateB = replayStateAt(1);

    const samplesA = grid.map((t) => sampleReplayMultiplier(stateA, t));
    const samplesB = grid.map((t) => sampleReplayMultiplier(stateB, t));

    expect(samplesA).toEqual(samplesB);
  });

  it("Test 5 — crash freeze cap: past the crash time the sample equals crashPoint exactly", () => {
    const state = replayStateAt(1);
    const crashAtMs = crashTimeMs(
      LOCKED_ROUND.growthRate,
      LOCKED_ROUND.expectedCrashPoint,
    );

    const tPastCrash = crashAtMs * 2;
    const sample = sampleReplayMultiplier(state, tPastCrash);

    expect(sample).toBe(LOCKED_ROUND.expectedCrashPoint);
  });
});
