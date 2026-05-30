import { describe, expect, it } from "vitest";
import {
  makeReplayDriver,
  sampleReplayMultiplier,
  type ReplayDriverState,
} from "@/features/replay/replay-driver";

const baseState = (override: Partial<ReplayDriverState> = {}): ReplayDriverState => ({
  startedAtWall: 0,
  growthRate: 0.06,
  crashPoint: 1000,
  speed: 1,
  paused: false,
  lastMultiplier: 1,
  ...override,
});

describe("sampleReplayMultiplier", () => {
  it("returns 1.0 when elapsedWall is 0", () => {
    const value = sampleReplayMultiplier(baseState(), 0);
    expect(value).toBeCloseTo(1, 10);
  });

  it("preserves the determinism property: value@speed=2 at t equals value@speed=1 at 2t", () => {
    const at1x = sampleReplayMultiplier(baseState({ speed: 1 }), 2000);
    const at2x = sampleReplayMultiplier(baseState({ speed: 2 }), 1000);
    expect(at2x).toBeCloseTo(at1x, 12);

    const at4x = sampleReplayMultiplier(baseState({ speed: 4 }), 500);
    expect(at4x).toBeCloseTo(at1x, 12);
  });

  it("caps the result at crashPoint", () => {
    const state = baseState({ crashPoint: 1.5 });
    const value = sampleReplayMultiplier(state, 60_000);
    expect(value).toBe(1.5);
  });

  it("freezes at lastMultiplier when paused", () => {
    const state = baseState({ paused: true, lastMultiplier: 2.34 });
    expect(sampleReplayMultiplier(state, 5000)).toBe(2.34);
    expect(sampleReplayMultiplier(state, 50000)).toBe(2.34);
  });
});

describe("makeReplayDriver", () => {
  it("multiplier() advances over time", () => {
    let now = 0;
    const driver = makeReplayDriver({
      growthRate: 0.06,
      crashPoint: 1000,
      speed: () => 1,
      paused: () => false,
      now: () => now,
    });

    const first = driver.multiplier();
    now = 500;
    const second = driver.multiplier();
    expect(second).toBeGreaterThan(first);
  });

  it("transitions to CRASHED status once the crash point is reached", () => {
    let now = 0;
    const driver = makeReplayDriver({
      growthRate: 0.06,
      crashPoint: 1.5,
      speed: () => 1,
      paused: () => false,
      now: () => now,
    });

    expect(driver.shouldStop()).toBe(false);
    expect(driver.status()).toBe("RUNNING");

    now = 60_000;
    driver.multiplier();

    expect(driver.shouldStop()).toBe(true);
    expect(driver.status()).toBe("CRASHED");
    expect(driver.crashValue()).toBe(1.5);
  });

  it("freezes the multiplier when paused getter returns true", () => {
    let now = 0;
    let paused = false;
    const driver = makeReplayDriver({
      growthRate: 0.06,
      crashPoint: 1000,
      speed: () => 1,
      paused: () => paused,
      now: () => now,
    });

    now = 1000;
    const before = driver.multiplier();
    paused = true;
    now = 5000;
    const frozenFirst = driver.multiplier();
    now = 60_000;
    const frozenSecond = driver.multiplier();

    expect(frozenFirst).toBe(before);
    expect(frozenSecond).toBe(before);
  });
});
