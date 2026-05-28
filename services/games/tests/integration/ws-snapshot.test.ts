// REQ-WS-04: round:snapshot emitted once on connect and once on each reconnect.
// Multi-tab parity: two sockets sharing a token receive structurally identical snapshots.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties, @typescript-eslint/no-explicit-any */

import { setupIntegrationEnv, fetchPlayerToken, loadAppModule } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "500",
  INSTANT_CRASH_BUCKET: "1000000",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWsClient } from "./_helpers/ws-client";
import { roundSnapshotPayloadSchema } from "../../src/presentation/dtos/ws-event.payloads";

let app: any;
let baseUrl: string;
let wsPath: string;
let playerToken: string;

async function bootWsApp(): Promise<void> {
  const { Test, AppModule } = await loadAppModule();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  const { JwtIoAdapter } = await import(
    "../../src/presentation/adapters/jwt-io.adapter"
  );
  const { JwtVerifierService } = await import(
    "../../src/presentation/auth/jwt-verifier.service"
  );
  const verifier = app.get(JwtVerifierService);
  app.useWebSocketAdapter(new JwtIoAdapter(app, verifier));
  await app.init();
  await app.listen(0, "127.0.0.1");
  const address = (app.getHttpServer().address?.() ?? {}) as { port?: number };
  const port = address.port ?? 0;
  baseUrl = `http://127.0.0.1:${port}`;
  const { env } = await import("../../src/config/defaults");
  wsPath = env.WS_PATH;
}

describe("ws-snapshot integration (REQ-WS-04)", () => {
  beforeAll(async () => {
    await bootWsApp();
    playerToken = await fetchPlayerToken();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  test("client receives round:snapshot within 2s of connecting; payload parses against schema", async () => {
    const client = createWsClient({
      baseUrl,
      path: wsPath,
      token: playerToken,
    });
    try {
      await client.connect();
      const payload = await client.waitForEvent("round:snapshot", 2000);
      const parsed = roundSnapshotPayloadSchema.parse(payload);
      expect(parsed.round.id.length).toBeGreaterThan(0);
      expect(Array.isArray(parsed.activeBets)).toBe(true);
      expect(parsed.serverTime).toBeGreaterThan(0);
      expect(Math.abs(parsed.serverTime - Date.now())).toBeLessThan(5000);
    } finally {
      await client.close();
    }
  }, 15_000);

  test("reconnecting receives a fresh round:snapshot", async () => {
    const first = createWsClient({
      baseUrl,
      path: wsPath,
      token: playerToken,
    });
    await first.connect();
    await first.waitForEvent("round:snapshot", 2000);
    await first.close();

    const second = createWsClient({
      baseUrl,
      path: wsPath,
      token: playerToken,
    });
    try {
      await second.connect();
      const payload = await second.waitForEvent("round:snapshot", 2000);
      const parsed = roundSnapshotPayloadSchema.parse(payload);
      expect(parsed.round.id.length).toBeGreaterThan(0);
    } finally {
      await second.close();
    }
  }, 20_000);

  test("multi-tab parity: two sockets sharing a token observe structurally aligned snapshots", async () => {
    const tabA = createWsClient({
      baseUrl,
      path: wsPath,
      token: playerToken,
    });
    const tabB = createWsClient({
      baseUrl,
      path: wsPath,
      token: playerToken,
    });
    try {
      const [payloadA, payloadB] = await Promise.all([
        (async (): Promise<unknown> => {
          await tabA.connect();
          return tabA.waitForEvent("round:snapshot", 3000);
        })(),
        (async (): Promise<unknown> => {
          await tabB.connect();
          return tabB.waitForEvent("round:snapshot", 3000);
        })(),
      ]);

      const parsedA = roundSnapshotPayloadSchema.parse(payloadA);
      const parsedB = roundSnapshotPayloadSchema.parse(payloadB);

      expect(parsedA.round.id).toBe(parsedB.round.id);
      expect(parsedA.round.status).toBe(parsedB.round.status);
      expect(parsedA.round.nonce).toBe(parsedB.round.nonce);
      expect(parsedA.round.seedHash).toBe(parsedB.round.seedHash);
    } finally {
      await tabA.close();
      await tabB.close();
    }
  }, 20_000);
});
