import { describe, expect, it, vi } from "vitest";

const GROWTH_RATE = 0.06;
const EWMA_ALPHA = 0.1;

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ growthRate: GROWTH_RATE, ewmaAlpha: EWMA_ALPHA }),
}));

import { multiplierAt } from "@crash/contracts/multiplier";
import { localMultiplier, reconcileOffset } from "@/features/curve/local-multiplier";

describe("localMultiplier", () => {
  it("returns 1.0 at elapsed zero (now + offset == roundStartedAt)", () => {
    const roundStartedAt = 1_000_000;
    expect(localMultiplier(roundStartedAt, 0, roundStartedAt)).toBe(1);
  });

  it("equals the server's multiplierAt for the same elapsedMs (byte-identical formula)", () => {
    const roundStartedAt = 1_000_000;
    const serverOffsetMs = 250;
    for (const elapsed of [0, 500, 1000, 3000, 7500, 15000]) {
      const now = roundStartedAt + elapsed - serverOffsetMs;
      const local = localMultiplier(roundStartedAt, serverOffsetMs, now);
      const direct = multiplierAt(elapsed, GROWTH_RATE);
      expect(local).toBe(direct);
    }
  });

  it("rises monotonically as now advances while running", () => {
    const roundStartedAt = 1_000_000;
    const a = localMultiplier(roundStartedAt, 0, roundStartedAt + 1000);
    const b = localMultiplier(roundStartedAt, 0, roundStartedAt + 2000);
    expect(b).toBeGreaterThan(a);
  });
});

describe("reconcileOffset (EWMA, never snaps)", () => {
  it("moves toward the instantaneous offset without reaching it in one step", () => {
    const prev = 0;
    const instantaneous = 1000;
    const next = reconcileOffset(prev, instantaneous, EWMA_ALPHA);
    expect(next).toBeGreaterThan(prev);
    expect(next).toBeLessThan(instantaneous);
    expect(next).toBeCloseTo(100, 6);
  });

  it("converges monotonically toward the instantaneous offset over successive steps", () => {
    const instantaneous = 1000;
    let offset = 0;
    let previous = -1;
    for (let i = 0; i < 50; i++) {
      offset = reconcileOffset(offset, instantaneous, EWMA_ALPHA);
      expect(offset).toBeGreaterThan(previous);
      expect(offset).toBeLessThan(instantaneous);
      previous = offset;
    }
    expect(offset).toBeGreaterThan(900);
  });

  it("never jumps when alpha is small, even for a large instantaneous gap", () => {
    const next = reconcileOffset(0, 100000, EWMA_ALPHA);
    expect(next).toBe(10000);
    expect(next).not.toBe(100000);
  });
});
