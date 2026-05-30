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
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestGamesApp,
  pollRound,
  truncateGamesTables,
} from "./_helpers/app-factory";
import { RoundId } from "@crash/shared-kernel";
import { MikroBetRepository } from "../../src/infrastructure/repositories/mikro-bet.repository";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;
let repo: MikroBetRepository;

async function insertBet(
  em: any,
  args: {
    roundId: string;
    playerId: string;
    status: "PENDING" | "ACTIVE" | "REFUNDED" | "LOST" | "CASHED_OUT";
    autoCashoutTargetCentiX: number | null;
  },
): Promise<string> {
  const id = randomUUID();
  const cashedOutAt =
    args.status === "CASHED_OUT" ? new Date().toISOString() : null;
  const cashedOutMultiplierCentiX = args.status === "CASHED_OUT" ? 150 : null;
  const payoutCents = args.status === "CASHED_OUT" ? "1500" : null;
  await em.getConnection().execute(
    `INSERT INTO bets (
       id, round_id, player_id, amount_cents, currency_code, status,
       cashed_out_at, cashed_out_multiplier_centi_x, payout_cents,
       auto_cashout_target_centi_x, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
    [
      id,
      args.roundId,
      args.playerId,
      "1000",
      "CRD",
      args.status,
      cashedOutAt,
      cashedOutMultiplierCentiX,
      payoutCents,
      args.autoCashoutTargetCentiX,
    ],
  );
  return id;
}

describe("place-bet-auto-cashout-target integration (Phase 9 Plan 02)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    await truncateGamesTables(booted.em);
    await booted.app.close();
    booted = await createTestGamesApp();
    repo = new MikroBetRepository(booted.em);
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "schema: auto_cashout_target_centi_x column exists, nullable INT",
    async () => {
      const rows = await booted.em.getConnection().execute(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'bets' AND column_name = 'auto_cashout_target_centi_x'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0].data_type).toBe("integer");
      expect(rows[0].is_nullable).toBe("YES");
    },
    20_000,
  );

  test(
    "schema: partial index idx_bets_auto_cashout_candidates exists with status='ACTIVE' AND target IS NOT NULL",
    async () => {
      const rows = await booted.em.getConnection().execute(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename = 'bets' AND indexname = 'idx_bets_auto_cashout_candidates'`,
      );
      expect(rows.length).toBe(1);
      const def = String(rows[0].indexdef);
      expect(def).toContain("auto_cashout_target_centi_x");
      expect(def).toContain("status = 'ACTIVE'");
      expect(def).toContain("auto_cashout_target_centi_x IS NOT NULL");
    },
    20_000,
  );

  test(
    "findAutoCashoutCandidates returns only ACTIVE bets with target <= ceiling",
    async () => {
      const round = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      const roundId = round.id as string;
      const player = `p-target-${randomUUID()}`;

      const targetedBetId = await insertBet(booted.em, {
        roundId,
        playerId: player,
        status: "ACTIVE",
        autoCashoutTargetCentiX: 200,
      });

      const below = await repo.findAutoCashoutCandidates(RoundId(roundId), 199);
      expect(below.map((b) => b.id as unknown as string)).not.toContain(
        targetedBetId,
      );

      const equal = await repo.findAutoCashoutCandidates(RoundId(roundId), 200);
      expect(equal.map((b) => b.id as unknown as string)).toContain(
        targetedBetId,
      );

      const above = await repo.findAutoCashoutCandidates(RoundId(roundId), 250);
      expect(above.map((b) => b.id as unknown as string)).toContain(
        targetedBetId,
      );
    },
    30_000,
  );

  test(
    "manual bet (autoCashoutTarget NULL) is never returned by findAutoCashoutCandidates",
    async () => {
      const round = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      const roundId = round.id as string;
      const player = `p-manual-${randomUUID()}`;

      const manualBetId = await insertBet(booted.em, {
        roundId,
        playerId: player,
        status: "ACTIVE",
        autoCashoutTargetCentiX: null,
      });

      for (const ceiling of [100, 200, 1_000_000]) {
        const candidates = await repo.findAutoCashoutCandidates(
          RoundId(roundId),
          ceiling,
        );
        expect(candidates.map((b) => b.id as unknown as string)).not.toContain(
          manualBetId,
        );
      }
    },
    30_000,
  );

  test(
    "non-ACTIVE statuses are never returned by findAutoCashoutCandidates",
    async () => {
      const round = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      const roundId = round.id as string;

      const insertedIds: string[] = [];
      for (const status of ["PENDING", "CASHED_OUT", "LOST", "REFUNDED"] as const) {
        const id = await insertBet(booted.em, {
          roundId,
          playerId: `p-status-${status}-${randomUUID()}`,
          status,
          autoCashoutTargetCentiX: 150,
        });
        insertedIds.push(id);
      }

      const candidates = await repo.findAutoCashoutCandidates(
        RoundId(roundId),
        10_000,
      );
      const ids = candidates.map((b) => b.id as unknown as string);
      for (const id of insertedIds) {
        expect(ids).not.toContain(id);
      }
    },
    30_000,
  );

  test(
    "rehydrated Bet from findAutoCashoutCandidates exposes Date instances (Pitfall 1)",
    async () => {
      const round = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      const roundId = round.id as string;
      const player = `p-hydrate-${randomUUID()}`;

      const betId = await insertBet(booted.em, {
        roundId,
        playerId: player,
        status: "ACTIVE",
        autoCashoutTargetCentiX: 300,
      });

      const candidates = await repo.findAutoCashoutCandidates(
        RoundId(roundId),
        500,
      );
      const found = candidates.find((b) => (b.id as unknown as string) === betId);
      expect(found).toBeDefined();
      expect(found!.createdAt).toBeInstanceOf(Date);
      expect(found!.autoCashoutTarget).not.toBeNull();
      expect(found!.autoCashoutTarget!.toCentiX()).toBe(300);
    },
    30_000,
  );
});
