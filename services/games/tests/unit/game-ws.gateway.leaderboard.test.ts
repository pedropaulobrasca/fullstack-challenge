import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import type { LeaderboardSnapshotEntry } from "../../src/domain/leaderboard.repository";
import type { LeaderboardUpdatedPayload } from "../../src/application/game-events";

type GameWsGatewayCtor =
  typeof import("../../src/presentation/gateways/game-ws.gateway")["GameWsGateway"];

let GameWsGateway: GameWsGatewayCtor;

beforeAll(async () => {
  ({ GameWsGateway } = await import(
    "../../src/presentation/gateways/game-ws.gateway"
  ));
});

class FakeServer {
  public emissions: Array<{
    room: string;
    event: string;
    payload: unknown;
  }> = [];

  to(room: string) {
    return {
      emit: (event: string, payload: unknown): void => {
        this.emissions.push({ room, event, payload });
      },
    };
  }
}

describe("GameWsGateway — leaderboard:updated WS emit (masking gate)", () => {
  test("onLeaderboardUpdated masks every entry's playerId and emits to lobby", () => {
    const fakeSnapshot = {} as never;
    const gateway = new GameWsGateway(fakeSnapshot);
    const server = new FakeServer();
    (gateway as unknown as { server: FakeServer }).server = server;

    const entries: LeaderboardSnapshotEntry[] = [
      {
        playerId: randomUUID(),
        rank: 1,
        netProfitCents: 9000n,
      },
      {
        playerId: randomUUID(),
        rank: 2,
        netProfitCents: 5000n,
      },
    ];
    const payload: LeaderboardUpdatedPayload = {
      entries,
      updatedAt: "2026-05-30T00:00:00.000Z",
    };

    gateway.onLeaderboardUpdated(payload);

    expect(server.emissions).toHaveLength(1);
    const emit = server.emissions[0]!;
    expect(emit.room).toBe("lobby");
    expect(emit.event).toBe("leaderboard:updated");

    const body = emit.payload as {
      entries: Array<{
        playerIdMasked: string;
        rank: number;
        netProfitCents: string;
      }>;
      updatedAt: string;
    };
    expect(body.entries).toHaveLength(2);
    for (const e of body.entries) {
      expect(e.playerIdMasked).toMatch(/^[0-9a-f]{8}$/);
    }
    expect(body.updatedAt).toBe("2026-05-30T00:00:00.000Z");

    const serialized = JSON.stringify(emit.payload);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    for (const e of body.entries) {
      expect(e).not.toHaveProperty("playerId");
    }
  });

  test("netProfitCents serialises as a string (bigint discipline)", () => {
    const fakeSnapshot = {} as never;
    const gateway = new GameWsGateway(fakeSnapshot);
    const server = new FakeServer();
    (gateway as unknown as { server: FakeServer }).server = server;

    gateway.onLeaderboardUpdated({
      entries: [
        { playerId: randomUUID(), rank: 1, netProfitCents: -1500n },
      ],
      updatedAt: "2026-05-30T00:00:00.000Z",
    });

    const body = server.emissions[0]!.payload as {
      entries: Array<{ netProfitCents: string }>;
    };
    expect(body.entries[0]!.netProfitCents).toBe("-1500");
  });
});
