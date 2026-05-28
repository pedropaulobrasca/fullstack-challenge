import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { MultiplierBroadcastService } from "../../src/application/multiplier-broadcast.service";
import type { RoundLoopService } from "../../src/application/round-loop.service";
import type { GameWsGateway } from "../../src/presentation/gateways/game-ws.gateway";

type EmitFn = ReturnType<typeof mock>;

type StubGateway = {
  service: MultiplierBroadcastService;
  roundLoop: { getMultiplierAt: ReturnType<typeof mock> };
  volatileEmit: EmitFn;
  toRoom: ReturnType<typeof mock>;
};

function buildService(
  options: {
    multiplierFactory?: () => { toNumber: () => number };
    throwOnTick?: boolean;
  } = {},
): StubGateway {
  const multiplierFactory =
    options.multiplierFactory ?? (() => ({ toNumber: () => 2.5 }));
  const volatileEmit: EmitFn = mock();
  const toRoom = mock(() => ({ volatile: { emit: volatileEmit } }));
  const gateway = {
    server: {
      to: toRoom,
    },
  } as unknown as GameWsGateway;
  const roundLoop = {
    getMultiplierAt: mock(() => {
      if (options.throwOnTick) {
        throw new Error("no RUNNING round available for multiplier query");
      }
      return multiplierFactory();
    }),
  };
  const service = new MultiplierBroadcastService(
    roundLoop as unknown as RoundLoopService,
    gateway,
  );
  return { service, roundLoop, volatileEmit, toRoom };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MultiplierBroadcastService", () => {
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

  test("start(roundId) schedules recursive ticks at ~30Hz and emits round:tick on lobby via volatile.emit", async () => {
    const { service, volatileEmit, toRoom } = buildService();
    active = service;

    service.start("round-uuid-1");
    await wait(150);
    service.stop();

    expect(volatileEmit.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of toRoom.mock.calls) {
      expect(call[0]).toBe("lobby");
    }
    for (const call of volatileEmit.mock.calls) {
      expect(call[0]).toBe("round:tick");
      const payload = call[1] as { roundId: string; multiplier: number; t: number };
      expect(payload.roundId).toBe("round-uuid-1");
      expect(payload.multiplier).toBe(2.5);
      expect(typeof payload.t).toBe("number");
      expect(Number.isInteger(payload.t)).toBe(true);
    }
  });

  test("start() is idempotent — second call without intervening stop does not schedule a second timer", async () => {
    const { service, volatileEmit } = buildService();
    active = service;

    service.start("round-a");
    service.start("round-a");
    await wait(120);
    service.stop();

    const callCount = volatileEmit.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(callCount).toBeLessThan(12);
  });

  test("stop() clears the timer and prevents further emits", async () => {
    const { service, volatileEmit } = buildService();
    active = service;

    service.start("round-b");
    await wait(80);
    service.stop();
    const callsAtStop = volatileEmit.mock.calls.length;

    await wait(120);
    expect(volatileEmit.mock.calls.length).toBe(callsAtStop);
  });

  test("when getMultiplierAt throws, tick is dropped silently AND scheduling continues", async () => {
    const { service, roundLoop, volatileEmit } = buildService({
      throwOnTick: true,
    });
    active = service;

    service.start("round-c");
    await wait(150);
    service.stop();

    expect(volatileEmit.mock.calls.length).toBe(0);
    expect(roundLoop.getMultiplierAt.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test("stop() while not running is a no-op", () => {
    const { service } = buildService();
    expect(() => service.stop()).not.toThrow();
    expect(() => service.stop()).not.toThrow();
  });

  test("emitted payload multiplier value mirrors getMultiplierAt(now).toNumber()", async () => {
    const { service, volatileEmit } = buildService({
      multiplierFactory: () => ({ toNumber: () => 4.2 }),
    });
    active = service;

    service.start("round-d");
    await wait(100);
    service.stop();

    expect(volatileEmit.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of volatileEmit.mock.calls) {
      const payload = call[1] as { multiplier: number };
      expect(payload.multiplier).toBe(4.2);
    }
  });
});
