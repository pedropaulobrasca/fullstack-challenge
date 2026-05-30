// REQ-LEAD-01 + REQ-LEAD-02 — Plan 09-03.
//
// CrashRoundUseCase.sweepActiveBetsToLost must publish ONE bet.lost outbox row
// per ACTIVE bet transitioned to LOST, in the SAME transaction as the FSM
// mutation. Plan 09-06 LeaderboardProjector binds to game.events:bet.lost to
// debit net_profit for losing bets.
//
// Path-corrected from the plan's original target (SettleRoundUseCase) — the
// actual ACTIVE→LOST transitions live in CrashRoundUseCase per Phase 4.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties */

import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "200",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { betLostEventSchema } from "@crash/contracts";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";

const KONG_BASE = process.env.KONG_BASE_URL ?? "http://localhost:8000";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;
let playerToken: string;
let playerId: string;

async function provisionWallet(token: string): Promise<void> {
  const res = await fetch(`${KONG_BASE}/wallets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`wallet provision failed: ${res.status} ${await res.text()}`);
  }
}

async function clearPlayerBetState(em: any, pid: string): Promise<void> {
  const conn = em.getConnection();
  await conn.execute(
    "DELETE FROM bet_saga_state WHERE bet_id IN (SELECT id FROM bets WHERE player_id = ?)",
    [pid],
  );
  await conn.execute("DELETE FROM bets WHERE player_id = ?", [pid]);
}

async function waitForBetting(em: any, timeoutMs = 10_000): Promise<string> {
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute(
        "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
      );
    return rows[0] !== undefined;
  }, timeoutMs);
  const rows = await em
    .getConnection()
    .execute(
      "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
    );
  return rows[0].id as string;
}

describe("crash sweep bet.lost outbox events (REQ-LEAD-01 + REQ-LEAD-02)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    await truncateGamesTables(booted.em);
    await booted.app.close();
    booted = await createTestGamesApp();

    playerToken = await fetchPlayerToken();
    const payload = JSON.parse(
      Buffer.from(playerToken.split(".")[1]!, "base64").toString("utf-8"),
    );
    playerId = payload.sub as string;
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "ACTIVE bet swept to LOST emits exactly one bet.lost outbox row with valid payload",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
      const roundId = await waitForBetting(booted.em);

      const placeRes = await fetch(`${booted.baseUrl}/games/bet`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${playerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amountCents: "10000" }),
      });
      expect(placeRes.status).toBe(202);
      const placeBody = (await placeRes.json()) as { betId: string };
      const betId = placeBody.betId;

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute("SELECT status FROM bets WHERE id = ?", [betId]);
          return rows[0]?.status === "ACTIVE";
        },
        15_000,
      );

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute("SELECT status FROM bets WHERE id = ?", [betId]);
          return rows[0]?.status === "LOST";
        },
        60_000,
      );

      const outboxRows = await booted.em
        .getConnection()
        .execute(
          "SELECT message_id, payload, exchange, routing_key, aggregate_type, aggregate_id, event_type FROM outbox_messages WHERE event_type = 'bet.lost' AND aggregate_id = ?",
          [betId],
        );
      expect(outboxRows).toHaveLength(1);

      const row = outboxRows[0]!;
      expect(row.exchange).toBe("game.events");
      expect(row.routing_key).toBe("bet.lost");
      expect(row.aggregate_type).toBe("Bet");
      expect(row.aggregate_id).toBe(betId);

      const parsed = betLostEventSchema.parse(row.payload);
      expect(parsed.betId).toBe(betId);
      expect(parsed.playerId).toBe(playerId);
      expect(parsed.roundId).toBe(roundId);
      expect(parsed.amount.amount).toBe("10000");
      expect(parsed.amount.currency).toBe("CRD");
      expect(parsed.amount.scale).toBe(2);
    },
    120_000,
  );

  test(
    "round with zero ACTIVE bets emits zero bet.lost rows",
    async () => {
      await clearPlayerBetState(booted.em, playerId);

      const beforeRows = await booted.em
        .getConnection()
        .execute(
          "SELECT COUNT(*)::int AS n FROM outbox_messages WHERE event_type = 'bet.lost'",
        );
      const beforeCount = Number(beforeRows[0].n);

      await waitForBetting(booted.em);
      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute(
              "SELECT id FROM rounds WHERE status IN ('CRASHED','SETTLED') ORDER BY created_at DESC LIMIT 1",
            );
          return rows[0] !== undefined;
        },
        60_000,
      );

      const afterRows = await booted.em
        .getConnection()
        .execute(
          "SELECT COUNT(*)::int AS n FROM outbox_messages WHERE event_type = 'bet.lost'",
        );
      const afterCount = Number(afterRows[0].n);

      expect(afterCount).toBe(beforeCount);
    },
    120_000,
  );
});
