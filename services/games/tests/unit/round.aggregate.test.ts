import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { RoundId } from "@crash/shared-kernel";
import { Round } from "../../src/domain/round.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";
import {
  IllegalRoundTransitionError,
  RoundNotInBettingPhaseError,
} from "../../src/domain/errors";

const now = new Date("2026-05-25T12:00:00Z");
const later = new Date("2026-05-25T12:00:05Z");
const crashAt = new Date("2026-05-25T12:00:09Z");
const settleAt = new Date("2026-05-25T12:00:10Z");
const bettingEndsAt = new Date("2026-05-25T12:00:05Z");

const VALID_SEED_HASH = "a".repeat(64);
const VALID_SERVER_SEED = "b".repeat(64);
const CLIENT_SEED = "c".repeat(64);

function freshRound(): Round {
  return Round.schedule(
    RoundId(randomUUID()),
    1n,
    VALID_SEED_HASH,
    CLIENT_SEED,
    1,
    bettingEndsAt,
    now,
  );
}

describe("Round.schedule", () => {
  test("produces a BETTING round with seedHash exposed (REQ-FAIR-05)", () => {
    const round = freshRound();
    expect(round.status).toBe("BETTING");
    expect(round.seedHash).toBe(VALID_SEED_HASH);
    expect(round.serverSeed).toBeNull();
    expect(round.crashPoint).toBeNull();
    expect(round.startedAt).toBeNull();
    expect(round.crashedAt).toBeNull();
    expect(round.settledAt).toBeNull();
    expect(round.createdAt).toEqual(now);
    expect(round.nonce).toBe(1n);
    expect(round.clientSeed).toBe(CLIENT_SEED);
    expect(round.formulaVersion).toBe(1);
    expect(round.bettingEndsAt).toEqual(bettingEndsAt);
  });
});

describe("Round.start", () => {
  test("from BETTING returns RUNNING with startedAt", () => {
    const running = freshRound().start(later);
    expect(running.status).toBe("RUNNING");
    expect(running.startedAt).toEqual(later);
    expect(running.serverSeed).toBeNull();
  });

  test("from RUNNING throws IllegalRoundTransitionError", () => {
    const running = freshRound().start(later);
    try {
      running.start(later);
      throw new Error("expected IllegalRoundTransitionError");
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalRoundTransitionError);
      const ire = err as IllegalRoundTransitionError;
      expect(ire.code).toBe("ILLEGAL_ROUND_TRANSITION");
      expect(ire.from).toBe("RUNNING");
      expect(ire.to).toBe("RUNNING");
    }
  });

  test("from CRASHED throws", () => {
    const crashed = freshRound().start(later).crash(CrashPoint.of(2.5), crashAt);
    expect(() => crashed.start(later)).toThrow(IllegalRoundTransitionError);
  });

  test("from SETTLED throws", () => {
    const settled = freshRound()
      .start(later)
      .crash(CrashPoint.of(2.5), crashAt)
      .settle(VALID_SERVER_SEED, settleAt);
    expect(() => settled.start(later)).toThrow(IllegalRoundTransitionError);
  });
});

describe("Round.crash", () => {
  test("from RUNNING returns CRASHED with crashPoint set", () => {
    const cp = CrashPoint.of(3.14);
    const crashed = freshRound().start(later).crash(cp, crashAt);
    expect(crashed.status).toBe("CRASHED");
    expect(crashed.crashPoint).toBe(cp);
    expect(crashed.crashedAt).toEqual(crashAt);
    expect(crashed.serverSeed).toBeNull();
  });

  test("from BETTING throws", () => {
    const round = freshRound();
    expect(() => round.crash(CrashPoint.of(2.5), crashAt)).toThrow(
      IllegalRoundTransitionError,
    );
  });

  test("from CRASHED throws (no double-crash)", () => {
    const crashed = freshRound().start(later).crash(CrashPoint.of(2.5), crashAt);
    expect(() => crashed.crash(CrashPoint.of(3.0), crashAt)).toThrow(
      IllegalRoundTransitionError,
    );
  });
});

describe("Round.settle", () => {
  test("from CRASHED returns SETTLED with serverSeed populated (REQ-FAIR-02)", () => {
    const settled = freshRound()
      .start(later)
      .crash(CrashPoint.of(2.5), crashAt)
      .settle(VALID_SERVER_SEED, settleAt);
    expect(settled.status).toBe("SETTLED");
    expect(settled.serverSeed).toBe(VALID_SERVER_SEED);
    expect(settled.settledAt).toEqual(settleAt);
  });

  test("from RUNNING throws (cannot reveal pre-crash, REQ-FAIR-02)", () => {
    const running = freshRound().start(later);
    expect(() => running.settle(VALID_SERVER_SEED, settleAt)).toThrow(
      IllegalRoundTransitionError,
    );
  });

  test("from BETTING throws", () => {
    expect(() => freshRound().settle(VALID_SERVER_SEED, settleAt)).toThrow(
      IllegalRoundTransitionError,
    );
  });

  test("with invalid seed hex throws", () => {
    const crashed = freshRound().start(later).crash(CrashPoint.of(2.5), crashAt);
    expect(() => crashed.settle("not-hex", settleAt)).toThrow();
  });
});

