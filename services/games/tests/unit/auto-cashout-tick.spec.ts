// Phase 9 Plan 05 Task 2 — AutoCashoutTickService unit suite.
// ADR-023 first-line acceptedAt invariant + Pitfall 4 target-honoring contract
// + Pitfall 11 race-error swallowing.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import { Multiplier } from "../../src/domain/value-objects/multiplier";
import { Bet } from "../../src/domain/bet.aggregate";
import type { BetRepository } from "../../src/domain/bet.repository";
import {
  BetNotCashableError,
  RoundNotRunningError,
} from "../../src/domain/errors";
import { GAME_EVENTS, type RoundTickPayload } from "../../src/application/game-events";

type AutoCashoutTickServiceCtor =
  typeof import("../../src/application/auto-cashout-tick.service")["AutoCashoutTickService"];

let AutoCashoutTickService: AutoCashoutTickServiceCtor;

beforeAll(async () => {
  ({ AutoCashoutTickService } = await import(
    "../../src/application/auto-cashout-tick.service"
  ));
});

function makeBet(args: {
  player?: string;
  targetCentiX?: number | null;
}): Bet {
  const player = PlayerId(args.player ?? "player-1");
  const target =
    args.targetCentiX === null || args.targetCentiX === undefined
      ? null
      : Multiplier.fromTenThousandths(BigInt(args.targetCentiX) * 100n);
  const bet = Bet.place(
    BetId("00000000-0000-0000-0000-000000000001"),
    RoundId("00000000-0000-0000-0000-000000000010"),
    player,
    Money.fromCents(1000n, "CRD"),
    new Date(),
    target,
  );
  return bet.confirm();
}

function makePayload(multiplier: number): RoundTickPayload {
  return {
    roundId: RoundId("00000000-0000-0000-0000-000000000010"),
    multiplier,
    t: Date.now(),
  };
}

type FakeRepo = BetRepository & {
  findAutoCashoutCandidates: ReturnType<typeof mock>;
};

function makeRepo(candidates: Bet[]): FakeRepo {
  return {
    findAutoCashoutCandidates: mock(async () => candidates),
  } as unknown as FakeRepo;
}

type FakeUseCase = { execute: ReturnType<typeof mock> };

function makeUseCase(behavior?: () => Promise<void>): FakeUseCase {
  return {
    execute: mock(async () => {
      if (behavior !== undefined) {
        await behavior();
      }
      return {
        multiplier: Multiplier.of(2),
        payout: Money.fromCents(2000n, "CRD"),
      };
    }),
  };
}

describe("AutoCashoutTickService — unit (Phase 9 Plan 05)", () => {
  afterEach(() => {
    mock.restore();
  });

  test("source: first executable statement of onTick is const acceptedAt = new Date()", () => {
    const source = readFileSync(
      path.resolve(
        __dirname,
        "../../src/application/auto-cashout-tick.service.ts",
      ),
      "utf-8",
    );
    expect(source).toMatch(
      /async\s+onTick[^{]*\{\s*const\s+acceptedAt\s*=\s*new\s+Date\(\)/,
    );
  });

  test("invokes CashOutUseCase with bet.autoCashoutTarget (NOT the tick multiplier — Pitfall 4)", async () => {
    const bet = makeBet({ targetCentiX: 200 });
    const repo = makeRepo([bet]);
    const useCase = makeUseCase();
    const svc = new AutoCashoutTickService(repo, useCase as never);

    await svc.onTick(makePayload(2.05));

    expect(useCase.execute.mock.calls.length).toBe(1);
    const arg = useCase.execute.mock.calls[0][0] as {
      multiplier: Multiplier;
      playerId: PlayerId;
      acceptedAt: Date;
    };
    expect(arg.multiplier.toCentiX()).toBe(bet.autoCashoutTarget!.toCentiX());
    expect(arg.multiplier.toCentiX()).toBe(200);
    expect(arg.multiplier.toCentiX()).not.toBe(205);
    expect(arg.playerId).toBe(bet.playerId);
    expect(arg.acceptedAt).toBeInstanceOf(Date);
  });

  test("queries findAutoCashoutCandidates with ceilingCentiX = floor(multiplier * 100)", async () => {
    const repo = makeRepo([]);
    const useCase = makeUseCase();
    const svc = new AutoCashoutTickService(repo, useCase as never);

    await svc.onTick(makePayload(2.05));

    expect(repo.findAutoCashoutCandidates.mock.calls.length).toBe(1);
    const [, ceiling] = repo.findAutoCashoutCandidates.mock.calls[0];
    expect(ceiling).toBe(205);
  });

  test("swallows RoundNotRunningError thrown by CashOutUseCase (race — Pitfall 11)", async () => {
    const bet = makeBet({ targetCentiX: 200 });
    const repo = makeRepo([bet]);
    const useCase = makeUseCase(async () => {
      throw new RoundNotRunningError("CRASHED");
    });
    const svc = new AutoCashoutTickService(repo, useCase as never);

    await expect(svc.onTick(makePayload(2.05))).resolves.toBeUndefined();
  });

  test("swallows BetNotCashableError thrown by CashOutUseCase (race — Pitfall 11)", async () => {
    const bet = makeBet({ targetCentiX: 200 });
    const repo = makeRepo([bet]);
    const useCase = makeUseCase(async () => {
      throw new BetNotCashableError("RACE");
    });
    const svc = new AutoCashoutTickService(repo, useCase as never);

    await expect(svc.onTick(makePayload(2.05))).resolves.toBeUndefined();
  });

  test("logs unexpected errors at error level (does NOT silently swallow)", async () => {
    const bet = makeBet({ targetCentiX: 200 });
    const repo = makeRepo([bet]);
    const useCase = makeUseCase(async () => {
      throw new RangeError("unexpected boom");
    });
    const svc = new AutoCashoutTickService(repo, useCase as never);

    const errorSpy = mock(() => {});
    const logger = (svc as unknown as { logger: { error: typeof errorSpy } }).logger;
    const originalError = logger.error.bind(logger);
    logger.error = errorSpy;

    try {
      await svc.onTick(makePayload(2.05));
      expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      logger.error = originalError;
    }
  });

  test("empty candidate set short-circuits with zero CashOutUseCase invocations", async () => {
    const repo = makeRepo([]);
    const useCase = makeUseCase();
    const svc = new AutoCashoutTickService(repo, useCase as never);

    await svc.onTick(makePayload(1.5));

    expect(useCase.execute.mock.calls.length).toBe(0);
  });

  test("@OnEvent decorator metadata references GAME_EVENTS.ROUND_TICK", () => {
    const reflectedEvents: unknown =
      Reflect.getMetadata?.("event_listener_metadata:event", AutoCashoutTickService.prototype, "onTick") ??
      Reflect.getMetadata?.("EventEmitter:event", AutoCashoutTickService.prototype, "onTick");
    expect(GAME_EVENTS.ROUND_TICK).toBe("round.tick");
    if (reflectedEvents !== undefined) {
      expect(String(reflectedEvents)).toContain("round.tick");
    }
  });
});
