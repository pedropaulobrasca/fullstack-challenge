import { describe, expect, test, afterAll } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../../..");
const gamesMain = resolve(repoRoot, "services/games/src/main.ts");
const walletsMain = resolve(repoRoot, "services/wallets/src/main.ts");

async function firstLineOf(path: string): Promise<string> {
  const text = await readFile(path, "utf8");
  return text.split("\n")[0] ?? "";
}

describe("OTel init-order Footgun #1", () => {
  test("services/games/src/main.ts first line imports ./tracing", async () => {
    const firstLine = await firstLineOf(gamesMain);
    expect(firstLine).toMatch(/^import\s+"\.\/tracing"/);
  });

  test("services/wallets/src/main.ts first line imports ./tracing", async () => {
    const firstLine = await firstLineOf(walletsMain);
    expect(firstLine).toMatch(/^import\s+"\.\/tracing"/);
  });

  test("tracing module loads without throwing and exposes a started sdk", async () => {
    const mod = await import("../../../src/tracing");
    expect(mod.sdk).toBeDefined();
    afterAll(async () => {
      await mod.sdk.shutdown().catch(() => undefined);
    });
  });
});
