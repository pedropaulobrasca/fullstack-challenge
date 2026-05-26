import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "200",
  COOLDOWN_MS: "100",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;
let playerToken: string;
let playerId: string;

type PlayerBetsResponse = {
  bets: Array<{
    betId: string;
    roundId: string;
    amount: { amount: string; currency: string; scale: number };
    status: string;
    cashedOutMultiplier: number | null;
    payout: unknown;
    createdAt: string;
  }>;
  limit: number;
  offset: number;
};

describe("get-player-bets integration (REQ-GAME-05)", () => {
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
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "missing Authorization header returns 401 MISSING_BEARER_TOKEN",
    async () => {
      const res = await fetch(`${booted.baseUrl}/games/bets/me`);
      expect(res.status).toBe(401);
      const body = await res.json();
      const reason =
        body.message?.code ??
        body.code ??
        body.message ??
        body.error ??
        "";
      expect(String(reason)).toContain("MISSING_BEARER_TOKEN");
    },
    15_000,
  );

  test(
    "invalid token returns 401 INVALID_TOKEN",
    async () => {
      const res = await fetch(`${booted.baseUrl}/games/bets/me`, {
        headers: { Authorization: "Bearer not-a-real-jwt" },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      const reason =
        body.message?.code ??
        body.code ??
        body.message ??
        body.error ??
        "";
      expect(String(reason)).toContain("INVALID_TOKEN");
    },
    15_000,
  );

  test(
    "valid Keycloak token returns 200 with bets array (initially empty - Phase 4 has no POST /bet)",
    async () => {
      const res = await fetch(`${booted.baseUrl}/games/bets/me`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as PlayerBetsResponse;
      expect(Array.isArray(body.bets)).toBe(true);
      expect(typeof body.limit).toBe("number");
      expect(typeof body.offset).toBe("number");
    },
    15_000,
  );

  test(
    "direct DB insert for the authenticated player is reflected in /games/bets/me",
    async () => {
      // Phase 4 has no POST /games/bet endpoint; Phase 5 will replace this
      // direct INSERT with a real saga-driven flow. The integration test
      // only validates the read path + JWT subject filtering.
      const round = await (async () => {
        await waitFor(async () => {
          const rows = await booted.em
            .getConnection()
            .execute(
              "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
            );
          return rows[0] !== undefined;
        }, 10_000);
        const rows = await booted.em
          .getConnection()
          .execute(
            "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
          );
        return rows[0].id as string;
      })();

      const betId = randomUUID();
      await booted.em.getConnection().execute(
        `INSERT INTO bets (id, round_id, player_id, amount_cents, currency_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, now())`,
        [betId, round, playerId, "2500", "CRD", "PENDING"],
      );

      const res = await fetch(`${booted.baseUrl}/games/bets/me`, {
        headers: { Authorization: `Bearer ${playerToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as PlayerBetsResponse;
      const match = body.bets.find((b) => b.betId === betId);
      expect(match).toBeDefined();
      expect(match!.amount.amount).toBe("2500");
      expect(match!.status).toBe("PENDING");
    },
    30_000,
  );
});
