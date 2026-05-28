// Approach: drive the service through transitionToRunning with a stubbed use-case
// returning a RUNNING Round. Avoids a test-only mutation seam on the production
// class and exercises the actual cache-on-transition contract the cashout path
// depends on.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import { randomUUID } from "node:crypto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { FORMULA_VERSION } from "@crash/contracts";
import { RoundId } from "@crash/shared-kernel";
import { RoundLoopService } from "../../src/application/round-loop.service";
import { StartNewRoundUseCase } from "../../src/application/use-cases/start-new-round.use-case";
import { TransitionToRunningUseCase } from "../../src/application/use-cases/transition-to-running.use-case";
import { CrashRoundUseCase } from "../../src/application/use-cases/crash-round.use-case";
import { SettleRoundUseCase } from "../../src/application/use-cases/settle-round.use-case";
import type { MultiplierBroadcastService } from "../../src/application/multiplier-broadcast.service";
import { Round } from "../../src/domain/round.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";
import type { RoundRepository } from "../../src/domain/round.repository";
import type {
  SeedChainEntry,
  SeedChainRepository,
} from "../../src/domain/seed-chain.repository";

class StubRoundRepository implements RoundRepository {
  async findById(): Promise<Round | null> {
    return null;
  }
  async findOpen(): Promise<Round | null> {
    return null;
  }
  async findServerSeedByNonce(): Promise<string | null> {
    return null;
  }
  async listSettledHistory(): Promise<Round[]> {
    return [];
  }
  async saveScheduled(): Promise<void> {}
  async transitionFromBettingToRunning(): Promise<Round | null> {
    return null;
  }
  async transitionFromRunningToCrashed(): Promise<Round | null> {
    return null;
  }
  async transitionFromCrashedToSettled(): Promise<Round | null> {
    return null;
  }
}

class StubSeedChainRepository implements SeedChainRepository {
  async countEntries(): Promise<bigint> {
    return 0n;
  }
  async insertChain(_entries: SeedChainEntry[]): Promise<void> {}
  async findHashByNonce(): Promise<string | null> {
    return null;
  }
  async findSeedByNonce(): Promise<string | null> {
    return null;
  }
  async revealSeedAtNonce(): Promise<void> {}
}

class StubStartNewRoundUseCase {
  async execute(_now: Date): Promise<Round> {
    throw new Error("not used in these tests");
  }
}

class StubTransitionToRunningUseCase {
  constructor(
    private readonly running: Round,
    private readonly crashPoint: CrashPoint,
    private readonly crashTimeMs: number,
  ) {}
  async execute(
    _round: Round,
    _now: Date,
  ): Promise<{ round: Round; crashPoint: CrashPoint; crashTimeMs: number }> {
    return {
      round: this.running,
      crashPoint: this.crashPoint,
      crashTimeMs: this.crashTimeMs,
    };
  }
}

class StubCrashRoundUseCase {
  async execute(round: Round, crashPoint: CrashPoint, at: Date): Promise<Round> {
    return round.crash(crashPoint, at);
  }
}

class StubSettleRoundUseCase {
  async execute(round: Round): Promise<Round> {
    return round;
  }
}

function buildScheduledRound(bettingEndsAt: Date, createdAt: Date): Round {
  return Round.schedule(
    RoundId(randomUUID()),
    0n,
    "a".repeat(64),
    "deadbeef".repeat(8),
    FORMULA_VERSION,
    bettingEndsAt,
    createdAt,
  );
}

function buildService(
  scheduled: Round,
  crashPoint: CrashPoint,
  crashTimeMs: number,
): RoundLoopService {
  const rounds = new StubRoundRepository();
  const chain = new StubSeedChainRepository();
  const startUC = new StubStartNewRoundUseCase() as unknown as StartNewRoundUseCase;
  const runUC = new StubTransitionToRunningUseCase(
    scheduled,
    crashPoint,
    crashTimeMs,
  ) as unknown as TransitionToRunningUseCase;
  const crashUC = new StubCrashRoundUseCase() as unknown as CrashRoundUseCase;
  const settleUC = new StubSettleRoundUseCase() as unknown as SettleRoundUseCase;
  const emitter = new EventEmitter2();
  const broadcast = {
    start: () => undefined,
    stop: () => undefined,
  } as unknown as MultiplierBroadcastService;
  return new RoundLoopService(
    rounds,
    chain,
    startUC,
    runUC,
    crashUC,
    settleUC,
    emitter,
    broadcast,
  );
}

