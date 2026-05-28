import { describe, expect, mock, test } from "bun:test";
import "../setup";
import { GameWsGateway } from "../../src/presentation/gateways/game-ws.gateway";
import { GAME_EVENTS } from "../../src/application/game-events";
import type { GetWsSnapshotUseCase } from "../../src/application/use-cases/get-ws-snapshot.use-case";
import type {
  RoundStartedPayload,
  RoundRunningPayload,
  RoundCrashedPayload,
  RoundSettledPayload,
} from "../../src/presentation/dtos/ws-event.payloads";

type EmitSpy = ReturnType<typeof mock>;
type ToSpy = ReturnType<typeof mock>;

function buildGateway(): {
  gateway: GameWsGateway;
  toSpy: ToSpy;
  emitSpy: EmitSpy;
  roomChain: { emit: EmitSpy };
  volatileAccess: { count: number };
} {
  const snapshot = {
    execute: () => Promise.resolve({} as never),
  } as unknown as GetWsSnapshotUseCase;
  const gateway = new GameWsGateway(snapshot);

  const emitSpy = mock((..._args: unknown[]) => true);
  const roomChain = { emit: emitSpy };
  const volatileAccess = { count: 0 };
  const roomProxy = new Proxy(roomChain, {
    get(target, key) {
      if (key === "volatile") {
        volatileAccess.count += 1;
        return undefined;
      }
      return Reflect.get(target, key);
    },
  });
  const toSpy = mock((_room: string) => roomProxy);
  const server = { to: toSpy } as unknown as GameWsGateway["server"];
  (gateway as { server: GameWsGateway["server"] }).server = server;

  return { gateway, toSpy, emitSpy, roomChain, volatileAccess };
}

describe("GameWsGateway lifecycle @OnEvent handlers", () => {
  test("onRoundStarted broadcasts to lobby with the exact payload", () => {
    const { gateway, toSpy, emitSpy, volatileAccess } = buildGateway();
    const payload: RoundStartedPayload = {
      roundId: "r1",
      nonce: "0",
      seedHash: "a".repeat(64),
      bettingEndsAt: "2026-05-27T00:00:00.000Z",
    };

    gateway.onRoundStarted(payload);

    expect(toSpy).toHaveBeenCalledTimes(1);
    expect(toSpy.mock.calls[0][0]).toBe("lobby");
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy.mock.calls[0][0]).toBe("round:started");
    expect(emitSpy.mock.calls[0][1]).toBe(payload);
    expect(volatileAccess.count).toBe(0);
  });

  test("onRoundRunning broadcasts to lobby with the exact payload", () => {
    const { gateway, toSpy, emitSpy, volatileAccess } = buildGateway();
    const payload: RoundRunningPayload = {
      roundId: "r1",
      startedAt: "2026-05-27T00:00:01.000Z",
    };

    gateway.onRoundRunning(payload);

    expect(toSpy.mock.calls[0][0]).toBe("lobby");
    expect(emitSpy.mock.calls[0][0]).toBe("round:running");
    expect(emitSpy.mock.calls[0][1]).toBe(payload);
    expect(volatileAccess.count).toBe(0);
  });

  test("onRoundCrashed broadcasts to lobby with the exact payload", () => {
    const { gateway, toSpy, emitSpy, volatileAccess } = buildGateway();
    const payload: RoundCrashedPayload = {
      roundId: "r1",
      crashPoint: 2.5,
      crashedAt: "2026-05-27T00:00:10.000Z",
    };

    gateway.onRoundCrashed(payload);

    expect(toSpy.mock.calls[0][0]).toBe("lobby");
    expect(emitSpy.mock.calls[0][0]).toBe("round:crashed");
    expect(emitSpy.mock.calls[0][1]).toBe(payload);
    expect(volatileAccess.count).toBe(0);
  });

  test("onRoundSettled broadcasts to lobby with the exact payload", () => {
    const { gateway, toSpy, emitSpy, volatileAccess } = buildGateway();
    const payload: RoundSettledPayload = {
      roundId: "r1",
      serverSeed: "deadbeef",
      settledAt: "2026-05-27T00:00:11.000Z",
    };

    gateway.onRoundSettled(payload);

    expect(toSpy.mock.calls[0][0]).toBe("lobby");
    expect(emitSpy.mock.calls[0][0]).toBe("round:settled");
    expect(emitSpy.mock.calls[0][1]).toBe(payload);
    expect(volatileAccess.count).toBe(0);
  });

  test("none of the four lifecycle handlers access server.to().volatile", () => {
    const { gateway, volatileAccess } = buildGateway();
    gateway.onRoundStarted({
      roundId: "r",
      nonce: "0",
      seedHash: "a".repeat(64),
      bettingEndsAt: "2026-05-27T00:00:00.000Z",
    });
    gateway.onRoundRunning({ roundId: "r", startedAt: "2026-05-27T00:00:01.000Z" });
    gateway.onRoundCrashed({
      roundId: "r",
      crashPoint: 2,
      crashedAt: "2026-05-27T00:00:10.000Z",
    });
    gateway.onRoundSettled({
      roundId: "r",
      serverSeed: "x",
      settledAt: "2026-05-27T00:00:11.000Z",
    });

    expect(volatileAccess.count).toBe(0);
    void GAME_EVENTS;
  });
});
