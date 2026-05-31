import { beforeAll, describe, expect, mock, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import type { GetWsSnapshotUseCase } from "../../src/application/use-cases/get-ws-snapshot.use-case";
import type { RoundSnapshotPayload } from "../../src/presentation/dtos/ws-event.payloads";

type GatewayCtor = typeof import("../../src/presentation/gateways/game-ws.gateway")["GameWsGateway"];

let GameWsGateway: GatewayCtor;

beforeAll(async () => {
  ({ GameWsGateway } = await import(
    "../../src/presentation/gateways/game-ws.gateway"
  ));
});

const cannedSnapshot: RoundSnapshotPayload = {
  round: {
    id: "round-1",
    status: "BETTING",
    nonce: "0",
    seedHash: "0".repeat(64),
    clientSeed: "client-seed",
    bettingEndsAt: "2026-05-27T00:00:05.000Z",
    startedAt: null,
    crashedAt: null,
    settledAt: null,
    crashPoint: null,
    serverSeed: null,
  },
  activeBets: [],
  myBet: null,
  serverTime: 1_700_000_000_000,
};

function buildSnapshotStub(
  result: RoundSnapshotPayload | null = cannedSnapshot,
): GetWsSnapshotUseCase {
  return {
    execute: mock(async () => result),
  } as unknown as GetWsSnapshotUseCase;
}

function buildSocket(playerId: string | null = "player-alice") {
  return {
    id: "sock-1",
    data: playerId === null ? {} : { playerId },
    join: mock(),
    emit: mock(),
    disconnect: mock(),
  };
}

describe("GameWsGateway.handleConnection", () => {
  test("joins lobby and user:{playerId} then emits round:snapshot", async () => {
    const snapshot = buildSnapshotStub();
    const gateway = new GameWsGateway(snapshot, { inc: () => undefined, dec: () => undefined } as any);
    const socket = buildSocket("player-alice");

    await gateway.handleConnection(socket as never);

    expect(socket.join).toHaveBeenCalledWith("lobby");
    expect(socket.join).toHaveBeenCalledWith("user:player-alice");
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith("round:snapshot", cannedSnapshot);
  });

  test("disconnects when playerId missing from socket.data", async () => {
    const snapshot = buildSnapshotStub();
    const gateway = new GameWsGateway(snapshot, { inc: () => undefined, dec: () => undefined } as any);
    const socket = buildSocket(null);

    await gateway.handleConnection(socket as never);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  test("disconnects when snapshot execute throws", async () => {
    const snapshot = {
      execute: mock(async () => {
        throw new Error("repo failure");
      }),
    } as unknown as GetWsSnapshotUseCase;
    const gateway = new GameWsGateway(snapshot, { inc: () => undefined, dec: () => undefined } as any);
    const socket = buildSocket("player-alice");

    await gateway.handleConnection(socket as never);

    expect(socket.join).toHaveBeenCalledTimes(2);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
