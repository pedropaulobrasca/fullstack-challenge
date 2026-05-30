import { beforeAll, describe, expect, mock, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import type { ConsumeMessage } from "amqplib";
import type {
  ApplyCashedOutInput,
  ApplyRefundedInput,
  ApplySettledLossInput,
  LeaderboardRepository,
  LeaderboardSnapshotEntry,
} from "../../src/domain/leaderboard.repository";
import { GAME_EVENTS } from "../../src/application/game-events";

type LeaderboardProjectorServiceCtor =
  typeof import("../../src/application/leaderboard-projector.service")["LeaderboardProjectorService"];

let LeaderboardProjectorService: LeaderboardProjectorServiceCtor;

beforeAll(async () => {
  ({ LeaderboardProjectorService } = await import(
    "../../src/application/leaderboard-projector.service"
  ));
});

class FakeLeaderboardRepository implements LeaderboardRepository {
  public cashedOutCalls: ApplyCashedOutInput[] = [];
  public refundedCalls: ApplyRefundedInput[] = [];
  public lossCalls: ApplySettledLossInput[] = [];
  public snapshotsToReturn: LeaderboardSnapshotEntry[][] = [];
  public fetchSnapshotCalls = 0;

  async applyCashedOut(input: ApplyCashedOutInput): Promise<void> {
    this.cashedOutCalls.push(input);
  }
  async applyRefunded(input: ApplyRefundedInput): Promise<void> {
    this.refundedCalls.push(input);
  }
  async applySettledLoss(input: ApplySettledLossInput): Promise<void> {
    this.lossCalls.push(input);
  }
  async fetchTopN() {
    return [];
  }
  async fetchSnapshot(): Promise<LeaderboardSnapshotEntry[]> {
    const next =
      this.snapshotsToReturn.shift() ?? ([] as LeaderboardSnapshotEntry[]);
    this.fetchSnapshotCalls += 1;
    return next;
  }
}

function fakeMsg(): ConsumeMessage {
  return { properties: { headers: {} } } as unknown as ConsumeMessage;
}

function buildHarness(
  snapshotPair?: [LeaderboardSnapshotEntry[], LeaderboardSnapshotEntry[]],
): {
  service: InstanceType<LeaderboardProjectorServiceCtor>;
  leaderboard: FakeLeaderboardRepository;
  emitMock: ReturnType<typeof mock>;
} {
  const leaderboard = new FakeLeaderboardRepository();
  if (snapshotPair !== undefined) {
    leaderboard.snapshotsToReturn = [snapshotPair[0], snapshotPair[1]];
  }
  const emitMock = mock(() => true);
  const eventEmitter = { emit: emitMock } as unknown as {
    emit: (event: string, payload: unknown) => boolean;
  };
  const service = new LeaderboardProjectorService(
    leaderboard,
    eventEmitter as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, leaderboard, emitMock };
}

describe("LeaderboardProjectorService — unit", () => {
  test("bet.cashed_out envelope applies positive delta and increments win count", async () => {
    const { service, leaderboard } = buildHarness();
    await service.handleEnvelope(
      {
        type: "bet.cashed_out",
        version: 1,
        messageId: "m1",
        correlationId: "c1",
        causationId: "x1",
        occurredAt: "2026-05-30T00:00:00.000Z",
        payload: {
          betId: "00000000-0000-0000-0000-000000000001",
          playerId: "player-a",
          roundId: "00000000-0000-0000-0000-000000000010",
          amount: { amount: "1000", currency: "CRD", scale: 2 },
          payout: { amount: "2500", currency: "CRD", scale: 2 },
          multiplier: 2.5,
          cashedOutAt: "2026-05-30T00:00:00.000Z",
        },
      } as never,
      fakeMsg(),
      {} as never,
    );

    expect(leaderboard.cashedOutCalls).toHaveLength(1);
    const call = leaderboard.cashedOutCalls[0]!;
    expect(call.playerId as unknown as string).toBe("player-a");
    expect(call.betAmount.toCents()).toBe(1000n);
    expect(call.payout.toCents()).toBe(2500n);
    expect(call.settledAt.toISOString()).toBe("2026-05-30T00:00:00.000Z");
  });

  test("bet.refunded envelope calls applyRefunded (no-op repository)", async () => {
    const { service, leaderboard } = buildHarness();
    await service.handleEnvelope(
      {
        type: "bet.refunded",
        version: 1,
        messageId: "m2",
        correlationId: "c2",
        causationId: "c2",
        occurredAt: "2026-05-30T00:00:00.000Z",
        payload: {
          betId: "00000000-0000-0000-0000-000000000002",
          playerId: "player-b",
          reason: "SAGA_TIMEOUT",
        },
      } as never,
      fakeMsg(),
      {} as never,
    );

    expect(leaderboard.refundedCalls).toHaveLength(1);
    expect(leaderboard.cashedOutCalls).toHaveLength(0);
    expect(leaderboard.lossCalls).toHaveLength(0);
  });

  test("bet.lost envelope applies negative delta and increments total_bet_count", async () => {
    const { service, leaderboard } = buildHarness();
    await service.handleEnvelope(
      {
        type: "bet.lost",
        version: 1,
        messageId: "m3",
        correlationId: "c3",
        causationId: "c3",
        occurredAt: "2026-05-30T00:00:00.000Z",
        payload: {
          betId: "00000000-0000-0000-0000-000000000003",
          playerId: "player-c",
          roundId: "00000000-0000-0000-0000-000000000010",
          amount: { amount: "2000", currency: "CRD", scale: 2 },
          settledAt: "2026-05-30T00:00:00.000Z",
        },
      } as never,
      fakeMsg(),
      {} as never,
    );

    expect(leaderboard.lossCalls).toHaveLength(1);
    const call = leaderboard.lossCalls[0]!;
    expect(call.playerId as unknown as string).toBe("player-c");
    expect(call.betAmount.toCents()).toBe(2000n);
  });

  test("unknown envelope type is dropped (no apply call, no emit)", async () => {
    const { service, leaderboard, emitMock } = buildHarness();
    await service.handleEnvelope(
      {
        type: "bet.unexpected",
        version: 1,
        messageId: "m4",
        correlationId: "c4",
        causationId: "c4",
        occurredAt: "2026-05-30T00:00:00.000Z",
        payload: {},
      } as never,
      fakeMsg(),
      {} as never,
    );
    expect(leaderboard.cashedOutCalls).toHaveLength(0);
    expect(leaderboard.refundedCalls).toHaveLength(0);
    expect(leaderboard.lossCalls).toHaveLength(0);
    expect(emitMock).not.toHaveBeenCalled();
  });

  test("emits LEADERBOARD_UPDATED only when top-N ranks change", async () => {
    const before: LeaderboardSnapshotEntry[] = [
      { playerId: "p1", rank: 1, netProfitCents: 5000n },
      { playerId: "p2", rank: 2, netProfitCents: 2000n },
    ];
    const after: LeaderboardSnapshotEntry[] = [
      { playerId: "p2", rank: 1, netProfitCents: 9000n },
      { playerId: "p1", rank: 2, netProfitCents: 5000n },
    ];
    const { service, emitMock } = buildHarness([before, after]);

    await service.handleEnvelope(
      {
        type: "bet.cashed_out",
        version: 1,
        messageId: "m5",
        correlationId: "c5",
        causationId: "c5",
        occurredAt: "2026-05-30T00:00:00.000Z",
        payload: {
          betId: "00000000-0000-0000-0000-000000000004",
          playerId: "p2",
          roundId: "00000000-0000-0000-0000-000000000010",
          amount: { amount: "1000", currency: "CRD", scale: 2 },
          payout: { amount: "8000", currency: "CRD", scale: 2 },
          multiplier: 8,
          cashedOutAt: "2026-05-30T00:00:00.000Z",
        },
      } as never,
      fakeMsg(),
      {} as never,
    );

    expect(emitMock).toHaveBeenCalledTimes(1);
    const callArgs = emitMock.mock.calls[0]!;
    expect(callArgs[0]).toBe(GAME_EVENTS.LEADERBOARD_UPDATED);
    const payload = callArgs[1] as {
      entries: LeaderboardSnapshotEntry[];
      updatedAt: string;
    };
    expect(payload.entries).toEqual(after);
    expect(payload.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  test("does NOT emit LEADERBOARD_UPDATED when top-N order unchanged (throttle gate)", async () => {
    const same: LeaderboardSnapshotEntry[] = [
      { playerId: "p1", rank: 1, netProfitCents: 5000n },
      { playerId: "p2", rank: 2, netProfitCents: 2000n },
    ];
    const { service, emitMock } = buildHarness([same, same]);

    await service.handleEnvelope(
      {
        type: "bet.cashed_out",
        version: 1,
        messageId: "m6",
        correlationId: "c6",
        causationId: "c6",
        occurredAt: "2026-05-30T00:00:00.000Z",
        payload: {
          betId: "00000000-0000-0000-0000-000000000005",
          playerId: "p1",
          roundId: "00000000-0000-0000-0000-000000000010",
          amount: { amount: "100", currency: "CRD", scale: 2 },
          payout: { amount: "300", currency: "CRD", scale: 2 },
          multiplier: 3,
          cashedOutAt: "2026-05-30T00:00:00.000Z",
        },
      } as never,
      fakeMsg(),
      {} as never,
    );

    expect(emitMock).not.toHaveBeenCalled();
  });
});
