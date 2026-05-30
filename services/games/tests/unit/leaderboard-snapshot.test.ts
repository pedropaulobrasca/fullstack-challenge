import { describe, expect, test } from "bun:test";
import {
  LeaderboardSnapshot,
  type LeaderboardEntry,
} from "../../src/domain/leaderboard-snapshot.value-object";

function entry(playerId: string, rank: number, netProfitCents: bigint): LeaderboardEntry {
  return { playerId, rank, netProfitCents };
}

describe("LeaderboardSnapshot.diff", () => {
  test("returns changed=true when two entries swap rank", () => {
    const before: LeaderboardEntry[] = [entry("A", 1, 100n), entry("B", 2, 50n)];
    const after: LeaderboardEntry[] = [entry("B", 1, 200n), entry("A", 2, 100n)];
    expect(LeaderboardSnapshot.diff(before, after).changed).toBe(true);
  });

  test("returns changed=false when input is identical", () => {
    const snapshot: LeaderboardEntry[] = [entry("A", 1, 100n), entry("B", 2, 50n)];
    expect(LeaderboardSnapshot.diff(snapshot, snapshot).changed).toBe(false);
  });

  test("returns changed=true when a new entry joins the top-N", () => {
    const before: LeaderboardEntry[] = [entry("A", 1, 100n), entry("B", 2, 50n)];
    const after: LeaderboardEntry[] = [
      entry("A", 1, 100n),
      entry("B", 2, 50n),
      entry("C", 3, 25n),
    ];
    expect(LeaderboardSnapshot.diff(before, after).changed).toBe(true);
  });

  test("returns changed=true when an entry drops out of the top-N", () => {
    const before: LeaderboardEntry[] = [
      entry("A", 1, 100n),
      entry("B", 2, 50n),
      entry("C", 3, 25n),
    ];
    const after: LeaderboardEntry[] = [entry("A", 1, 100n), entry("B", 2, 50n)];
    expect(LeaderboardSnapshot.diff(before, after).changed).toBe(true);
  });

  test("returns changed=true when going from empty to populated", () => {
    const before: LeaderboardEntry[] = [];
    const after: LeaderboardEntry[] = [entry("A", 1, 100n)];
    expect(LeaderboardSnapshot.diff(before, after).changed).toBe(true);
  });

  test("returns changed=false for empty vs empty", () => {
    expect(LeaderboardSnapshot.diff([], []).changed).toBe(false);
  });

  test("ignores netProfit delta when player ordering is identical", () => {
    const before: LeaderboardEntry[] = [entry("A", 1, 100n), entry("B", 2, 50n)];
    const after: LeaderboardEntry[] = [entry("A", 1, 500n), entry("B", 2, 75n)];
    expect(LeaderboardSnapshot.diff(before, after).changed).toBe(false);
  });

  test("preserves the before and after arrays in the result", () => {
    const before: LeaderboardEntry[] = [entry("A", 1, 100n)];
    const after: LeaderboardEntry[] = [entry("B", 1, 200n)];
    const result = LeaderboardSnapshot.diff(before, after);
    expect(result.before).toEqual(before);
    expect(result.after).toEqual(after);
  });
});
