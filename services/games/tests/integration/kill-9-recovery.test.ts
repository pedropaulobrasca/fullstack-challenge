// kill -9 recovery integration test.
//
// SIGKILL simulation caveat: a real `kill -9` skips every NestJS lifecycle hook
// (OnApplicationShutdown is never invoked, the recursive setTimeout is never
// cleared, no graceful AMQP/PG drain). We cannot SIGKILL ourselves in-process
// without losing the bun:test harness, so this suite simulates termination via
// `app.close()`. That path DOES run OnApplicationShutdown, which is friendlier
// to the loop than true SIGKILL — but the recovery property we are exercising
// is exactly the one a SIGKILL exposes: on the next cold boot, the persisted
// rounds/seed_chain rows are the ONLY source of truth, and recoverInFlightRound
// must reconstruct the timer schedule from them. The true-SIGKILL drill is
// deferred to the Plan 04-11 smoke checkpoint per REQ-GAME-09.

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

describe("kill-9-recovery integration (REQ-GAME-09)", () => {
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
    "round caught mid-RUNNING resumes to SETTLED on cold restart",
    async () => {
      const runningRow = await pollRound(
        booted.em,
        (r) => r.status === "RUNNING",
        10_000,
      );
      const targetRoundId = runningRow.id as string;
      const nonceBefore = (runningRow.nonce as string).toString();

      await booted.app.close();

      await new Promise((r) => setTimeout(r, 200));

      booted = await createTestGamesApp();

      await waitFor(
        async () => {
          const rows = await booted.em
            .getConnection()
            .execute(
              "SELECT status FROM rounds WHERE id = ?",
              [targetRoundId],
            );
          const status = rows[0]?.status;
          return status === "SETTLED" || status === "CRASHED";
        },
        15_000,
      );

      const settled = await pollRound(
        booted.em,
        (r) => r.id === targetRoundId && r.status === "SETTLED",
        15_000,
      );
      expect(settled.id).toBe(targetRoundId);
      expect(settled.nonce.toString()).toBe(nonceBefore);
      expect(settled.server_seed).not.toBeNull();
      expect(settled.crash_point_centi_x).not.toBeNull();
    },
    60_000,
  );

  test(
    "loop continues to new BETTING rounds after recovery",
    async () => {
      const next = await pollRound(
        booted.em,
        (r) => r.status === "BETTING",
        10_000,
      );
      expect(next.status).toBe("BETTING");
      expect(next.server_seed).toBeNull();
    },
    30_000,
  );
});
