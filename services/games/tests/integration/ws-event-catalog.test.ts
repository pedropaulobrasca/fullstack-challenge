// REQ-WS-03: full round lifecycle event catalog observed in correct order over one arc.
// Sequence: round:started -> round:running -> round:tick (many) -> round:crashed -> round:settled.
// Additionally observes bet:placed + bet:my_active when a bet is placed during BETTING.

/* eslint-disable @typescript-eslint/no-restricted-imports, no-restricted-properties, @typescript-eslint/no-explicit-any */

import { setupIntegrationEnv, fetchPlayerToken, loadAppModule } from "./_helpers/test-env";

setupIntegrationEnv({
  HASH_CHAIN_LENGTH: "20",
  BETTING_WINDOW_MS: "2000",
  COOLDOWN_MS: "500",
  INSTANT_CRASH_BUCKET: "1000000",
  GROWTH_RATE: "0.06",
});

if (process.env.INTEGRATION !== "1") {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createWsClient, type RecordedEvent } from "./_helpers/ws-client";

const KONG_BASE = process.env.KONG_BASE_URL ?? "http://localhost:8000";

let app: any;
let baseUrl: string;
let wsBaseUrl: string;
let wsPath: string;
let playerToken: string;
let serverTickHz: number;

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
  wsBaseUrl = `http://127.0.0.1:${env.WS_PORT}`;
  wsPath = env.WS_PATH;
  serverTickHz = env.SERVER_TICK_HZ;
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

function firstIndex(events: RecordedEvent[], name: string): number {
  return events.findIndex((e) => e.name === name);
}

describe("ws-event-catalog integration (REQ-WS-03)", () => {
  beforeAll(async () => {
    await bootWsApp();
    playerToken = await fetchPlayerToken();
    await provisionWallet(playerToken);
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  test(
    "round arc emits started -> running -> ticks -> crashed -> settled in order",
    async () => {
      const client = createWsClient({
        baseUrl: wsBaseUrl,
        path: wsPath,
        token: playerToken,
      });
      await client.connect();
      const recorder = client.recordEvents([
        "round:started",
        "round:running",
        "round:tick",
        "round:crashed",
        "round:settled",
        "bet:placed",
        "bet:my_active",
        "bet:cashed_out",
        "bet:my_cashed_out",
      ]);

      try {
        const settledPromise = client.waitForEvent("round:settled", 60_000);
        const startedPromise = client.waitForEvent("round:started", 30_000);
        await startedPromise;
        await settledPromise;
        await new Promise((r) => setTimeout(r, 50));
        recorder.stop();

        const events = recorder.events;
        const startedIdx = firstIndex(events, "round:started");
        const runningIdx = firstIndex(events, "round:running");
        const tickIdx = firstIndex(events, "round:tick");
        const crashedIdx = firstIndex(events, "round:crashed");
        const settledIdx = firstIndex(events, "round:settled");

        expect(startedIdx).toBeGreaterThanOrEqual(0);
        expect(runningIdx).toBeGreaterThan(startedIdx);
        expect(tickIdx).toBeGreaterThan(runningIdx);
        expect(crashedIdx).toBeGreaterThan(tickIdx);
        expect(settledIdx).toBeGreaterThan(crashedIdx);

        const runningEvent = events[runningIdx]!;
        const crashedEvent = events[crashedIdx]!;
        const ticks = events.filter(
          (e) =>
            e.name === "round:tick" &&
            e.t >= runningEvent.t &&
            e.t <= crashedEvent.t,
        );
        const runningMs = crashedEvent.t - runningEvent.t;
        const expectedMinTicks = Math.floor((runningMs / 1000) * serverTickHz * 0.6);
        expect(ticks.length).toBeGreaterThanOrEqual(expectedMinTicks);
      } finally {
        recorder.stop();
        await client.close();
      }
    },
    90_000,
  );

  test(
    "placing a bet during BETTING surfaces bet:placed and bet:my_active over WS",
    async () => {
      const client = createWsClient({
        baseUrl: wsBaseUrl,
        path: wsPath,
        token: playerToken,
      });
      await client.connect();

      try {
        const startedPayload = (await client.waitForEvent(
          "round:started",
          30_000,
        )) as { roundId: string };
        const placePromise = client.waitForEvent("bet:placed", 30_000);
        const myActivePromise = client.waitForEvent("bet:my_active", 30_000);

        const res = await fetch(`${baseUrl}/games/bet`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${playerToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amountCents: "1000" }),
        });
        expect(res.status).toBe(202);

        const placePayload = (await placePromise) as { roundId: string };
        const myActivePayload = (await myActivePromise) as { roundId: string };

        expect(placePayload.roundId).toBe(startedPayload.roundId);
        expect(myActivePayload.roundId).toBe(startedPayload.roundId);
      } finally {
        await client.close();
      }
    },
    90_000,
  );
});
