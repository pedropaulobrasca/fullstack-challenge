// Phase 9 Plan 05 Task 1 — MultiplierBroadcastService.fireTick emits an
// in-process GAME_EVENTS.ROUND_TICK alongside the volatile ws emit.
// Broadcast loop is byte-stable except for the new emit; cadence preserved.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { MultiplierBroadcastService } from "../../src/application/multiplier-broadcast.service";
import { GAME_EVENTS, type RoundTickPayload } from "../../src/application/game-events";
import type { RoundLoopService } from "../../src/application/round-loop.service";
import type { GameWsGateway } from "../../src/presentation/gateways/game-ws.gateway";

type Built = {
  service: MultiplierBroadcastService;
  emitter: EventEmitter2;
  volatileEmit: ReturnType<typeof mock>;
  multiplierFn: ReturnType<typeof mock>;
};

function buildService(opts: {
  multiplierFactory?: () => { toNumber: () => number };
  throwOnTick?: boolean;
} = {}): Built {
  const multiplierFactory =
    opts.multiplierFactory ?? (() => ({ toNumber: () => 2.5 }));
  const volatileEmit = mock();
  const toRoom = mock(() => ({ volatile: { emit: volatileEmit } }));
  const gateway = { server: { to: toRoom } } as unknown as GameWsGateway;
  const multiplierFn = mock(() => {
    if (opts.throwOnTick) {
      throw new Error("no RUNNING round available for multiplier query");
    }
    return multiplierFactory();
  });
  const roundLoop = { getMultiplierAt: multiplierFn } as unknown as RoundLoopService;
  const emitter = new EventEmitter2();
  const service = new MultiplierBroadcastService(roundLoop, gateway, emitter);
  return { service, emitter, volatileEmit, multiplierFn };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("MultiplierBroadcastService — ROUND_TICK in-process emit (Phase 9 Plan 05)", () => {
  let active: MultiplierBroadcastService | null = null;

  beforeEach(() => {
    active = null;
  });

  afterEach(() => {
    if (active !== null) {
      active.stop();
      active = null;
    }
  });

  test("fireTick emits one ROUND_TICK per tick with { roundId, multiplier, t } payload", async () => {
    const { service, emitter } = buildService();
    active = service;

    const received: RoundTickPayload[] = [];
    emitter.on(GAME_EVENTS.ROUND_TICK, (payload: RoundTickPayload) => {
      received.push(payload);
    });

    service.start("round-tick-1");
    await wait(150);
    service.stop();

    expect(received.length).toBeGreaterThanOrEqual(3);
    for (const payload of received) {
      expect(payload.roundId as unknown as string).toBe("round-tick-1");
      expect(payload.multiplier).toBe(2.5);
      expect(typeof payload.t).toBe("number");
      expect(Number.isInteger(payload.t)).toBe(true);
    }
  });

  test("30Hz cadence preserved with an async listener attached (Pitfall 3 — never await emit)", async () => {
    const { service, emitter } = buildService();
    active = service;

    let listenerInvocations = 0;
    emitter.on(GAME_EVENTS.ROUND_TICK, async () => {
      listenerInvocations += 1;
      await wait(5);
    });

    const ticks: number[] = [];
    emitter.on(GAME_EVENTS.ROUND_TICK, (payload: RoundTickPayload) => {
      ticks.push(payload.t);
    });

    service.start("round-cadence");
    await wait(1000);
    service.stop();

    expect(ticks.length).toBeGreaterThanOrEqual(25);
    expect(listenerInvocations).toBeGreaterThanOrEqual(25);

    const intervals: number[] = [];
    for (let i = 1; i < ticks.length; i++) {
      intervals.push(ticks[i] - ticks[i - 1]);
    }
    const mean = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    expect(mean).toBeGreaterThanOrEqual(23);
    expect(mean).toBeLessThanOrEqual(43);
  });

  test("listener throw does not stop the broadcast loop", async () => {
    const { service, emitter, volatileEmit } = buildService();
    active = service;

    emitter.on(GAME_EVENTS.ROUND_TICK, () => {
      throw new Error("listener boom");
    });

    service.start("round-throw");
    await wait(200);
    service.stop();

    expect(volatileEmit.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("no ROUND_TICK emitted when getMultiplierAt throws (silent drop)", async () => {
    const { service, emitter } = buildService({ throwOnTick: true });
    active = service;

    let received = 0;
    emitter.on(GAME_EVENTS.ROUND_TICK, () => {
      received += 1;
    });

    service.start("round-no-running");
    await wait(150);
    service.stop();

    expect(received).toBe(0);
  });
});
