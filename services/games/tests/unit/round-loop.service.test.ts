import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import "../setup";
import { randomUUID } from "node:crypto";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { generateSeedChain, FORMULA_VERSION } from "@crash/contracts";
import { RoundId, type BetId, type PlayerId } from "@crash/shared-kernel";
import { RoundLoopService } from "../../src/application/round-loop.service";
import { StartNewRoundUseCase } from "../../src/application/use-cases/start-new-round.use-case";
import { TransitionToRunningUseCase } from "../../src/application/use-cases/transition-to-running.use-case";
import { CrashRoundUseCase } from "../../src/application/use-cases/crash-round.use-case";
import { SettleRoundUseCase } from "../../src/application/use-cases/settle-round.use-case";
import { GAME_EVENTS } from "../../src/application/game-events";
import { MultiplierBroadcastService } from "../../src/application/multiplier-broadcast.service";
import { Round } from "../../src/domain/round.aggregate";
import { Bet } from "../../src/domain/bet.aggregate";
import { CrashPoint } from "../../src/domain/value-objects/crash-point";
import type { RoundRepository } from "../../src/domain/round.repository";
import type { BetRepository } from "../../src/domain/bet.repository";
import type {
  SeedChainEntry,
  SeedChainRepository,
} from "../../src/domain/seed-chain.repository";
import type { BetStatus } from "../../src/domain/value-objects/bet-status";
import type { BetProps } from "../../src/domain/bet.aggregate";

class InMemoryRoundRepository implements RoundRepository {
  public readonly stored = new Map<string, Round>();

  async findById(id: RoundId): Promise<Round | null> {
    return this.stored.get(id as unknown as string) ?? null;
  }

  async findOpen(): Promise<Round | null> {
    for (const round of this.stored.values()) {
      if (round.status !== "SETTLED") return round;
    }
    return null;
  }

  async findServerSeedByNonce(nonce: bigint): Promise<string | null> {
    for (const round of this.stored.values()) {
      if (round.nonce === nonce) return round.serverSeed;
    }
    return null;
  }

  async listSettledHistory(limit: number, offset: number): Promise<Round[]> {
    const settled = [...this.stored.values()]
      .filter((r) => r.status === "SETTLED")
      .sort((a, b) => (b.settledAt!.getTime() - a.settledAt!.getTime()));
    return settled.slice(offset, offset + limit);
  }

  async saveScheduled(round: Round): Promise<void> {
    this.stored.set(round.id as unknown as string, round);
  }

  async transitionFromBettingToRunning(
    id: RoundId,
    startedAt: Date,
  ): Promise<Round | null> {
    const current = this.stored.get(id as unknown as string);
    if (!current || current.status !== "BETTING") return null;
    const next = current.start(startedAt);
    this.stored.set(id as unknown as string, next);
    return next;
  }

  async transitionFromRunningToCrashed(
    id: RoundId,
    crashPoint: CrashPoint,
    crashedAt: Date,
  ): Promise<Round | null> {
    const current = this.stored.get(id as unknown as string);
    if (!current || current.status !== "RUNNING") return null;
    const next = current.crash(crashPoint, crashedAt);
    this.stored.set(id as unknown as string, next);
    return next;
  }

  async transitionFromCrashedToSettled(
    id: RoundId,
    serverSeed: string,
    settledAt: Date,
  ): Promise<Round | null> {
    const current = this.stored.get(id as unknown as string);
    if (!current || current.status !== "CRASHED") return null;
    const next = current.settle(serverSeed, settledAt);
    this.stored.set(id as unknown as string, next);
    return next;
  }
}

class InMemoryBetRepository implements BetRepository {
  public readonly stored = new Map<string, Bet>();
  public readonly transitionCalls: Array<{ id: BetId; from: BetStatus; to: BetStatus }> = [];

  async findById(id: BetId): Promise<Bet | null> {
    return this.stored.get(id as unknown as string) ?? null;
  }

  async findActiveByRoundAndPlayer(): Promise<Bet | null> {
    return null;
  }

  async findActiveByRound(): Promise<Bet[]> {
    return [...this.stored.values()].filter(
      (b) => b.status === "ACTIVE" || b.status === "PENDING",
    );
  }

  async countByRoundId(): Promise<number> {
    return this.stored.size;
  }

