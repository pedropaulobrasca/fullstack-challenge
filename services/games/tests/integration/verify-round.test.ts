import { setupIntegrationEnv } from "./_helpers/test-env";

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
import { deriveCrashPoint, FORMULA_VERSION } from "@crash/contracts";
import {
  createTestGamesApp,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;

async function findSettledRoundId(em: any): Promise<string> {
  await waitFor(async () => {
    const rows = await em
      .getConnection()
      .execute(
        "SELECT count(*)::int AS n FROM rounds WHERE status = 'SETTLED'",
      );
    return (rows[0]?.n as number) >= 1;
  }, 15_000);
  const rows = await em
    .getConnection()
    .execute(
      "SELECT id FROM rounds WHERE status = 'SETTLED' ORDER BY settled_at DESC LIMIT 1",
    );
  return rows[0].id as string;
}

describe("verify-round integration (REQ-FAIR-02 + REQ-GAME-04)", () => {
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
    "settled round verify returns matches=true with recomputed === stored crashPoint",
    async () => {
      const roundId = await findSettledRoundId(booted.em);

      const res = await fetch(`${booted.baseUrl}/games/rounds/${roundId}/verify`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        roundId: string;
        nonce: string;
        serverSeed: string;
        serverSeedHash: string;
        clientSeed: string;
        crashPoint: number;
        recomputedCrashPoint: number;
        matches: boolean;
        formulaVersion: number;
        previousServerSeed: string | null;
      };
      expect(body.matches).toBe(true);
      expect(body.recomputedCrashPoint).toBe(body.crashPoint);
      expect(body.formulaVersion).toBe(FORMULA_VERSION);
      expect(typeof body.serverSeed).toBe("string");
      expect(body.serverSeed.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(body.serverSeed)).toBe(true);
      if (body.previousServerSeed !== null) {
        expect(/^[0-9a-f]{64}$/.test(body.previousServerSeed)).toBe(true);
      }

      const independentRecompute = deriveCrashPoint({
        serverSeed: body.serverSeed,
        clientSeed: body.clientSeed,
        nonce: BigInt(body.nonce),
        instantCrashBucket: 101,
      });
      expect(independentRecompute).toBe(body.crashPoint);
    },
    60_000,
  );

  test(
    "unsettled round verify returns 400 ROUND_NOT_YET_SETTLED",
    async () => {
      let unsettledId: string | null = null;
      await waitFor(async () => {
        const rows = await booted.em
          .getConnection()
          .execute(
            "SELECT id FROM rounds WHERE status IN ('BETTING','RUNNING','CRASHED') ORDER BY created_at DESC LIMIT 1",
          );
        if (rows[0]) {
          unsettledId = rows[0].id as string;
          return true;
        }
        return false;
      }, 10_000);

      expect(unsettledId).not.toBeNull();
      const res = await fetch(
        `${booted.baseUrl}/games/rounds/${unsettledId}/verify`,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      const code = body.message?.code ?? body.code ?? body.error;
      expect(code).toBe("ROUND_NOT_YET_SETTLED");
    },
    30_000,
  );

  test(
    "non-existent round id returns 404 ROUND_NOT_FOUND",
    async () => {
      const missingId = randomUUID();
      const res = await fetch(
        `${booted.baseUrl}/games/rounds/${missingId}/verify`,
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      const code = body.message?.code ?? body.code ?? body.error;
      expect(code).toBe("ROUND_NOT_FOUND");
    },
    15_000,
  );
});
