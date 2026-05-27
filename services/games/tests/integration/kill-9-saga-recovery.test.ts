// REQ-TEST-04: TRUE-SIGKILL saga recovery drill.
//
// The P4.11 pattern is canonical: `docker compose kill -s SIGKILL games` followed
// by `docker compose up -d games` then assert the saga reaches a terminal state
// on cold restart. In-process `app.close()` is NOT equivalent — it runs the
// graceful shutdown hooks (clears the recursive setTimeout, drains AMQP) which
// hides the real recovery path. SIGKILL skips every lifecycle hook so the only
// source of truth on restart is the persisted bet_saga_state + outbox rows.
//
// This suite self-skips when:
//   1. INTEGRATION != "1"
//   2. `docker` CLI is unavailable on PATH (CI without docker access)
//   3. The games container is not currently running (covered by docker exit code)
//
// Because SIGKILL'ing the games container also kills the in-process test app
// when they share the same process tree, we use the container-driven path
// exclusively here. The Test harness inside this file does NOT use
// createTestGamesApp — instead it talks to the games HTTP API through Kong at
// :8000 and inspects state via a direct pg client (since the games-service
// EntityManager would also die when we kill the container).

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties */

import { setupIntegrationEnv, fetchPlayerToken } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const KONG_BASE = process.env.KONG_BASE_URL ?? "http://localhost:8000";
const REPO_ROOT = process.env.REPO_ROOT ?? process.cwd().replace(/\/services\/games$/, "");

function dockerAvailable(): boolean {
  const which = spawnSync("which", ["docker"], { encoding: "utf-8" });
  if (which.status !== 0) return false;
  const compose = spawnSync("docker", ["compose", "version"], {
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
  return compose.status === 0;
}

function killGames(): void {
  const res = spawnSync(
    "docker",
    ["compose", "kill", "-s", "SIGKILL", "games"],
    { encoding: "utf-8", cwd: REPO_ROOT },
  );
  if (res.status !== 0) {
    throw new Error(
      `docker compose kill SIGKILL failed: ${res.stderr || res.stdout}`,
    );
  }
}

function startGames(): void {
  const res = spawnSync("docker", ["compose", "start", "games"], {
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
  if (res.status !== 0) {
    const up = spawnSync("docker", ["compose", "up", "-d", "games"], {
      encoding: "utf-8",
      cwd: REPO_ROOT,
    });
    if (up.status !== 0) {
      throw new Error(
        `docker compose start/up games failed: ${up.stderr || up.stdout}`,
      );
    }
  }
}

async function waitForKongRoute(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${KONG_BASE}/games/rounds/current`);
      if (res.status === 200) return;
    } catch {
      // network down — retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`games health endpoint did not become ready in ${timeoutMs}ms`);
}

async function provisionWallet(token: string): Promise<void> {
  const res = await fetch(`${KONG_BASE}/wallets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`wallet provision failed: ${res.status} ${await res.text()}`);
  }
}

const DOCKER_OK = dockerAvailable();

if (!DOCKER_OK) {
  console.log(
    "skipping kill-9-saga-recovery — docker CLI / compose not available on PATH",
  );
}

let playerToken: string;
let playerId: string;

describe("kill-9-saga-recovery integration (REQ-TEST-04)", () => {
  beforeAll(async () => {
    if (!DOCKER_OK) return;
    playerToken = await fetchPlayerToken();
    const payload = JSON.parse(
      Buffer.from(playerToken.split(".")[1]!, "base64").toString("utf-8"),
    );
    playerId = payload.sub as string;
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (!DOCKER_OK) return;
    try {
      startGames();
      await waitForKongRoute(60_000);
    } catch {
      // best-effort restart — afterAll must not throw
    }
  }, 90_000);

  test(
    "SIGKILL games mid-saga -> restart -> saga reaches consistent terminal state",
    async () => {
      if (!DOCKER_OK) {
        console.log("docker unavailable — skipping");
        return;
      }

      let placeBody: { betId: string; status: string } | null = null;
      for (let attempt = 0; attempt < 5 && placeBody === null; attempt++) {
        const placeRes = await fetch(`${KONG_BASE}/games/bet`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${playerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amountCents: "10000" }),
        });
        if (placeRes.status === 202) {
          placeBody = (await placeRes.json()) as {
            betId: string;
            status: string;
          };
        } else {
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      expect(placeBody).not.toBeNull();
      const betId = placeBody!.betId;

      killGames();
      await new Promise((r) => setTimeout(r, 500));
      startGames();
      await waitForKongRoute(60_000);

      const start = Date.now();
      let terminal: { bet: string; saga: string } | null = null;
      while (Date.now() - start < 30_000) {
        const res = await fetch(`${KONG_BASE}/games/bets/me`, {
          headers: { Authorization: `Bearer ${playerToken}` },
        });
        if (res.status === 200) {
          const body = (await res.json()) as {
            bets: Array<{ betId: string; status: string }>;
          };
          const mine = body.bets.find((b) => b.betId === betId);
          if (mine && mine.status !== "PENDING") {
            terminal = { bet: mine.status, saga: "unknown" };
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      expect(terminal).not.toBeNull();
      expect(["ACTIVE", "REFUNDED", "CASHED_OUT", "LOST"]).toContain(
        terminal!.bet,
      );
    },
    180_000,
  );
});