  async listByPlayer(): Promise<Bet[]> {
    return [];
  }

  async save(bet: Bet): Promise<void> {
    this.stored.set(bet.id as unknown as string, bet);
  }

  async tryTransition(
    id: BetId,
    from: BetStatus,
    to: BetStatus,
    patch: Partial<BetProps>,
  ): Promise<Bet | null> {
    this.transitionCalls.push({ id, from, to });
    const current = this.stored.get(id as unknown as string);
    if (!current || current.status !== from) return null;
    if (to === "LOST" && current.status === "ACTIVE") {
      const next = current.lose();
      this.stored.set(id as unknown as string, next);
      return next;
    }
    void patch;
    return current;
  }
}

class InMemorySeedChainRepository implements SeedChainRepository {
  public readonly stored: SeedChainEntry[] = [];
  public revealCalls: Array<{ nonce: bigint; seed: string }> = [];

  async countEntries(): Promise<bigint> {
    return BigInt(this.stored.length);
  }

  async insertChain(entries: SeedChainEntry[]): Promise<void> {
    for (const e of entries) this.stored.push(e);
  }

  async findHashByNonce(nonce: bigint): Promise<string | null> {
    return this.stored.find((e) => e.nonce === nonce)?.hash ?? null;
  }

  async findSeedByNonce(nonce: bigint): Promise<string | null> {
    return this.stored.find((e) => e.nonce === nonce)?.seed ?? null;
  }

  async revealSeedAtNonce(nonce: bigint, seed: string): Promise<void> {
    this.revealCalls.push({ nonce, seed });
  }
}

type FakeMultiplierBroadcast = {
  start: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
};

type Harness = {
  loop: RoundLoopService;
  rounds: InMemoryRoundRepository;
  bets: InMemoryBetRepository;
  chain: InMemorySeedChainRepository;
  emitter: EventEmitter2;
  emitSpy: ReturnType<typeof mock>;
  broadcast: FakeMultiplierBroadcast;
};

function buildHarness(): Harness {
  const rounds = new InMemoryRoundRepository();
  const bets = new InMemoryBetRepository();
  const chain = new InMemorySeedChainRepository();
  for (const e of generateSeedChain(32n)) {
    chain.stored.push(e);
  }
  const startUC = new StartNewRoundUseCase(rounds, chain);
  const runUC = new TransitionToRunningUseCase(rounds, chain);
  const em = {
    async transactional<T>(cb: (em: unknown) => Promise<T>): Promise<T> {
      return cb(em);
    },
  };
  const outbox = {
    async add(): Promise<void> {},
  };
  const noopCounter = { inc: () => undefined } as never;
  const noopGauge = { set: () => undefined, inc: () => undefined, dec: () => undefined } as never;
  const crashUC = new CrashRoundUseCase(
    em as unknown as never,
    outbox as unknown as never,
    rounds,
    bets,
    noopCounter,
  );
  const settleUC = new SettleRoundUseCase(rounds, chain, bets, noopGauge);
  const emitter = new EventEmitter2();
  const emitSpy = mock((..._args: unknown[]) => true);
  emitter.emit = emitSpy as unknown as typeof emitter.emit;
  const broadcast: FakeMultiplierBroadcast = {
    start: mock((_roundId: string) => undefined),
    stop: mock(() => undefined),
  };
  const loop = new RoundLoopService(
    rounds,
    chain,
    startUC,
    runUC,
    crashUC,
    settleUC,
    emitter,
    broadcast as unknown as MultiplierBroadcastService,
  );
  return { loop, rounds, bets, chain, emitter, emitSpy, broadcast };
}

function scheduledRound(
  rounds: InMemoryRoundRepository,
  chain: InMemorySeedChainRepository,
  bettingEndsAt: Date,
  createdAt: Date,
): Round {
  const nonce = 0n;
  const hash = chain.stored.find((e) => e.nonce === nonce)!.hash;
  const round = Round.schedule(
    RoundId(randomUUID()),
    nonce,
    hash,
    "deadbeef".repeat(8),
    FORMULA_VERSION,
    bettingEndsAt,
    createdAt,
  );
  rounds.stored.set(round.id as unknown as string, round);
  return round;
}

