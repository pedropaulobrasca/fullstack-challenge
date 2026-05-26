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
    "hash chain integrity: sha256(seed[i+1]) === seed[i] and hash[i] === sha256(seed[i]) for every row",
    async () => {
      const rows = await first.em
        .getConnection()
        .execute(
          "SELECT nonce, hash, seed FROM seed_chain ORDER BY nonce ASC",
        );
      expect(rows.length).toBe(EXPECTED_DEPTH);

      for (let i = 0; i < rows.length; i++) {
        const seed = rows[i].seed as string;
        const hash = rows[i].hash as string;
        const recomputedHash = createHash("sha256")
          .update(seed, "hex")
          .digest("hex");
        expect(recomputedHash).toBe(hash);
      }

      for (let i = 0; i < rows.length - 1; i++) {
        const nextSeed = rows[i + 1].seed as string;
        const currentSeed = rows[i].seed as string;
        const linkedSeed = createHash("sha256")
          .update(nextSeed, "hex")
          .digest("hex");
        expect(linkedSeed).toBe(currentSeed);
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