describe("RoundLoopService.getMultiplierAt", () => {
  let service: RoundLoopService;

  afterEach(async () => {
    if (service) await service.onApplicationShutdown("test");
  });

  test("throws when no round is RUNNING (BETTING in cache)", async () => {
    const t0 = new Date();
    const scheduled = buildScheduledRound(new Date(t0.getTime() + 5_000), t0);
    service = buildService(scheduled, CrashPoint.of(5), 60_000);

    // Cache is empty — nothing transitioned into RUNNING yet.
    expect(() => service.getMultiplierAt(new Date())).toThrow(
      /no RUNNING round/i,
    );
  });

  test("RUNNING + 1s elapsed at GROWTH_RATE=0.06 → e^0.06 ≈ 1.0618", async () => {
    const t0 = new Date();
    const scheduled = buildScheduledRound(new Date(t0.getTime() - 1_000), t0);
    const startedAt = new Date(t0.getTime());
    const running = scheduled.start(startedAt);
    const crashPoint = CrashPoint.of(100);

    // crashTimeMs large enough so the scheduled crash timer never fires during test
    service = buildService(running, crashPoint, 10_000_000);
    // Drive private transitionToRunning via reflection-friendly call: invoke method
    // via bracket access to populate the cached currentRound.
    await (
      service as unknown as { transitionToRunning(r: Round): Promise<void> }
    ).transitionToRunning(scheduled);

    const at = new Date(startedAt.getTime() + 1_000);
    const m = service.getMultiplierAt(at);
    expect(m.toNumber()).toBeCloseTo(Math.exp(0.06), 4);
  });

  test("caps at crashPoint when at would yield a value beyond crashPoint", async () => {
    const t0 = new Date();
    const scheduled = buildScheduledRound(new Date(t0.getTime() - 1_000), t0);
    const startedAt = new Date(t0.getTime());
    const running = scheduled.start(startedAt);
    const crashPoint = CrashPoint.of(5);

    service = buildService(running, crashPoint, 10_000_000);
    await (
      service as unknown as { transitionToRunning(r: Round): Promise<void> }
    ).transitionToRunning(scheduled);

    // exp(0.06 * elapsed/1000) = 8 → elapsed = ln(8)/0.06 * 1000 ≈ 34657 ms
    const beyondCrashMs = Math.ceil((Math.log(8) / 0.06) * 1000);
    const at = new Date(startedAt.getTime() + beyondCrashMs);
    const m = service.getMultiplierAt(at);
    expect(m.toNumber()).toBeCloseTo(5, 4);
  });

  test("clock skew: at earlier than startedAt → returns Multiplier(1.00)", async () => {
    const t0 = new Date();
    const scheduled = buildScheduledRound(new Date(t0.getTime() - 1_000), t0);
    const startedAt = new Date(t0.getTime());
    const running = scheduled.start(startedAt);

    service = buildService(running, CrashPoint.of(100), 10_000_000);
    await (
      service as unknown as { transitionToRunning(r: Round): Promise<void> }
    ).transitionToRunning(scheduled);

    const at = new Date(startedAt.getTime() - 5_000);
    const m = service.getMultiplierAt(at);
    expect(m.toNumber()).toBeCloseTo(1, 4);
  });

  test("after CRASHED transition the cached round is no longer RUNNING → throws", async () => {
    const t0 = new Date();
    const scheduled = buildScheduledRound(new Date(t0.getTime() - 1_000), t0);
    const startedAt = new Date(t0.getTime());
    const running = scheduled.start(startedAt);
    const crashPoint = CrashPoint.of(5);

    service = buildService(running, crashPoint, 10_000_000);
    await (
      service as unknown as { transitionToRunning(r: Round): Promise<void> }
    ).transitionToRunning(scheduled);

    // Drive a manual crashRound to mutate the cache to CRASHED.
    await (
      service as unknown as {
        crashRound(r: Round, c: CrashPoint): Promise<void>;
      }
    ).crashRound(running, crashPoint);

    expect(() => service.getMultiplierAt(new Date())).toThrow(
      /no RUNNING round/i,
    );
  });
});
