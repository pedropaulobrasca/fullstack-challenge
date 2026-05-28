import { describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import {
  roundSnapshotPayloadSchema,
  roundStartedPayloadSchema,
  roundRunningPayloadSchema,
  roundCrashedPayloadSchema,
  roundSettledPayloadSchema,
  roundTickPayloadSchema,
  betPlacedPayloadSchema,
  betMyActivePayloadSchema,
  betMyRefundedPayloadSchema,
  betMyCashedOutPayloadSchema,
  betCashedOutPayloadSchema,
} from "../../src/presentation/dtos/ws-event.payloads";

const money = { amount: "500", currency: "CRD", scale: 2 };

describe("ws-event.payloads", () => {
  test("roundSnapshotPayloadSchema accepts a full BETTING snapshot with empty bets", () => {
    const payload = {
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
    expect(roundSnapshotPayloadSchema.parse(payload)).toEqual(payload);
  });

  test("roundSnapshotPayloadSchema rejects unmasked playerId in activeBets", () => {
    const payload = {
      round: {
        id: "round-1",
        status: "RUNNING",
        nonce: "1",
        seedHash: "0".repeat(64),
        clientSeed: "client-seed",
        bettingEndsAt: "2026-05-27T00:00:05.000Z",
        startedAt: "2026-05-27T00:00:05.000Z",
        crashedAt: null,
        settledAt: null,
        crashPoint: null,
        serverSeed: null,
      },
      activeBets: [
        {
          betId: "bet-1",
          playerIdMasked: "player-alice",
          amount: money,
        },
      ],
      myBet: null,
      serverTime: 1_700_000_000_000,
    };
    expect(() => roundSnapshotPayloadSchema.parse(payload)).toThrow();
  });

  test("roundSnapshotPayloadSchema accepts myBet with un-masked detail", () => {
    const payload = {
      round: {
        id: "round-1",
        status: "RUNNING",
        nonce: "1",
        seedHash: "0".repeat(64),
        clientSeed: "client-seed",
        bettingEndsAt: "2026-05-27T00:00:05.000Z",
        startedAt: "2026-05-27T00:00:05.000Z",
        crashedAt: null,
        settledAt: null,
        crashPoint: null,
        serverSeed: null,
      },
      activeBets: [],
      myBet: {
        betId: "bet-1",
        amount: money,
        status: "ACTIVE",
        cashoutMultiplier: null,
      },
      serverTime: 1_700_000_000_000,
    };
    expect(roundSnapshotPayloadSchema.parse(payload)).toEqual(payload);
  });

  test("roundTickPayloadSchema accepts plain number multiplier", () => {
    expect(
      roundTickPayloadSchema.parse({
        roundId: "round-1",
        multiplier: 1.42,
        t: 1_700_000_000_000,
      }),
    ).toBeTruthy();
  });

  test("roundStartedPayloadSchema validates required fields", () => {
    expect(
      roundStartedPayloadSchema.parse({
        roundId: "round-1",
        nonce: "0",
        seedHash: "0".repeat(64),
        bettingEndsAt: "2026-05-27T00:00:05.000Z",
      }),
    ).toBeTruthy();
  });

  test("roundRunningPayloadSchema requires startedAt", () => {
    expect(
      roundRunningPayloadSchema.parse({
        roundId: "round-1",
        startedAt: "2026-05-27T00:00:05.000Z",
      }),
    ).toBeTruthy();
  });

  test("roundCrashedPayloadSchema validates positive crashPoint", () => {
    expect(() =>
      roundCrashedPayloadSchema.parse({
        roundId: "round-1",
        crashPoint: 0,
        crashedAt: "2026-05-27T00:00:05.000Z",
      }),
    ).toThrow();
  });

  test("roundSettledPayloadSchema requires serverSeed", () => {
    expect(
      roundSettledPayloadSchema.parse({
        roundId: "round-1",
        serverSeed: "deadbeef".repeat(8),
        settledAt: "2026-05-27T00:00:05.000Z",
      }),
    ).toBeTruthy();
  });

  test("betPlacedPayloadSchema requires masked playerId", () => {
    expect(() =>
      betPlacedPayloadSchema.parse({
        roundId: "round-1",
        betId: "bet-1",
        playerIdMasked: "player-bob",
        amount: money,
      }),
    ).toThrow();
  });

  test("betMyActivePayloadSchema validates", () => {
    expect(
      betMyActivePayloadSchema.parse({
        roundId: "round-1",
        betId: "bet-1",
        amount: money,
      }),
    ).toBeTruthy();
  });

  test("betMyRefundedPayloadSchema requires reason", () => {
    expect(() =>
      betMyRefundedPayloadSchema.parse({
        roundId: "round-1",
        betId: "bet-1",
        amount: money,
        reason: "",
      }),
    ).toThrow();
  });

  test("betMyCashedOutPayloadSchema validates", () => {
    expect(
      betMyCashedOutPayloadSchema.parse({
        roundId: "round-1",
        betId: "bet-1",
        multiplier: 2.5,
        payout: money,
      }),
    ).toBeTruthy();
  });

  test("betCashedOutPayloadSchema requires masked playerId", () => {
    expect(
      betCashedOutPayloadSchema.parse({
        roundId: "round-1",
        betId: "bet-1",
        playerIdMasked: "deadbeef",
        multiplier: 2.5,
      }),
    ).toBeTruthy();
  });
});
