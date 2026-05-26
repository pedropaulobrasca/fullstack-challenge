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

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestGamesApp,
  pollRound,
  truncateGamesTables,
  waitFor,
} from "./_helpers/app-factory";

let booted: Awaited<ReturnType<typeof createTestGamesApp>>;

describe("round-loop-autonomous integration", () => {
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
    "loop progresses BETTING -> RUNNING -> CRASHED -> SETTLED -> next BETTING without external triggers",
    async () => {
      const bettingRow = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        5000,
      );
      expect(bettingRow.status).toBe("BETTING");
      expect(typeof bettingRow.seed_hash).toBe("string");
      expect((bettingRow.seed_hash as string).length).toBe(64);
      expect(bettingRow.server_seed).toBeNull();

      const firstRoundId = bettingRow.id as string;

      const runningRow = await pollRound(
        booted.em,
        (r) => r.id === firstRoundId && r.status === "RUNNING",
        5000,
      );
      expect(runningRow.started_at).not.toBeNull();
      expect(runningRow.server_seed).toBeNull();
      expect(runningRow.crash_point_centi_x).toBeNull();

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute(
              "SELECT status FROM rounds WHERE id = ?",
              [firstRoundId],
            );
          return rows[0]?.status === "CRASHED" || rows[0]?.status === "SETTLED";
        },
        10_000,
      );

      const settledRow = await pollRound(
        booted.em,
        (r) => r.id === firstRoundId && r.status === "SETTLED",
        10_000,
      );
      expect(settledRow.server_seed).not.toBeNull();
      expect((settledRow.server_seed as string).length).toBe(64);
      expect(settledRow.crash_point_centi_x).not.toBeNull();
      expect(settledRow.settled_at).not.toBeNull();

      const nextBetting = await pollRound(
        booted.em,
        (r) => r.id !== firstRoundId && r.status === "BETTING",
        5000,
      );
      expect(nextBetting.id).not.toBe(firstRoundId);
      expect(nextBetting.status).toBe("BETTING");
      expect(nextBetting.server_seed).toBeNull();
    },
    45_000,
  );
});
