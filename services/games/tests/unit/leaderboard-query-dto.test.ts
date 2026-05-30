import { describe, expect, test } from "bun:test";
import { leaderboardQuerySchema } from "../../src/presentation/dtos/leaderboard.query.dto";
import { leaderboardResponseSchema } from "../../src/presentation/dtos/leaderboard.response.dto";
import { leaderboardUpdatedPayloadSchema } from "@crash/contracts/ws";

describe("leaderboardQuerySchema", () => {
  test("accepts window=24h", () => {
    const parsed = leaderboardQuerySchema.parse({ window: "24h" });
    expect(parsed.window).toBe("24h");
  });

  test("rejects window=7d (v1 enum locked to 24h)", () => {
    expect(() => leaderboardQuerySchema.parse({ window: "7d" })).toThrow();
  });

  test("defaults window to 24h when omitted", () => {
    const parsed = leaderboardQuerySchema.parse({});
    expect(parsed.window).toBe("24h");
  });
});

describe("leaderboardResponseSchema", () => {
  test("matches the shared WS payload schema (single source of truth)", () => {
    expect(leaderboardResponseSchema).toBe(leaderboardUpdatedPayloadSchema);
  });

  test("parses a valid response shape", () => {
    const parsed = leaderboardResponseSchema.parse({
      entries: [
        {
          playerIdMasked: "abcdef12",
          rank: 1,
          netProfit: { amount: "5000", currency: "CRD", scale: 2 },
          winCount: 3,
          totalBetCount: 5,
        },
      ],
      updatedAt: "2026-05-30T00:00:00.000Z",
    });
    expect(parsed.entries.length).toBe(1);
  });
});
