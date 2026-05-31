import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { expect, test } from "bun:test";
import fc from "fast-check";
import { randomUUID } from "node:crypto";
import { RoundId } from "@crash/shared-kernel/identity";
import { Round } from "../../src/domain/round.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";
import type { RoundStatus } from "../../src/domain/value-objects/round-status";
import { IllegalRoundTransitionError } from "../../src/domain/errors";

type Action = { kind: "start" } | { kind: "crash" } | { kind: "settle" };

const SEED_HASH = "a".repeat(64);
const CLIENT_SEED = "c".repeat(64);
const SERVER_SEED = "b".repeat(64);
const baseDate = new Date("2026-05-25T12:00:00Z");
const bettingEndsAt = new Date("2026-05-25T12:00:05Z");

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.constant<Action>({ kind: "start" }),
  fc.constant<Action>({ kind: "crash" }),
  fc.constant<Action>({ kind: "settle" }),
);

const actionsArb = fc.array(actionArb, { minLength: 0, maxLength: 25 });

function freshRound(): Round {
  return Round.schedule(RoundId(randomUUID()), 1n, SEED_HASH, CLIENT_SEED, 1, bettingEndsAt, baseDate);
}

function legalNextStatus(current: RoundStatus, action: Action): RoundStatus | null {
  if (current === "BETTING" && action.kind === "start") return "RUNNING";
  if (current === "RUNNING" && action.kind === "crash") return "CRASHED";
  if (current === "CRASHED" && action.kind === "settle") return "SETTLED";
  return null;
}

test(
  "no illegal Round FSM transition reachable across random command sequences",
  () => {
    fc.assert(
      fc.property(actionsArb, (actions) => {
        let round = freshRound();
        for (const action of actions) {
          const before = round.status;
          const target = legalNextStatus(before, action);
          if (target === null) {
            let threw = false;
            try {
              if (action.kind === "start") round.start(baseDate);
              else if (action.kind === "crash") round.crash(CrashPoint.of(2.5), baseDate);
              else round.settle(SERVER_SEED, baseDate);
            } catch (err) {
              threw = true;
              expect(err).toBeInstanceOf(IllegalRoundTransitionError);
            }
            expect(threw).toBe(true);
            expect(round.status).toBe(before);
            if (before !== "SETTLED") expect(round.serverSeed).toBeNull();
            continue;
          }
          if (action.kind === "start") round = round.start(baseDate);
          else if (action.kind === "crash") round = round.crash(CrashPoint.of(2.5), baseDate);
          else round = round.settle(SERVER_SEED, baseDate);
          expect(round.status).toBe(target);
          if (round.status !== "SETTLED") {
            expect(round.serverSeed).toBeNull();
          } else {
            expect(round.serverSeed).toBe(SERVER_SEED);
          }
        }
      }),
      { numRuns: 500 },
    );
  },
  20_000,
);

test("sanity: illegal status check inverted makes the property fail", () => {
  expect(() =>
    fc.assert(
      fc.property(fc.constant(null), () => {
        const r = freshRound();
        r.crash(CrashPoint.of(2), baseDate);
      }),
      { numRuns: 1 },
    ),
  ).toThrow();
});
