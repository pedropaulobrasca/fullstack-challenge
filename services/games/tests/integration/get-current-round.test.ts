import { setupIntegrationEnv } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "300",
  COOLDOWN_MS: "150",
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

type CurrentRound = {
  roundId: string;
  status: "BETTING" | "RUNNING" | "CRASHED" | "SETTLED";
  nonce: string;
  seedHash: string;
  serverSeed: string | null;
  crashPoint: number | null;
  currentMultiplier: number | null;
  bets: unknown[];
};

async function fetchCurrent(baseUrl: string): Promise<CurrentRound | null> {
  const res = await fetch(`${baseUrl}/games/rounds/current`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET /rounds/current failed: ${res.status}`);
  }
  return (await res.json()) as CurrentRound;
}

describe("get-current-round integration (REQ-GAME-02 + REQ-FAIR-05)", () => {
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
    "BETTING round exposes seedHash and hides serverSeed (REQ-FAIR-05)",
    async () => {
      let current: CurrentRound | null = null;
      await waitFor(async () => {
        current = await fetchCurrent(booted.baseUrl);
        return current !== null && current.status === "BETTING";
      }, 10_000);

      expect(current).not.toBeNull();
      const live = current!;
      expect(live.status).toBe("BETTING");
      expect(typeof live.seedHash).toBe("string");
      expect(live.seedHash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(live.seedHash)).toBe(true);
      expect(live.serverSeed).toBeNull();
      expect(live.crashPoint).toBeNull();
      expect(live.currentMultiplier).toBeNull();
      expect(Array.isArray(live.bets)).toBe(true);
    },
    30_000,
  );

  test(
    "RUNNING round exposes currentMultiplier >= 1.0 and still hides serverSeed",
    async () => {
      let current: CurrentRound | null = null;
      await waitFor(async () => {
        current = await fetchCurrent(booted.baseUrl);
        return current !== null && current.status === "RUNNING";
      }, 15_000);

      const live = current!;
      expect(live.status).toBe("RUNNING");
      expect(live.currentMultiplier).not.toBeNull();
      expect(live.currentMultiplier!).toBeGreaterThanOrEqual(1.0);
      expect(live.serverSeed).toBeNull();
    },
    30_000,
  );

  test(
    "after SETTLED the endpoint returns the NEXT open round, not the settled one",
    async () => {
      let firstSeen: CurrentRound | null = null;
      await waitFor(async () => {
        firstSeen = await fetchCurrent(booted.baseUrl);
        return firstSeen !== null && firstSeen.status === "BETTING";
      }, 15_000);

      const firstId = firstSeen!.roundId;

      let nextSeen: CurrentRound | null = null;
      await waitFor(async () => {
        nextSeen = await fetchCurrent(booted.baseUrl);
        return (
          nextSeen !== null &&
          nextSeen.roundId !== firstId &&
          nextSeen.status === "BETTING"
        );
      }, 30_000);

      expect(nextSeen!.roundId).not.toBe(firstId);
      expect(nextSeen!.status).toBe("BETTING");
      expect(nextSeen!.serverSeed).toBeNull();
    },
    60_000,
  );
});
