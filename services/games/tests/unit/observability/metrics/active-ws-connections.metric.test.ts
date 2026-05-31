/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../../../setup";

setupGamesTestEnv();

type GatewayCtor = typeof import("../../../../src/presentation/gateways/game-ws.gateway")["GameWsGateway"];

let GameWsGateway: GatewayCtor;

beforeAll(async () => {
  ({ GameWsGateway } = await import("../../../../src/presentation/gateways/game-ws.gateway"));
});

class FakeGauge {
  public value = 0;
  public readonly incs: number = 0;
  inc(): void {
    this.value += 1;
  }
  dec(): void {
    this.value -= 1;
  }
}

class FakeSnapshotUseCase {
  async execute(): Promise<unknown> {
    return { foo: "bar" };
  }
}

function buildGateway(gauge: FakeGauge): InstanceType<GatewayCtor> {
  return new GameWsGateway(
    new FakeSnapshotUseCase() as unknown as never,
    gauge as unknown as never,
  );
}

function buildSocket(playerId: string | null): any {
  const joined: string[] = [];
  const emitted: Array<[string, unknown]> = [];
  return {
    id: "sock-1",
    data: { playerId },
    join: (room: string) => joined.push(room),
    emit: (event: string, payload: unknown) => emitted.push([event, payload]),
    disconnect: () => {},
    _joined: joined,
    _emitted: emitted,
  };
}

describe("active_ws_connections gauge — observation sites", () => {
  test("handleConnection inc() exactly once on successful auth", async () => {
    const gauge = new FakeGauge();
    const gateway = buildGateway(gauge);
    const socket = buildSocket("player-a");

    await gateway.handleConnection(socket);

    expect(gauge.value).toBe(1);
  });

  test("handleDisconnect dec() exactly once", () => {
    const gauge = new FakeGauge();
    const gateway = buildGateway(gauge);
    const socket = buildSocket("player-a");

    gateway.handleDisconnect(socket);

    expect(gauge.value).toBe(-1);
  });

  test("reentrant connect/disconnect leaves the gauge at net zero", async () => {
    const gauge = new FakeGauge();
    const gateway = buildGateway(gauge);

    for (let i = 0; i < 5; i++) {
      const s = buildSocket(`player-${i}`);
      await gateway.handleConnection(s);
    }
    expect(gauge.value).toBe(5);

    for (let i = 0; i < 5; i++) {
      const s = buildSocket(`player-${i}`);
      gateway.handleDisconnect(s);
    }
    expect(gauge.value).toBe(0);
  });

  test("handleConnection does NOT inc when playerId is missing (disconnects before join)", async () => {
    const gauge = new FakeGauge();
    const gateway = buildGateway(gauge);
    const socket = buildSocket(null);

    await gateway.handleConnection(socket);

    expect(gauge.value).toBe(0);
  });
});
