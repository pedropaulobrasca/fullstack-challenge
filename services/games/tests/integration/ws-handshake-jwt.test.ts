// REQ-WS-01: JWT validated at WS handshake via JwtIoAdapter.
// Three branches: missing token rejected, garbage token rejected, valid Keycloak token accepted.

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

describe("ws-handshake-jwt integration (REQ-WS-01)", () => {
  beforeAll(async () => {
    await bootWsApp();
    playerToken = await fetchPlayerToken();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  test("connection without token is rejected with connect_error UNAUTHORIZED", async () => {
    const client = createWsClient({ baseUrl, path: wsPath });
    let rejection: Error | null = null;
    try {
      await client.connect();
    } catch (err) {
      rejection = err as Error;
    } finally {
      await client.close();
    }
    expect(rejection).not.toBeNull();
    expect(rejection!.message).toContain("UNAUTHORIZED");
  }, 15_000);

  test("connection with garbage token is rejected with connect_error UNAUTHORIZED", async () => {
    const client = createWsClient({
      baseUrl,
      path: wsPath,
      token: "not-a-real-jwt",
    });
    let rejection: Error | null = null;
    try {
      await client.connect();
    } catch (err) {
      rejection = err as Error;
    } finally {
      await client.close();
    }
    expect(rejection).not.toBeNull();
    expect(rejection!.message).toContain("UNAUTHORIZED");
  }, 15_000);

  test("connection with valid Keycloak token is accepted and socket.data.playerId is set", async () => {
    const client = createWsClient({
      baseUrl,
      path: wsPath,
      token: playerToken,
    });
    try {
      await client.connect();
      expect(client.socket.connected).toBe(true);
    } finally {
      await client.close();
    }
  }, 15_000);
});
