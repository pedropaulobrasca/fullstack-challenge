import { setupIntegrationEnv } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "200",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTestGamesApp } from "./_helpers/app-factory";
import { Money } from "@crash/shared-kernel";
import { PlayerId } from "@crash/shared-kernel/identity";
import { MikroLeaderboardRepository } from "../../src/infrastructure/repositories/mikro-leaderboard.repository";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;
let repo: MikroLeaderboardRepository;

async function truncateLeaderboard(em: any): Promise<void> {
  await em
    .getConnection()
    .execute("TRUNCATE TABLE leaderboard_24h RESTART IDENTITY");
}

describe("MikroLeaderboardRepository integration (Phase 9 Plan 04)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    repo = new MikroLeaderboardRepository(booted.em);
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  beforeEach(async () => {
    await truncateLeaderboard(booted.em);
  });

  test(
    "applyCashedOut inserts a new player row with the signed delta and win count",
    async () => {
      const playerId = PlayerId(randomUUID());
      const settledAt = new Date();

      await repo.applyCashedOut(
        {
          playerId,
          betAmount: Money.of(1000n),
          payout: Money.of(2500n),
          settledAt,
        },
        booted.em,
      );

      const row = await booted.em
        .getConnection()
        .execute(`SELECT * FROM leaderboard_24h WHERE player_id = ?`, [
          playerId as unknown as string,
        ]);
      expect(row.length).toBe(1);
      expect(String(row[0].net_profit_cents)).toBe("1500");
      expect(row[0].win_count).toBe(1);
      expect(row[0].total_bet_count).toBe(1);
    },
    30_000,
  );

  test(
    "applyCashedOut twice for same player accumulates net profit (UPSERT)",
    async () => {
      const playerId = PlayerId(randomUUID());
      const settledAt = new Date();

      await repo.applyCashedOut(
        { playerId, betAmount: Money.of(1000n), payout: Money.of(2500n), settledAt },
        booted.em,
      );
      await repo.applyCashedOut(
        { playerId, betAmount: Money.of(500n), payout: Money.of(1500n), settledAt },
        booted.em,
      );

      const row = await booted.em
        .getConnection()
        .execute(`SELECT * FROM leaderboard_24h WHERE player_id = ?`, [
          playerId as unknown as string,
        ]);
      expect(String(row[0].net_profit_cents)).toBe("2500");
      expect(row[0].win_count).toBe(2);
      expect(row[0].total_bet_count).toBe(2);
    },
    30_000,
  );

  test(
    "applyRefunded is a no-op (refunds do not bump ledger or last_settled_at)",
    async () => {
      const playerId = PlayerId(randomUUID());
      const settledAt = new Date();

      await repo.applyRefunded(
        { playerId, betAmount: Money.of(500n), settledAt },
        booted.em,
      );

      const row = await booted.em
        .getConnection()
        .execute(`SELECT * FROM leaderboard_24h WHERE player_id = ?`, [
          playerId as unknown as string,
        ]);
      expect(row.length).toBe(0);
    },
    30_000,
  );

  test(
    "applySettledLoss debits net profit, increments total_bet_count, leaves win_count untouched",
    async () => {
      const playerId = PlayerId(randomUUID());
      const settledAt = new Date();

      await repo.applySettledLoss(
        { playerId, betAmount: Money.of(2000n), settledAt },
        booted.em,
      );

      const row = await booted.em
        .getConnection()
        .execute(`SELECT * FROM leaderboard_24h WHERE player_id = ?`, [
          playerId as unknown as string,
        ]);
      expect(String(row[0].net_profit_cents)).toBe("-2000");
      expect(row[0].win_count).toBe(0);
      expect(row[0].total_bet_count).toBe(1);
    },
    30_000,
  );

  test(
    "fetchTopN returns rows within the 24h window ordered by net_profit_cents DESC, capped",
    async () => {
      const now = new Date();
      const playerA = PlayerId(randomUUID());
      const playerB = PlayerId(randomUUID());
      const playerC = PlayerId(randomUUID());

      await repo.applyCashedOut(
        { playerId: playerA, betAmount: Money.of(0n), payout: Money.of(300n), settledAt: now },
        booted.em,
      );
      await repo.applyCashedOut(
        { playerId: playerB, betAmount: Money.of(0n), payout: Money.of(900n), settledAt: now },
        booted.em,
      );
      await repo.applyCashedOut(
        { playerId: playerC, betAmount: Money.of(0n), payout: Money.of(600n), settledAt: now },
        booted.em,
      );

      const top = await repo.fetchTopN(10, { windowHours: 24 });
      expect(top.length).toBe(3);
      expect(top[0]!.playerId).toBe(playerB as unknown as string);
      expect(top[1]!.playerId).toBe(playerC as unknown as string);
      expect(top[2]!.playerId).toBe(playerA as unknown as string);

      const capped = await repo.fetchTopN(2, { windowHours: 24 });
      expect(capped.length).toBe(2);
    },
    30_000,
  );

  test(
    "fetchTopN excludes rows older than the window cutoff",
    async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const fresh = new Date();
      const playerOld = PlayerId(randomUUID());
      const playerFresh = PlayerId(randomUUID());

      await repo.applyCashedOut(
        { playerId: playerOld, betAmount: Money.of(0n), payout: Money.of(900n), settledAt: old },
        booted.em,
      );
      await repo.applyCashedOut(
        { playerId: playerFresh, betAmount: Money.of(0n), payout: Money.of(100n), settledAt: fresh },
        booted.em,
      );

      const top = await repo.fetchTopN(10, { windowHours: 24 });
      const ids = top.map((r) => r.playerId);
      expect(ids).toContain(playerFresh as unknown as string);
      expect(ids).not.toContain(playerOld as unknown as string);
    },
    30_000,
  );

  test(
    "fetchSnapshot maps rows to LeaderboardEntry with 1-based rank",
    async () => {
      const now = new Date();
      const playerA = PlayerId(randomUUID());
      const playerB = PlayerId(randomUUID());

      await repo.applyCashedOut(
        { playerId: playerA, betAmount: Money.of(0n), payout: Money.of(200n), settledAt: now },
        booted.em,
      );
      await repo.applyCashedOut(
        { playerId: playerB, betAmount: Money.of(0n), payout: Money.of(800n), settledAt: now },
        booted.em,
      );

      const snapshot = await repo.fetchSnapshot(10, { windowHours: 24 });
      expect(snapshot.length).toBe(2);
      expect(snapshot[0]!.rank).toBe(1);
      expect(snapshot[0]!.playerId).toBe(playerB as unknown as string);
      expect(snapshot[1]!.rank).toBe(2);
      expect(snapshot[1]!.playerId).toBe(playerA as unknown as string);
    },
    30_000,
  );

  test(
    "rows returned by fetchTopN expose last_settled_at as Date instances (Pitfall 1)",
    async () => {
      const settledAt = new Date();
      const playerId = PlayerId(randomUUID());
      await repo.applyCashedOut(
        { playerId, betAmount: Money.of(0n), payout: Money.of(100n), settledAt },
        booted.em,
      );

      const top = await repo.fetchTopN(10, { windowHours: 24 });
      expect(top.length).toBe(1);
      expect(top[0]!.lastSettledAt).toBeInstanceOf(Date);
    },
    30_000,
  );
});
