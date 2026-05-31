import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RoundId } from "@crash/shared-kernel/identity";
import { Round } from "../../src/domain/round.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";
import { isBettingOpen } from "../../src/domain/round-betting-window.service";

const SEED_HASH = "a".repeat(64);
const CLIENT_SEED = "c".repeat(64);
const SERVER_SEED = "b".repeat(64);

const t0 = new Date("2026-05-25T12:00:00Z");
const future = new Date("2026-05-25T12:00:05Z");
const past = new Date("2026-05-25T11:59:55Z");

function bettingRound(bettingEndsAt: Date): Round {
  return Round.schedule(RoundId(randomUUID()), 1n, SEED_HASH, CLIENT_SEED, 1, bettingEndsAt, t0);
}

describe("isBettingOpen domain service", () => {
  test("returns true for BETTING round with bettingEndsAt in the future", () => {
    const round = bettingRound(future);
    expect(isBettingOpen(round, t0)).toBe(true);
  });

  test("returns false for BETTING round whose window already closed", () => {
    const round = bettingRound(past);
    expect(isBettingOpen(round, t0)).toBe(false);
  });

  test("returns false for RUNNING regardless of bettingEndsAt", () => {
    const round = bettingRound(future).start(t0);
    expect(isBettingOpen(round, t0)).toBe(false);
  });

  test("returns false for CRASHED regardless of bettingEndsAt", () => {
    const round = bettingRound(future).start(t0).crash(CrashPoint.of(2), future);
    expect(isBettingOpen(round, t0)).toBe(false);
  });

  test("returns false for SETTLED regardless of bettingEndsAt", () => {
    const round = bettingRound(future)
      .start(t0)
      .crash(CrashPoint.of(2), future)
      .settle(SERVER_SEED, future);
    expect(isBettingOpen(round, t0)).toBe(false);
  });

  test("returns false when now === bettingEndsAt (strict inequality)", () => {
    const round = bettingRound(future);
    expect(isBettingOpen(round, future)).toBe(false);
  });
});
