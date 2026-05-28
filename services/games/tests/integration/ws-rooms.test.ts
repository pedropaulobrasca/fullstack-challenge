// REQ-WS-02: post-handshake the socket joins 'lobby' and 'user:{decodedSub}'.
// Asserts the server-side adapter view of room membership matches the decoded JWT sub.

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
let playerSub: string;

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

function decodeSub(token: string): string {
  const payloadB64 = token.split(".")[1]!;
  const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8"));
  return payload.sub as string;
}

describe("ws-rooms integration (REQ-WS-02)", () => {
  beforeAll(async () => {
    await bootWsApp();
    playerToken = await fetchPlayerToken();
    playerSub = decodeSub(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  test("after handshake the socket is joined to 'lobby' and 'user:{sub}'", async () => {
    const client = createWsClient({
      baseUrl,
      path: wsPath,
      token: playerToken,
    });
    try {
      await client.connect();
      await client.waitForEvent("round:snapshot", 5000);

      const { GameWsGateway } = await import(
        "../../src/presentation/gateways/game-ws.gateway"
      );
      const gateway = app.get(GameWsGateway);
      const adapter = gateway.server.sockets.adapter;
      const lobby = adapter.rooms.get("lobby");
      const userRoom = adapter.rooms.get(`user:${playerSub}`);

      expect(lobby).toBeDefined();
      expect(userRoom).toBeDefined();
      expect(lobby!.has(client.socket.id!)).toBe(true);
      expect(userRoom!.has(client.socket.id!)).toBe(true);
    } finally {
      await client.close();
    }
  }, 20_000);
});
