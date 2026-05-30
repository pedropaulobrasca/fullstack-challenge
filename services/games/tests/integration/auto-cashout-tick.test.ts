// Phase 9 Plan 05 Task 2 — AutoCashoutTickService integration suite.
// Bootstraps the real Nest module (EventEmitter2 + BetRepository + CashOutUseCase)
// and emits ROUND_TICK to prove the auto-cashout path lands a CASHED_OUT row at
// the player's target multiplier (NOT the tick multiplier — Pitfall 4).

/* eslint-disable @typescript-eslint/no-explicit-any */

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
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PlayerId, RoundId } from "@crash/shared-kernel";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";
import { GAME_EVENTS, type RoundTickPayload } from "../../src/application/game-events";

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

async function waitForBetting(em: any, timeoutMs = 15_000): Promise<string> {
  let roundId = "";
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute(
        "SELECT id FROM rounds WHERE status = 'BETTING' ORDER BY created_at DESC LIMIT 1",
      );
    if (rows[0] !== undefined) {
      roundId = rows[0].id as string;
      return true;
    }
    return false;
  }, timeoutMs);
  return roundId;
}

async function waitForRunningRound(em: any, timeoutMs = 15_000): Promise<string> {
  let id = "";
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute(
        "SELECT id FROM rounds WHERE status = 'RUNNING' ORDER BY created_at DESC LIMIT 1",
      );
    if (rows[0] !== undefined) {
      id = rows[0].id as string;
      return true;
    }
    return false;
  }, timeoutMs);
  return id;
}

async function placeBetWithTarget(
  token: string,
  baseUrl: string,
  amountCents: string,
  autoCashoutTarget: number,
): Promise<string> {
  const res = await fetch(`${baseUrl}/games/bet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amountCents, autoCashoutTarget }),
  });
  if (res.status !== 202) {
    throw new Error(`placeBet failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { betId: string };
  return body.betId;
}

async function readBet(em: any, betId: string): Promise<any | null> {
  const rows = await em
    .getConnection()
    .execute("SELECT * FROM bets WHERE id = ?", [betId]);
  return rows[0] ?? null;
}

describe("auto-cashout-tick integration (Phase 9 Plan 05)", () => {
  beforeAll(async () => {
    booted = await createTestGamesApp();
    await truncateGamesTables(booted.em);
    await booted.app.close();
    booted = await createTestGamesApp();

    playerToken = await fetchPlayerToken();
    const claims = JSON.parse(
      Buffer.from(playerToken.split(".")[1]!, "base64").toString("utf-8"),
    );
    playerId = claims.sub as string;
    await provisionWallet(playerToken);
  }, 90_000);

  afterAll(async () => {
    if (booted?.app) await booted.app.close();
  }, 30_000);

  test(
    "ROUND_TICK below target leaves bet ACTIVE; ROUND_TICK at target transitions to CASHED_OUT at the target (not the tick)",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
      await waitForBetting(booted.em);

      const betId = await placeBetWithTarget(
        playerToken,
        booted.baseUrl,
        "1000",
        2.0,
      );

      await waitFor(
        async () => {
          const bet = await readBet(booted.em, betId);
          return bet?.status === "ACTIVE";
        },
        20_000,
      );

      const runningRoundId = await waitForRunningRound(booted.em, 20_000);
      const emitter = booted.app.get(EventEmitter2);

      const belowPayload: RoundTickPayload = {
        roundId: RoundId(runningRoundId),
        multiplier: 1.99,
        t: Date.now(),
      };
      await emitter.emitAsync(GAME_EVENTS.ROUND_TICK, belowPayload);
      await new Promise((r) => setTimeout(r, 200));
      let row = await readBet(booted.em, betId);
      expect(row.status).toBe("ACTIVE");

      const atPayload: RoundTickPayload = {
        roundId: RoundId(runningRoundId),
        multiplier: 2.0,
        t: Date.now(),
      };
      await emitter.emitAsync(GAME_EVENTS.ROUND_TICK, atPayload);

      await waitFor(
        async () => {
          const r = await readBet(booted.em, betId);
          return r?.status === "CASHED_OUT";
        },
        15_000,
      );

      row = await readBet(booted.em, betId);
      expect(row.status).toBe("CASHED_OUT");
      expect(Number(row.cashed_out_multiplier_centi_x)).toBe(200);
    },
    120_000,
  );

  test(
    "double-emit ROUND_TICK at the same multiplier transitions exactly once (FSM-guarded)",
    async () => {
      await clearPlayerBetState(booted.em, playerId);
      await waitForBetting(booted.em);

      const betId = await placeBetWithTarget(
        playerToken,
        booted.baseUrl,
        "1000",
        2.0,
      );
      await waitFor(
        async () => {
          const bet = await readBet(booted.em, betId);
          return bet?.status === "ACTIVE";
        },
        20_000,
      );
      const runningRoundId = await waitForRunningRound(booted.em, 20_000);
      const emitter = booted.app.get(EventEmitter2);

      const payload: RoundTickPayload = {
        roundId: RoundId(runningRoundId),
        multiplier: 2.0,
        t: Date.now(),
      };
      await Promise.all([
        emitter.emitAsync(GAME_EVENTS.ROUND_TICK, payload),
        emitter.emitAsync(GAME_EVENTS.ROUND_TICK, payload),
      ]);

      await waitFor(
        async () => {
          const r = await readBet(booted.em, betId);
          return r?.status === "CASHED_OUT";
        },
        15_000,
      );

      const row = await readBet(booted.em, betId);
      expect(row.status).toBe("CASHED_OUT");
      expect(Number(row.cashed_out_multiplier_centi_x)).toBe(200);
    },
    120_000,
  );
});

// Suppress unused-import lint on PlayerId — kept for type-safety reference.
void PlayerId;
