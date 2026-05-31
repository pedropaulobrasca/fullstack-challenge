import { describe, expect, test } from "bun:test";
import {
  roundSnapshotPayloadSchema,
  roundSnapshotObjectSchema,
} from "../../src/ws/ws-event.payloads";

const validSnapshot = () => ({
  round: {
    id: "round-1",
    status: "BETTING" as const,
    nonce: "n-1",
    seedHash: "a".repeat(64),
    clientSeed: "cs-1",
    bettingEndsAt: "2026-05-31T00:00:00.000Z",
    startedAt: null,
    crashedAt: null,
    settledAt: null,
    crashPoint: null,
    serverSeed: null,
  },
  activeBets: [],
  myBet: null,
  serverTime: 1_700_000_000_000,
});

describe("roundSnapshotPayloadSchema — D-03b nullable relax", () => {
  test("accepts null payload (WS reconnect between rounds)", () => {
    const result = roundSnapshotPayloadSchema.safeParse(null);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  test("still accepts the prior valid object shape", () => {
    const result = roundSnapshotPayloadSchema.safeParse(validSnapshot());
    expect(result.success).toBe(true);
  });

  test("still rejects malformed payloads (not null, not the strict object)", () => {
    const malformed = {
      ...validSnapshot(),
      round: { ...validSnapshot().round, status: "NOT_A_STATUS" },
    };
    const result = roundSnapshotPayloadSchema.safeParse(malformed);
    expect(result.success).toBe(false);
  });

  test("rejects arbitrary garbage", () => {
    expect(roundSnapshotPayloadSchema.safeParse(42).success).toBe(false);
    expect(roundSnapshotPayloadSchema.safeParse("garbage").success).toBe(false);
    expect(roundSnapshotPayloadSchema.safeParse([]).success).toBe(false);
  });

  test("roundSnapshotObjectSchema alias matches the strict object only (rejects null)", () => {
    expect(roundSnapshotObjectSchema.safeParse(null).success).toBe(false);
    expect(roundSnapshotObjectSchema.safeParse(validSnapshot()).success).toBe(true);
  });
});
