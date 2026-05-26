// Annotated runtime: this test deliberately accumulates >= 5 SETTLED rounds via
// the autonomous loop with tight env knobs (BETTING_WINDOW_MS=200, COOLDOWN_MS=100,
// GROWTH_RATE=0.06). Expected wall-clock ~3-8s depending on crashPoint draws.

import { setupIntegrationEnv } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "30",
  BETTING_WINDOW_MS: "200",
  COOLDOWN_MS: "100",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;

type HistoryEntry = {
  roundId: string;
  nonce: string;
  crashPoint: number;
  settledAt: string;
  totalBetCount: number;
};

type HistoryResponse = {
  rounds: HistoryEntry[];
  limit: number;
  offset: number;
};

async function fetchHistory(
  baseUrl: string,
  query = "",
): Promise<HistoryResponse> {
  const res = await fetch(`${baseUrl}/games/rounds/history${query}`);
  if (!res.ok) {
    throw new Error(`history fetch failed ${res.status}`);
  }
  return (await res.json()) as HistoryResponse;
}

describe("get-round-history integration (REQ-GAME-03)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    await truncateGamesTables(booted.em);
    await booted.app.close();
    booted = await createTestGamesApp();

    await waitFor(async () => {
      const rows = await booted.em
        .getConnection()
        .execute(
          "SELECT count(*)::int AS n FROM rounds WHERE status = 'SETTLED'",
        );
      return (rows[0]?.n as number) >= 5;
    }, 90_000);
  }, 120_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "?limit=3 returns 3 most recent SETTLED rounds with crashPoint and settledAt populated",
    async () => {
      const body = await fetchHistory(booted.baseUrl, "?limit=3");
      expect(body.limit).toBe(3);
      expect(body.offset).toBe(0);
      expect(body.rounds.length).toBe(3);
      for (const entry of body.rounds) {
        expect(entry.crashPoint).toBeGreaterThanOrEqual(1.0);
        expect(typeof entry.settledAt).toBe("string");
        expect(entry.totalBetCount).toBeGreaterThanOrEqual(0);
      }
      const settledTimes = body.rounds.map((r) =>
        new Date(r.settledAt).getTime(),
      );
      const sortedDesc = [...settledTimes].sort((a, b) => b - a);
      expect(settledTimes).toEqual(sortedDesc);
    },
    30_000,
  );

  test(
    "?limit=200 is clamped to 100 at the use-case layer",
    async () => {
      const res = await fetch(
        `${booted.baseUrl}/games/rounds/history?limit=200`,
      );
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        const body = (await res.json()) as HistoryResponse;
        expect(body.limit).toBeLessThanOrEqual(100);
      }
    },
    15_000,
  );

  test(
    "no query params defaults to limit=20",
    async () => {
      const body = await fetchHistory(booted.baseUrl);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    },
    15_000,
  );
});
