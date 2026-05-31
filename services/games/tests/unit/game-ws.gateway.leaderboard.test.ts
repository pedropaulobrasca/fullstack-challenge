import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import { leaderboardUpdatedPayloadSchema } from "@crash/contracts/ws";
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

describe("GameWsGateway — leaderboard:updated WS emit", () => {
  test("emits payload that satisfies the canonical leaderboardUpdatedPayloadSchema", () => {
    const fakeSnapshot = {} as never;
    const gateway = new GameWsGateway(fakeSnapshot);
    const server = new FakeServer();
    (gateway as unknown as { server: FakeServer }).server = server;

    const entries: LeaderboardSnapshotEntry[] = [
      {
        playerId: randomUUID(),
        rank: 1,
        netProfitCents: 9000n,
        winCount: 5,
        totalBetCount: 7,
      },
      {
        playerId: randomUUID(),
        rank: 2,
        netProfitCents: 5000n,
        winCount: 3,
        totalBetCount: 8,
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

    const parsed = leaderboardUpdatedPayloadSchema.safeParse(emit.payload);
    if (!parsed.success) {
      throw new Error(
        `emitted payload failed leaderboardUpdatedPayloadSchema: ${parsed.error.message}`,
      );
    }
    expect(parsed.success).toBe(true);

    expect(parsed.data.entries).toHaveLength(2);
    expect(parsed.data.entries[0]!.rank).toBe(1);
    expect(parsed.data.entries[0]!.winCount).toBe(5);
    expect(parsed.data.entries[0]!.totalBetCount).toBe(7);
    expect(parsed.data.entries[0]!.netProfit.amount).toBe("9000");
    expect(parsed.data.entries[0]!.netProfit.currency).toBe("CRD");
    expect(parsed.data.entries[0]!.netProfit.scale).toBe(2);
    expect(parsed.data.updatedAt).toBe("2026-05-30T00:00:00.000Z");
  });

  test("masks every entry's playerId — raw UUIDs never leak over the wire", () => {
    const fakeSnapshot = {} as never;
    const gateway = new GameWsGateway(fakeSnapshot);
    const server = new FakeServer();
    (gateway as unknown as { server: FakeServer }).server = server;

    const entries: LeaderboardSnapshotEntry[] = [
      {
        playerId: randomUUID(),
        rank: 1,
        netProfitCents: 9000n,
        winCount: 1,
        totalBetCount: 2,
      },
      {
        playerId: randomUUID(),
        rank: 2,
        netProfitCents: 5000n,
        winCount: 0,
        totalBetCount: 4,
      },
    ];

    gateway.onLeaderboardUpdated({
      entries,
      updatedAt: "2026-05-30T00:00:00.000Z",
    });

    const body = server.emissions[0]!.payload as {
      entries: Array<Record<string, unknown>>;
    };
    for (const e of body.entries) {
      expect(e.playerIdMasked).toMatch(/^[0-9a-f]{8}$/);
      expect(e).not.toHaveProperty("playerId");
    }

    const serialized = JSON.stringify(server.emissions[0]!.payload);
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("preserves signed netProfit (negative cents serialized as negative MoneySnapshot.amount)", () => {
    const fakeSnapshot = {} as never;
    const gateway = new GameWsGateway(fakeSnapshot);
    const server = new FakeServer();
    (gateway as unknown as { server: FakeServer }).server = server;

    gateway.onLeaderboardUpdated({
      entries: [
        {
          playerId: randomUUID(),
          rank: 1,
          netProfitCents: -1500n,
          winCount: 0,
          totalBetCount: 3,
        },
      ],
      updatedAt: "2026-05-30T00:00:00.000Z",
    });

    const parsed = leaderboardUpdatedPayloadSchema.safeParse(
      server.emissions[0]!.payload,
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entries[0]!.netProfit.amount).toBe("-1500");
      expect(parsed.data.entries[0]!.netProfit.currency).toBe("CRD");
      expect(parsed.data.entries[0]!.netProfit.scale).toBe(2);
    }
  });

  test("does NOT include a netProfitCents key (locked-in regression guard)", () => {
    const fakeSnapshot = {} as never;
    const gateway = new GameWsGateway(fakeSnapshot);
    const server = new FakeServer();
    (gateway as unknown as { server: FakeServer }).server = server;

    gateway.onLeaderboardUpdated({
      entries: [
        {
          playerId: randomUUID(),
          rank: 1,
          netProfitCents: 100n,
          winCount: 1,
          totalBetCount: 1,
        },
      ],
      updatedAt: "2026-05-30T00:00:00.000Z",
    });

    const body = server.emissions[0]!.payload as {
      entries: Array<Record<string, unknown>>;
    };
    for (const e of body.entries) {
      expect(e).not.toHaveProperty("netProfitCents");
      expect(e).toHaveProperty("netProfit");
    }
  });
});