describe("Round.rehydrate", () => {
  test("round-trip preserves every prop", () => {
    const id = RoundId(randomUUID());
    const cp = CrashPoint.of(5.5);
    const round = Round.rehydrate({
      id,
      nonce: 42n,
      status: "SETTLED",
      seedHash: VALID_SEED_HASH,
      clientSeed: CLIENT_SEED,
      serverSeed: VALID_SERVER_SEED,
      crashPoint: cp,
      formulaVersion: 1,
      bettingEndsAt,
      startedAt: later,
      crashedAt: crashAt,
      settledAt: settleAt,
      createdAt: now,
    });

    expect(round.id).toBe(id);
    expect(round.nonce).toBe(42n);
    expect(round.status).toBe("SETTLED");
    expect(round.seedHash).toBe(VALID_SEED_HASH);
    expect(round.clientSeed).toBe(CLIENT_SEED);
    expect(round.serverSeed).toBe(VALID_SERVER_SEED);
    expect(round.crashPoint).toBe(cp);
    expect(round.formulaVersion).toBe(1);
    expect(round.bettingEndsAt).toEqual(bettingEndsAt);
    expect(round.startedAt).toEqual(later);
    expect(round.crashedAt).toEqual(crashAt);
    expect(round.settledAt).toEqual(settleAt);
    expect(round.createdAt).toEqual(now);
  });
});

describe("Round immutability (snapshot semantics)", () => {
  test("start() on a BETTING round leaves the original instance untouched", () => {
    const r = freshRound();
    r.start(later);
    expect(r.status).toBe("BETTING");
    expect(r.startedAt).toBeNull();
  });

  test("ADR-014: Round still has no bets collection (acceptBet is a pure FSM guard, not aggregate ownership)", () => {
    const round = freshRound() as unknown as { bets?: unknown };
    expect(round.bets).toBeUndefined();
  });
});

describe("Round.acceptBet", () => {
  test("from BETTING returns a Round still in BETTING with identity-preserving snapshot (REQ-GAME-08)", () => {
    const round = freshRound();
    const next = round.acceptBet(now);
    expect(next.status).toBe("BETTING");
    expect(next.id).toBe(round.id);
    expect(next.nonce).toBe(round.nonce);
    expect(next.bettingEndsAt).toEqual(round.bettingEndsAt);
    expect(next.seedHash).toBe(round.seedHash);
    expect(next.serverSeed).toBeNull();
  });

  test("from RUNNING throws RoundNotInBettingPhaseError carrying actual=RUNNING", () => {
    const running = freshRound().start(later);
    try {
      running.acceptBet(later);
      throw new Error("expected RoundNotInBettingPhaseError");
    } catch (err) {
      expect(err).toBeInstanceOf(RoundNotInBettingPhaseError);
      const e = err as RoundNotInBettingPhaseError;
      expect(e.name).toBe("RoundNotInBettingPhaseError");
      expect(e.code).toBe("ROUND_NOT_IN_BETTING_PHASE");
      expect(e.actual).toBe("RUNNING");
    }
  });

  test("from CRASHED throws RoundNotInBettingPhaseError carrying actual=CRASHED", () => {
    const crashed = freshRound().start(later).crash(CrashPoint.of(2.5), crashAt);
    try {
      crashed.acceptBet(crashAt);
      throw new Error("expected RoundNotInBettingPhaseError");
    } catch (err) {
      expect(err).toBeInstanceOf(RoundNotInBettingPhaseError);
      expect((err as RoundNotInBettingPhaseError).actual).toBe("CRASHED");
    }
  });

  test("from SETTLED throws RoundNotInBettingPhaseError carrying actual=SETTLED", () => {
    const settled = freshRound()
      .start(later)
      .crash(CrashPoint.of(2.5), crashAt)
      .settle(VALID_SERVER_SEED, settleAt);
    try {
      settled.acceptBet(settleAt);
      throw new Error("expected RoundNotInBettingPhaseError");
    } catch (err) {
      expect(err).toBeInstanceOf(RoundNotInBettingPhaseError);
      expect((err as RoundNotInBettingPhaseError).actual).toBe("SETTLED");
    }
  });

  test("RoundNotInBettingPhaseError exposes readonly actual and stable name/code", () => {
    const err = new RoundNotInBettingPhaseError("RUNNING");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RoundNotInBettingPhaseError");
    expect(err.code).toBe("ROUND_NOT_IN_BETTING_PHASE");
    expect(err.actual).toBe("RUNNING");
    expect(err.message).toContain("RUNNING");
  });
});
