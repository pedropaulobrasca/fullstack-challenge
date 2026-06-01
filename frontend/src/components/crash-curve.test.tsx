import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ growthRate: 0.06, ewmaAlpha: 0.1 }),
}));

import { CrashCurve } from "@/components/crash-curve";
import { useRoundStore } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";

type Call = { method: string; args: unknown[] };

function makeRecordingContext() {
  const calls: Call[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    calls,
    setTransform: record("setTransform"),
    clearRect: record("clearRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    quadraticCurveTo: record("quadraticCurveTo"),
    closePath: record("closePath"),
    arc: record("arc"),
    fill: record("fill"),
    fillRect: record("fillRect"),
    stroke: record("stroke"),
    fillText: record("fillText"),
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    rotate: record("rotate"),
    setLineDash: record("setLineDash"),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
    measureText: vi.fn(() => ({ width: 0 })),
    font: "",
    textAlign: "",
    textBaseline: "",
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    globalAlpha: 1,
    lineWidth: 0,
    lineJoin: "",
    lineCap: "",
    shadowBlur: 0,
    shadowColor: "",
  };
  return ctx;
}

let ctxStub: ReturnType<typeof makeRecordingContext>;
let rafQueue: FrameRequestCallback[];

beforeEach(() => {
  ctxStub = makeRecordingContext();
  rafQueue = [];

  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctxStub as unknown as CanvasRenderingContext2D,
  ) as never;

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    writable: true,
    value: 2,
  });

  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

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

describe("CrashCurve", () => {
  it("clears the canvas before stroking on each running frame", () => {
    useRoundStore.setState({
      status: "RUNNING",
      roundStartedAt: Date.now() - 2000,
    });
    useMultiplierStore.setState({ serverOffsetMs: 0 });

    render(<CrashCurve />);
    flushFrames(2);

    const clearIndex = ctxStub.calls.findIndex((c) => c.method === "clearRect");
    const strokeIndex = ctxStub.calls.findIndex((c) => c.method === "stroke");
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    expect(strokeIndex).toBeGreaterThan(clearIndex);
  });

  it("sizes the backing store by cssWidth/Height * devicePixelRatio", () => {
    render(<CrashCurve />);
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width).toBe(800 * 2);
    expect(canvas.height).toBe(600 * 2);
  });

  it("rises monotonically across running frames", () => {
    useRoundStore.setState({
      status: "RUNNING",
      roundStartedAt: Date.now() - 1000,
    });
    useMultiplierStore.setState({ serverOffsetMs: 0 });

    render(<CrashCurve />);
    flushFrames(1);
    const first = useMultiplierStore.getState().renderedMultiplier;
    flushFrames(1);
    const second = useMultiplierStore.getState().renderedMultiplier;
    expect(second).toBeGreaterThanOrEqual(first);
  });

  it("freezes the rendered value at the server crashValue on CRASHED", () => {
    useRoundStore.setState({
      status: "RUNNING",
      roundStartedAt: Date.now() - 1000,
    });
    useMultiplierStore.setState({ serverOffsetMs: 0 });
    render(<CrashCurve />);
    flushFrames(1);

    useRoundStore.getState().setCrashed({ roundId: "r1", crashValue: 3.5 });
    flushFrames(2);

    expect(useMultiplierStore.getState().renderedMultiplier).toBe(3.5);
  });

  it("cancels the rAF loop on unmount (no draw after unmount)", () => {
    useRoundStore.setState({
      status: "RUNNING",
      roundStartedAt: Date.now() - 1000,
    });
    useMultiplierStore.setState({ serverOffsetMs: 0 });

    const { unmount } = render(<CrashCurve />);
    flushFrames(1);
    const callsBefore = ctxStub.calls.length;

    unmount();
    flushFrames(5);

    expect(ctxStub.calls.length).toBe(callsBefore);
  });
});
