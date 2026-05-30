// SC5 chaos proof — REQ-LEAD-02 + ROADMAP §Phase 9 success criterion 5.
//
// Stopping the projector consumer must NOT block bet settlement (write-path
// independence). The projector queue (leaderboard-projector.q) is a SEPARATE
// queue bound to game.events; the saga (games.wallet-events.q) and the WS
// bridge (games.ws-bridge.q) have their own queues. Congestion or absence on
// the projector queue therefore cannot stall the write path — RabbitMQ topic
// fan-out delivers to each queue independently.
//
// This test reproduces the failure mode by booting the games stack WITHOUT
// registering LeaderboardProjectorService as a provider. The bet flow still
// transitions ACTIVE → CASHED_OUT (write succeeds, outbox row publishes); the
// leaderboard_24h table is verified empty post-settle (no consumer drained
// the queue) and bet rows reach their terminal status normally.

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
import { Test } from "@nestjs/testing";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";
import { LeaderboardProjectorService } from "../../src/application/leaderboard-projector.service";

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
  await conn.execute("DELETE FROM leaderboard_24h WHERE player_id = ?", [pid]);
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

describe("Leaderboard projector chaos (REQ-LEAD-02 / SC5)", () => {
  beforeAll(async () => {
    const { AppModule } = await import("../../src/app.module");
    const moduleBuilder = Test.createTestingModule({
      imports: [AppModule],
    });
    moduleBuilder.overrideProvider(LeaderboardProjectorService).useValue({
      handle: async () => {
        throw new Error(
          "projector deliberately disabled for chaos test — write path must not depend on this",
        );
      },
    });
    const moduleRef = await moduleBuilder.compile();
    const app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
    await app.listen(0, "127.0.0.1");
    const address = (app.getHttpServer().address?.() ?? {}) as {
      port?: number;
    };
    const port = address.port ?? 0;
    const em = app.get(EntityManager).fork();
    booted = { app, em, baseUrl: `http://127.0.0.1:${port}` } as never;

    await truncateGamesTables(booted.em);

    playerToken = await fetchPlayerToken();
    const claims = JSON.parse(
      Buffer.from(playerToken.split(".")[1]!, "base64").toString("utf-8"),
    );
    playerId = claims.sub as string;
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "bet still settles to a terminal status when projector consumer is disabled",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
      await waitForBetting(booted.em);

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
            .execute(
              "SELECT status FROM bets WHERE id = ? AND status IN ('CASHED_OUT','LOST','REFUNDED')",
              [betId],
            );
          return rows[0] !== undefined;
        },
        90_000,
      );

      const finalRows = await booted.em
        .getConnection()
        .execute("SELECT status FROM bets WHERE id = ?", [betId]);
      const finalStatus = finalRows[0]?.status as string;
      expect(["CASHED_OUT", "LOST", "REFUNDED"]).toContain(finalStatus);

      const leaderRows = await booted.em
        .getConnection()
        .execute(`SELECT player_id FROM leaderboard_24h WHERE player_id = ?`, [
          playerId,
        ]);
      expect(leaderRows).toHaveLength(0);
    },
    120_000,
  );
});
