import { setupIntegrationEnv } from "./_helpers/test-env";

setupIntegrationEnv({ HASH_CHAIN_LENGTH: "20" });

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestGamesApp,
  truncateGamesTables,
} from "./_helpers/app-factory";

const EXPECTED_DEPTH = 20;

let first: Awaited<ReturnType<typeof createTestGamesApp>>;

describe("seed-chain-bootstrap integration", () => {
  beforeAll(async () => {
    first = await createTestGamesApp();
    await truncateGamesTables(first.em);
    await first.app.close();
    first = await createTestGamesApp();
  }, 60_000);

  afterAll(async () => {
    if (first?.app) await first.app.close();
  }, 30_000);

  test(
    "cold start populates HASH_CHAIN_LENGTH rows in seed_chain",
    async () => {
      const rows = await first.em
        .getConnection()
        .execute("SELECT count(*)::int AS n FROM seed_chain");
      expect(rows[0]?.n).toBe(EXPECTED_DEPTH);
    },
    30_000,
  );

  test(
    "hash chain integrity: sha256(seed[i]) === hash[i-1] for every link",
    async () => {
      const rows = await first.em
        .getConnection()
        .execute(
          "SELECT nonce::text AS nonce, hash, seed FROM seed_chain ORDER BY nonce ASC",
        );
      expect(rows.length).toBe(EXPECTED_DEPTH);

      for (let i = 1; i < rows.length; i++) {
        const prevSeed = rows[i].seed as string;
        const prevHash = rows[i - 1].hash as string;
        const recomputed = createHash("sha256")
          .update(prevSeed, "hex")
          .digest("hex");
        expect(recomputed).toBe(prevHash);
      }
    },
    30_000,
  );

  test(
    "second cold start is idempotent: row count unchanged after restart",
    async () => {
      const before = await first.em
        .getConnection()
        .execute("SELECT count(*)::int AS n FROM seed_chain");
      const beforeCount = before[0]?.n as number;

      await first.app.close();
      first = await createTestGamesApp();

      const after = await first.em
        .getConnection()
        .execute("SELECT count(*)::int AS n FROM seed_chain");
      expect(after[0]?.n).toBe(beforeCount);
      expect(after[0]?.n).toBe(EXPECTED_DEPTH);
    },
    60_000,
  );
});
