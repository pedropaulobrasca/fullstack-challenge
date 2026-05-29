import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ growthRate: 0.06, ewmaAlpha: 0.1 }),
}));

import {
  useRafCurve,
  type CurveFrame,
  type RafCurveDriver,
} from "@/features/curve/use-raf-curve";
import { useRoundStore } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";

let rafQueue: FrameRequestCallback[];

beforeEach(() => {
  rafQueue = [];

  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue[id - 1] = (() => {}) as FrameRequestCallback;
  });

  useRoundStore.setState({
    roundId: null,
    status: "IDLE",
    bettingEndsAt: null,
    roundStartedAt: null,
    crashValue: null,
  });
  useMultiplierStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function flushFrames(count: number) {
  for (let i = 0; i < count; i++) {
    const cb = rafQueue.shift();
    if (!cb) {
      break;
    }
    cb(performance.now());
  }
}

function Harness({
  onFrame,
  driver,
}: {
  onFrame?: (frame: CurveFrame) => void;
  driver?: RafCurveDriver;
}) {
  useRafCurve(onFrame, driver);
  return null;
}

describe("useRafCurve — live default (Phase 7 zero-diff)", () => {
  it("produces a multiplier > 1 within a few rAF ticks while RUNNING", () => {
    useRoundStore.setState({
      status: "RUNNING",
      roundStartedAt: Date.now() - 2000,
    });
    useMultiplierStore.setState({ serverOffsetMs: 0 });

    const frames: number[] = [];
    render(<Harness onFrame={(f) => frames.push(f.multiplier)} />);
    flushFrames(5);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((m) => m > 1)).toBe(true);
    expect(useMultiplierStore.getState().renderedMultiplier).toBeGreaterThan(1);
  });

  it("freezes at the server crashValue when status transitions to CRASHED", () => {
    useRoundStore.setState({
      status: "RUNNING",
      roundStartedAt: Date.now() - 1000,
    });
    useMultiplierStore.setState({ serverOffsetMs: 0 });

    const frames: number[] = [];
    render(<Harness onFrame={(f) => frames.push(f.multiplier)} />);
    flushFrames(1);

    useRoundStore.getState().setCrashed({ roundId: "r1", crashValue: 2.94 });
    flushFrames(3);

    const last = frames[frames.length - 1];
    expect(last).toBe(2.94);
    expect(useMultiplierStore.getState().renderedMultiplier).toBe(2.94);

    const framesAfterCrash = frames.length;
    flushFrames(5);
    expect(frames.length).toBe(framesAfterCrash);
  });
});

describe("useRafCurve — custom driver (replay seam)", () => {
  it("redirects multiplier reads through the driver", () => {
    const driver: RafCurveDriver = {
      multiplier: vi.fn(() => 1.5),
      status: vi.fn(() => "RUNNING" as const),
      crashValue: vi.fn(() => null),
      shouldStop: vi.fn(() => false),
    };

    const frames: CurveFrame[] = [];
    render(<Harness onFrame={(f) => frames.push({ ...f })} driver={driver} />);
    flushFrames(1);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toEqual({ multiplier: 1.5 });
    expect(driver.multiplier).toHaveBeenCalled();
  });

  it("does NOT write to useMultiplierStore.setRendered when driven externally", () => {
    const setRenderedSpy = vi.spyOn(useMultiplierStore.getState(), "setRendered");
    const before = useMultiplierStore.getState().renderedMultiplier;

    const driver: RafCurveDriver = {
      multiplier: () => 1.5,
      status: () => "RUNNING",
      crashValue: () => null,
      shouldStop: () => false,
    };

    render(<Harness onFrame={() => {}} driver={driver} />);
    flushFrames(3);

    expect(setRenderedSpy).not.toHaveBeenCalled();
    expect(useMultiplierStore.getState().renderedMultiplier).toBe(before);
  });

  it("halts the rAF loop when driver.shouldStop returns true", () => {
    const driver: RafCurveDriver = {
      multiplier: () => 1.2,
      status: () => "RUNNING",
      crashValue: () => null,
      shouldStop: () => true,
    };

    const frames: CurveFrame[] = [];
    render(<Harness onFrame={(f) => frames.push({ ...f })} driver={driver} />);
    flushFrames(5);

    expect(frames.length).toBe(1);
    expect(frames[0]?.multiplier).toBe(1.2);
  });
});
