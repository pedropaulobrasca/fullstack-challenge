import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Money } from "@crash/shared-kernel";
import { useAutoBetStore } from "@/features/auto-bet/auto-bet.store";

const cents = (n: bigint) => Money.of(n);

const validConfig = () => ({
  target: 2,
  strategy: "fixed" as const,
  baseAmount: cents(1000n),
  stopLoss: cents(5000n),
  stopWin: cents(5000n),
});

beforeEach(() => {
  useAutoBetStore.setState({
    isRunning: false,
    config: null,
    sessionPL: Money.of(0n),
    sessionPLSign: 0,
    lastBetAmount: null,
    lastOutcome: null,
    roundCount: 0,
    halted: null,
  });
});

describe("auto-bet.store — no persist (REQ-AUTO-04)", () => {
  it("does not import the zustand persist middleware in its source", () => {
    const sourcePath = resolve(
      process.cwd(),
      "src/features/auto-bet/auto-bet.store.ts",
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source.includes("persist")).toBe(false);
    expect(source.includes("zustand/middleware")).toBe(false);
  });
});

describe("auto-bet.store — start / stop", () => {
  it("start(config) initializes the running session", () => {
    const config = validConfig();
    useAutoBetStore.getState().start(config);
    const state = useAutoBetStore.getState();
    expect(state.isRunning).toBe(true);
    expect(state.config).toEqual(config);
    expect(state.sessionPL.toCents()).toBe(0n);
    expect(state.sessionPLSign).toBe(0);
    expect(state.roundCount).toBe(0);
    expect(state.halted).toBe(null);
  });

  it("stop({reason}) halts the session", () => {
    useAutoBetStore.getState().start(validConfig());
    useAutoBetStore.getState().stop({ reason: "stop-win" });
    const state = useAutoBetStore.getState();
    expect(state.isRunning).toBe(false);
    expect(state.halted).toEqual({ reason: "stop-win" });
  });

  it("ignores recordOutcome once halted", () => {
    useAutoBetStore.getState().start(validConfig());
    useAutoBetStore.getState().stop({ reason: "user" });
    useAutoBetStore
      .getState()
      .recordOutcome("loss", cents(1000n), Money.of(0n));
    expect(useAutoBetStore.getState().roundCount).toBe(0);
    expect(useAutoBetStore.getState().sessionPL.toCents()).toBe(0n);
  });
});

describe("auto-bet.store — recordOutcome", () => {
  it("win: adds (payout - betAmount) to sessionPL and increments roundCount", () => {
    useAutoBetStore.getState().start(validConfig());
    useAutoBetStore
      .getState()
      .recordOutcome("win", cents(1000n), cents(2500n));
    const state = useAutoBetStore.getState();
    expect(state.sessionPL.toCents()).toBe(1500n);
    expect(state.sessionPLSign).toBe(1);
    expect(state.roundCount).toBe(1);
    expect(state.lastOutcome).toBe("win");
    expect(state.lastBetAmount?.toCents()).toBe(1000n);
  });

  it("loss: subtracts betAmount from sessionPL and increments roundCount", () => {
    useAutoBetStore.getState().start(validConfig());
    useAutoBetStore
      .getState()
      .recordOutcome("loss", cents(1000n), Money.of(0n));
    const state = useAutoBetStore.getState();
    expect(state.sessionPL.toCents()).toBe(1000n);
    expect(state.sessionPLSign).toBe(-1);
    expect(state.roundCount).toBe(1);
    expect(state.lastOutcome).toBe("loss");
    expect(state.lastBetAmount?.toCents()).toBe(1000n);
  });

  it("refund: no-op for sessionPL and roundCount (Pitfall 8 + Q1)", () => {
    useAutoBetStore.getState().start(validConfig());
    useAutoBetStore
      .getState()
      .recordOutcome("refund", cents(1000n), Money.of(0n));
    const state = useAutoBetStore.getState();
    expect(state.sessionPL.toCents()).toBe(0n);
    expect(state.sessionPLSign).toBe(0);
    expect(state.roundCount).toBe(0);
    expect(state.lastOutcome).toBe(null);
  });
});

describe("auto-bet.store — recordPostedBet", () => {
  it("updates lastBetAmount when the driver POSTs (before outcome arrives)", () => {
    useAutoBetStore.getState().start(validConfig());
    useAutoBetStore.getState().recordPostedBet(cents(4000n));
    expect(useAutoBetStore.getState().lastBetAmount?.toCents()).toBe(4000n);
  });
});
