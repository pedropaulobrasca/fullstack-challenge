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

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;

async function insertBet(
  em: any,
  args: {
    roundId: string;
    playerId: string;
    status: "PENDING" | "ACTIVE" | "REFUNDED" | "LOST" | "CASHED_OUT";
  },
): Promise<string> {
  const id = randomUUID();
  await em.getConnection().execute(
    `INSERT INTO bets (id, round_id, player_id, amount_cents, currency_code, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, now())`,
    [id, args.roundId, args.playerId, "1000", "CRD", args.status],
  );
  return id;
}

describe("bet-uniqueness integration (REQ-DOM-02)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    await truncateGamesTables(booted.em);
    await booted.app.close();
    booted = await createTestGamesApp();
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "two PENDING inserts for same (player, round) -> SQLSTATE 23505 on bets_one_active_per_player",
    async () => {
      const round = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      const roundId = round.id as string;
      const playerId = `p-uniqueness-${randomUUID()}`;

      await insertBet(booted.em, {
        roundId,
        playerId,
        status: "PENDING",
      });

      let captured: any = null;
      try {
        await insertBet(booted.em, {
          roundId,
          playerId,
          status: "PENDING",
        });
      } catch (err) {
        captured = err;
      }

      expect(captured).not.toBeNull();
      const sqlState = captured?.code ?? captured?.cause?.code;
      const constraintName =
        captured?.constraint ??
        captured?.cause?.constraint ??
        String(captured?.message ?? "");
      expect(sqlState).toBe("23505");
      expect(constraintName).toContain("bets_one_active_per_player");
    },
    30_000,
  );

  test(
    "different player on same round succeeds (partial index scoped to player_id, round_id)",
    async () => {
      const round = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      const roundId = round.id as string;
      const playerA = `p-uniqA-${randomUUID()}`;
      const playerB = `p-uniqB-${randomUUID()}`;

      await insertBet(booted.em, {
        roundId,
        playerId: playerA,
        status: "PENDING",
      });
      await insertBet(booted.em, {
        roundId,
        playerId: playerB,
        status: "PENDING",
      });

      const rows = await booted.em
        .getConnection()
        .execute(
          "SELECT count(*)::int AS n FROM bets WHERE round_id = ? AND status = 'PENDING'",
          [roundId],
        );
      expect(rows[0]?.n).toBeGreaterThanOrEqual(2);
    },
    30_000,
  );

  test(
    "REFUNDED bet does not block a new PENDING bet for the same (player, round)",
    async () => {
      const round = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      const roundId = round.id as string;
      const playerId = `p-refund-${randomUUID()}`;

      const firstId = await insertBet(booted.em, {
        roundId,
        playerId,
        status: "PENDING",
      });

      await booted.em
        .getConnection()
        .execute("UPDATE bets SET status = 'REFUNDED', refund_reason = ? WHERE id = ?", [
          "saga-timeout",
          firstId,
        ]);

      const secondId = await insertBet(booted.em, {
        roundId,
        playerId,
        status: "PENDING",
      });

      const rows = await booted.em
        .getConnection()
        .execute(
          "SELECT id, status FROM bets WHERE round_id = ? AND player_id = ? ORDER BY created_at ASC",
          [roundId, playerId],
        );
      expect(rows.length).toBe(2);
      const statuses = rows.map((r: any) => r.status).sort();
      expect(statuses).toEqual(["PENDING", "REFUNDED"]);
      expect(secondId).not.toBe(firstId);
    },
    30_000,
  );
});