describe("RoundLoopService", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  afterEach(async () => {
    await harness.loop.onApplicationShutdown("test");
  });

  test("no open round → bootstrap starts a new BETTING round", async () => {
    await harness.loop.onApplicationBootstrap();

    const open = await harness.rounds.findOpen();
    expect(open).not.toBeNull();
    expect(open!.status).toBe("BETTING");
    expect(open!.nonce).toBe(0n);
  });

  test("recovery from BETTING with bettingEndsAt in the past → transitions to RUNNING", async () => {
    const now = new Date();
    const pastEnd = new Date(now.getTime() - 1_000);
    scheduledRound(harness.rounds, harness.chain, pastEnd, new Date(now.getTime() - 6_000));

    await harness.loop.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 20));

    const open = await harness.rounds.findOpen();
    expect(open!.status).toBe("RUNNING");
    expect(open!.startedAt).not.toBeNull();
  });

  test("recovery from RUNNING with crash time in the past → crashes immediately", async () => {
    const now = new Date();
    const startedAt = new Date(now.getTime() - 60_000);
    const round = scheduledRound(
      harness.rounds,
      harness.chain,
      new Date(now.getTime() - 55_000),
      new Date(now.getTime() - 65_000),
    );
    const running = round.start(startedAt);
    harness.rounds.stored.set(running.id as unknown as string, running);

    await harness.loop.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 50));

    const reloaded = await harness.rounds.findById(running.id);
    expect(reloaded!.status === "CRASHED" || reloaded!.status === "SETTLED").toBe(true);
  });

  test("recovery from CRASHED → settles immediately and reveals seed", async () => {
    const now = new Date();
    const round = scheduledRound(
      harness.rounds,
      harness.chain,
      new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 15_000),
    );
    const running = round.start(new Date(now.getTime() - 8_000));
    const crashed = running.crash(CrashPoint.of(2.5), new Date(now.getTime() - 1_000));
    harness.rounds.stored.set(crashed.id as unknown as string, crashed);

    await harness.loop.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 20));

    const reloaded = await harness.rounds.findById(crashed.id);
    expect(reloaded!.status).toBe("SETTLED");
    expect(reloaded!.serverSeed).not.toBeNull();
    expect(harness.chain.revealCalls.length).toBeGreaterThan(0);
  });

  test("recovery branches cover BETTING, RUNNING, CRASHED, SETTLED, and no-open", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").resolve(
        __dirname,
        "../../src/application/round-loop.service.ts",
      ),
      "utf8",
    ) as string;
    expect(source).toContain('case "BETTING"');
    expect(source).toContain('case "RUNNING"');
    expect(source).toContain('case "CRASHED"');
    expect(source).toContain('case "SETTLED"');
    expect(source).toMatch(/open === null/);
  });

  test("OnApplicationShutdown clears the pending timer and halts scheduling", async () => {
    await harness.loop.onApplicationBootstrap();
    await harness.loop.onApplicationShutdown("SIGTERM");

    const openBefore = await harness.rounds.findOpen();
    await new Promise((r) => setTimeout(r, 50));
    const openAfter = await harness.rounds.findOpen();
    expect(openAfter!.status).toBe(openBefore!.status);
  });

  test("bootstrap → startNewRound emits round.started with payload matching the new round", async () => {
    await harness.loop.onApplicationBootstrap();

    const startedCalls = harness.emitSpy.mock.calls.filter(
      (c) => c[0] === GAME_EVENTS.ROUND_STARTED,
    );
    expect(startedCalls.length).toBe(1);
    const [, payload] = startedCalls[0] as [string, Record<string, unknown>];
    const open = await harness.rounds.findOpen();
    expect(payload).toEqual({
      roundId: open!.id as unknown as string,
      nonce: open!.nonce.toString(),
      seedHash: open!.seedHash,
      bettingEndsAt: open!.bettingEndsAt.toISOString(),
    });
  });

  test("transitionToRunning calls multiplierBroadcast.start once and emits round.running", async () => {
    const now = new Date();
    const pastEnd = new Date(now.getTime() - 1_000);
    scheduledRound(
      harness.rounds,
      harness.chain,
      pastEnd,
      new Date(now.getTime() - 6_000),
    );

    await harness.loop.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 30));

    const open = await harness.rounds.findOpen();
    expect(harness.broadcast.start).toHaveBeenCalledTimes(1);
    expect(harness.broadcast.start.mock.calls[0][0]).toBe(
      open!.id as unknown as string,
    );

    const runningCalls = harness.emitSpy.mock.calls.filter(
      (c) => c[0] === GAME_EVENTS.ROUND_RUNNING,
    );
    expect(runningCalls.length).toBe(1);
    const [, payload] = runningCalls[0] as [string, Record<string, unknown>];
    expect(payload).toEqual({
      roundId: open!.id as unknown as string,
      startedAt: open!.startedAt!.toISOString(),
    });
  });

  test("crashRound calls multiplierBroadcast.stop BEFORE emitting round.crashed", async () => {
    const now = new Date();
    const round = scheduledRound(
      harness.rounds,
      harness.chain,
      new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 15_000),
    );
    const running = round.start(new Date(now.getTime() - 60_000));
    harness.rounds.stored.set(running.id as unknown as string, running);

    await harness.loop.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 50));

    expect(harness.broadcast.stop).toHaveBeenCalledTimes(1);
    const stopOrder = harness.broadcast.stop.mock.invocationCallOrder[0];

    const crashedCalls = harness.emitSpy.mock.calls
      .map((c, i) => ({ name: c[0], order: harness.emitSpy.mock.invocationCallOrder[i] }))
      .filter((c) => c.name === GAME_EVENTS.ROUND_CRASHED);
    expect(crashedCalls.length).toBe(1);
    expect(stopOrder).toBeLessThan(crashedCalls[0].order);

    const [, payload] = harness.emitSpy.mock.calls.filter(
      (c) => c[0] === GAME_EVENTS.ROUND_CRASHED,
    )[0] as [string, Record<string, unknown>];
    expect(payload.roundId).toBe(running.id as unknown as string);
    expect(typeof payload.crashPoint).toBe("number");
    expect(typeof payload.crashedAt).toBe("string");
  });

  test("settleRound emits round.settled with serverSeed populated and conforms to schema", async () => {
    const now = new Date();
    const round = scheduledRound(
      harness.rounds,
      harness.chain,
      new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 15_000),
    );
    const running = round.start(new Date(now.getTime() - 8_000));
    const crashed = running.crash(CrashPoint.of(2.5), new Date(now.getTime() - 1_000));
    harness.rounds.stored.set(crashed.id as unknown as string, crashed);

    await harness.loop.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 30));

    const settledCalls = harness.emitSpy.mock.calls.filter(
      (c) => c[0] === GAME_EVENTS.ROUND_SETTLED,
    );
    expect(settledCalls.length).toBe(1);
    const [, payload] = settledCalls[0] as [string, Record<string, unknown>];
    expect(payload.roundId).toBe(crashed.id as unknown as string);
    expect(typeof payload.serverSeed).toBe("string");
    expect((payload.serverSeed as string).length).toBeGreaterThan(0);
    expect(typeof payload.settledAt).toBe("string");
  });

  test("crash sweep transitions ACTIVE bets to LOST in a single pass", async () => {
    const now = new Date();
    const round = scheduledRound(
      harness.rounds,
      harness.chain,
      new Date(now.getTime() - 10_000),
      new Date(now.getTime() - 15_000),
    );
    const running = round.start(new Date(now.getTime() - 8_000));
    const crashed = running.crash(CrashPoint.of(2.5), new Date(now.getTime() - 1_000));
    harness.rounds.stored.set(crashed.id as unknown as string, crashed);

    const { Money } = await import("@crash/shared-kernel");
    const activeBet = Bet.place(
      "bet-1" as unknown as BetId,
      crashed.id,
      "player-1" as unknown as PlayerId,
      Money.of(1_000n),
      new Date(now.getTime() - 5_000),
    ).confirm();
    harness.bets.stored.set("bet-1", activeBet);

    await harness.loop.onApplicationBootstrap();
    await new Promise((r) => setTimeout(r, 30));

    const reloaded = await harness.bets.findById("bet-1" as unknown as BetId);
    expect(reloaded!.status).toBe("LOST");
    expect(harness.bets.transitionCalls.some((c) => c.from === "ACTIVE" && c.to === "LOST")).toBe(true);
  });
});
