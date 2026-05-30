import { describe, expect, test } from "bun:test";
import {
  leaderboardEntrySchema,
  leaderboardUpdatedPayloadSchema,
  type LeaderboardUpdatedPayload,
} from "../../src/ws/leaderboard-updated.payload";

const validEntry = () => ({
  playerIdMasked: "bd14a3c2",
  rank: 1,
  netProfit: { amount: "150000", currency: "CRD", scale: 2 },
  winCount: 12,
  totalBetCount: 15,
});

const validPayload = (): unknown => ({
  entries: [validEntry()],
  updatedAt: "2026-05-30T00:00:00.000Z",
});

describe("leaderboardUpdatedPayloadSchema", () => {
  test("parses a well-formed payload", () => {
    const parsed: LeaderboardUpdatedPayload =
      leaderboardUpdatedPayloadSchema.parse(validPayload());
    expect(parsed.entries.length).toBe(1);
    expect(parsed.entries[0]!.playerIdMasked).toBe("bd14a3c2");
    expect(parsed.entries[0]!.netProfit.amount).toBe("150000");
    expect(parsed.updatedAt).toBe("2026-05-30T00:00:00.000Z");
  });

  test("rejects payload where netProfit is a raw number (Money discipline)", () => {
    const payload = {
      ...(validPayload() as Record<string, unknown>),
      entries: [{ ...validEntry(), netProfit: 1500 }],
    };
    expect(() => leaderboardUpdatedPayloadSchema.parse(payload)).toThrow();
  });

  test("rejects payload where playerIdMasked is a full UUID", () => {
    const payload = {
      ...(validPayload() as Record<string, unknown>),
      entries: [
        {
          ...validEntry(),
          playerIdMasked: "bd14a3c2-1111-2222-3333-444455556666",
        },
      ],
    };
    expect(() => leaderboardUpdatedPayloadSchema.parse(payload)).toThrow();
  });

  test("rejects entry with non-8-hex playerIdMasked", () => {
    expect(() =>
      leaderboardEntrySchema.parse({ ...validEntry(), playerIdMasked: "abc" }),
    ).toThrow();
    expect(() =>
      leaderboardEntrySchema.parse({
        ...validEntry(),
        playerIdMasked: "ZZZZZZZZ",
      }),
    ).toThrow();
  });

  test("rejects negative winCount or totalBetCount", () => {
    expect(() =>
      leaderboardEntrySchema.parse({ ...validEntry(), winCount: -1 }),
    ).toThrow();
    expect(() =>
      leaderboardEntrySchema.parse({ ...validEntry(), totalBetCount: -1 }),
    ).toThrow();
  });

  test("rejects updatedAt that is not ISO8601", () => {
    const payload = {
      ...(validPayload() as Record<string, unknown>),
      updatedAt: "yesterday",
    };
    expect(() => leaderboardUpdatedPayloadSchema.parse(payload)).toThrow();
  });

  test("accepts an empty entries array", () => {
    const parsed = leaderboardUpdatedPayloadSchema.parse({
      entries: [],
      updatedAt: "2026-05-30T00:00:00.000Z",
    });
    expect(parsed.entries.length).toBe(0);
  });
});
