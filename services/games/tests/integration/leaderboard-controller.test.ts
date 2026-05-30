import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "200",
  LEADERBOARD_TOP_N: "10",
  LEADERBOARD_WINDOW_HOURS: "24",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createTestGamesApp } from "./_helpers/app-factory";

type LeaderboardResponseBody = {
  entries: Array<{
    playerIdMasked: string;
    rank: number;
    netProfit: { amount: string; currency: string; scale: number };
    winCount: number;
    totalBetCount: number;
  }>;
  updatedAt: string;
};

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;
let playerToken: string;

async function truncateLeaderboard(em: any): Promise<void> {
  await em
    .getConnection()
    .execute("TRUNCATE TABLE leaderboard_24h RESTART IDENTITY");
}

async function seedLeaderboardRow(
  em: any,
  playerId: string,
  netProfitCents: bigint,
  winCount: number,
  totalBetCount: number,
  settledAt: Date,
): Promise<void> {
  await em
    .getConnection()
    .execute(
      `INSERT INTO leaderboard_24h
       (player_id, net_profit_cents, win_count, total_bet_count, last_settled_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        playerId,
        netProfitCents.toString(),
        winCount,
        totalBetCount,
        settledAt,
      ],
    );
}

describe("LeaderboardController integration (REQ-LEAD-03)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    playerToken = await fetchPlayerToken();
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  beforeEach(async () => {
    await truncateLeaderboard(booted.em);
  });

  test(
    "GET /games/leaderboard without JWT returns 401",
    async () => {
      const res = await fetch(`${booted.baseUrl}/games/leaderboard`);
      expect(res.status).toBe(401);
    },
    15_000,
  );

  test(
    "GET /games/leaderboard with valid JWT and window=24h returns 200",
    async () => {
      const res = await fetch(
        `${booted.baseUrl}/games/leaderboard?window=24h`,
        {
          headers: { Authorization: `Bearer ${playerToken}` },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      expect(Array.isArray(body.entries)).toBe(true);
      expect(typeof body.updatedAt).toBe("string");
      expect(() => new Date(body.updatedAt).toISOString()).not.toThrow();
    },
    15_000,
  );

  test(
    "GET /games/leaderboard with invalid window=7d returns 400",
    async () => {
      const res = await fetch(
        `${booted.baseUrl}/games/leaderboard?window=7d`,
        {
          headers: { Authorization: `Bearer ${playerToken}` },
        },
      );
      expect(res.status).toBe(400);
    },
    15_000,
  );

  test(
    "GET /games/leaderboard without window param applies default 24h",
    async () => {
      const res = await fetch(`${booted.baseUrl}/games/leaderboard`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      expect(Array.isArray(body.entries)).toBe(true);
    },
    15_000,
  );

  test(
    "GET /games/leaderboard returns top 10 ordered DESC by net_profit_cents when 15 rows seeded",
    async () => {
      const now = new Date();
      for (let i = 0; i < 15; i += 1) {
        await seedLeaderboardRow(
          booted.em,
          randomUUID(),
          BigInt(10000 - i * 100),
          i,
          i + 1,
          now,
        );
      }

      const res = await fetch(
        `${booted.baseUrl}/games/leaderboard?window=24h`,
        {
          headers: { Authorization: `Bearer ${playerToken}` },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      expect(body.entries.length).toBe(10);
      for (let i = 0; i < body.entries.length - 1; i += 1) {
        const here = BigInt(body.entries[i]!.netProfit.amount);
        const next = BigInt(body.entries[i + 1]!.netProfit.amount);
        expect(here >= next).toBe(true);
      }
      expect(body.entries[0]!.rank).toBe(1);
      expect(body.entries[body.entries.length - 1]!.rank).toBe(10);
    },
    20_000,
  );

  test(
    "GET /games/leaderboard masks playerId to 8 hex chars (no full UUID leak)",
    async () => {
      const now = new Date();
      const fullId = randomUUID();
      await seedLeaderboardRow(booted.em, fullId, 5000n, 2, 3, now);

      const res = await fetch(
        `${booted.baseUrl}/games/leaderboard?window=24h`,
        {
          headers: { Authorization: `Bearer ${playerToken}` },
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      expect(body.entries.length).toBe(1);
      expect(body.entries[0]!.playerIdMasked).toMatch(/^[0-9a-f]{8}$/);
      expect(body.entries[0]!.playerIdMasked).not.toBe(fullId);
      const raw = JSON.stringify(body);
      expect(raw.includes(fullId)).toBe(false);
    },
    15_000,
  );

  test(
    "GET /games/leaderboard returns netProfit as MoneySnapshot (never a raw number)",
    async () => {
      const now = new Date();
      await seedLeaderboardRow(booted.em, randomUUID(), 7500n, 1, 1, now);

      const res = await fetch(`${booted.baseUrl}/games/leaderboard`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      expect(body.entries.length).toBe(1);
      const profit = body.entries[0]!.netProfit;
      expect(typeof profit).toBe("object");
      expect(typeof profit.amount).toBe("string");
      expect(profit.currency).toBe("CRD");
      expect(profit.scale).toBe(2);
      expect(profit.amount).toBe("7500");
    },
    15_000,
  );

  test(
    "GET /games/leaderboard excludes rows older than the 24h window",
    async () => {
      const fresh = new Date();
      const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const freshId = randomUUID();
      const staleId = randomUUID();
      await seedLeaderboardRow(booted.em, freshId, 5000n, 1, 1, fresh);
      await seedLeaderboardRow(booted.em, staleId, 9999n, 1, 1, stale);

      const res = await fetch(`${booted.baseUrl}/games/leaderboard`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      expect(body.entries.length).toBe(1);
      expect(body.entries[0]!.netProfit.amount).toBe("5000");
    },
    15_000,
  );

  test(
    "GET /games/leaderboard returns 200 with empty entries when leaderboard is empty",
    async () => {
      const res = await fetch(`${booted.baseUrl}/games/leaderboard`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      expect(body.entries).toEqual([]);
    },
    15_000,
  );

  test(
    "GET /games/leaderboard updatedAt is the response timestamp, not the row settle time",
    async () => {
      const rowSettledAt = new Date(Date.now() - 60_000);
      await seedLeaderboardRow(booted.em, randomUUID(), 2500n, 1, 1, rowSettledAt);

      const before = Date.now();
      const res = await fetch(`${booted.baseUrl}/games/leaderboard`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      const after = Date.now();
      expect(res.status).toBe(200);
      const body = (await res.json()) as LeaderboardResponseBody;
      const ts = new Date(body.updatedAt).getTime();
      expect(ts).toBeGreaterThanOrEqual(before - 1000);
      expect(ts).toBeLessThanOrEqual(after + 1000);
      expect(ts).toBeGreaterThan(rowSettledAt.getTime());
    },
    15_000,
  );
});
