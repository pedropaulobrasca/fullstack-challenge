// REQ-WS-06: volatile.emit ticks. Two clients connected with the same Keycloak token
// (multi-tab scenario) both receive >= 60 ticks over a 3s window during RUNNING.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties, @typescript-eslint/no-explicit-any */

import { setupIntegrationEnv, fetchPlayerToken, loadAppModule } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "500",
  INSTANT_CRASH_BUCKET: "1000000",
  GROWTH_RATE: "0.02",
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
  const { env } = await import("../../src/config/defaults");
  baseUrl = `http://127.0.0.1:${env.WS_PORT}`;
  wsPath = env.WS_PATH;
}

describe("ws-tick-volatile integration (REQ-WS-06)", () => {
  beforeAll(async () => {
    await bootWsApp();
    playerToken = await fetchPlayerToken();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  test(
    "two clients sharing a token each receive >= 60 round:tick events over 3s of RUNNING",
    async () => {
      const tabA = createWsClient({ baseUrl, path: wsPath, token: playerToken });
      const tabB = createWsClient({ baseUrl, path: wsPath, token: playerToken });

      await tabA.connect();
      await tabB.connect();

      const recorderA = tabA.recordEvents(["round:tick"]);
      const recorderB = tabB.recordEvents(["round:tick"]);

      try {
        await Promise.all([
          tabA.waitForEvent("round:running", 30_000),
          tabB.waitForEvent("round:running", 30_000),
        ]);

        await new Promise((r) => setTimeout(r, 3000));
        recorderA.stop();
        recorderB.stop();

        expect(recorderA.events.length).toBeGreaterThanOrEqual(60);
        expect(recorderB.events.length).toBeGreaterThanOrEqual(60);
      } finally {
        recorderA.stop();
        recorderB.stop();
        await tabA.close();
        await tabB.close();
      }
    },
    60_000,
  );
});
