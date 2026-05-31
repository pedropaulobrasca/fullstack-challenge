/* eslint-disable @typescript-eslint/no-explicit-any */

import { setupIntegrationEnv, loadAppModule } from "./_helpers/test-env";

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

let app: any;
let baseUrl: string;

async function bootApp(): Promise<void> {
  const { Test, AppModule } = await loadAppModule();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();
  await app.listen(0, "127.0.0.1");
  const address = (app.getHttpServer().address?.() ?? {}) as {
    port?: number;
  };
  baseUrl = `http://127.0.0.1:${address.port ?? 0}`;
}

describe("GET /metrics (games) — REQ-OBS-02", () => {
  beforeAll(async () => {
    await bootApp();
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  }, 30_000);

  test("returns 200 with Prometheus exposition content-type", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType.startsWith("text/plain")).toBe(true);
    expect(contentType).toContain("version=0.0.4");
  });

  test("body exposes the 5 custom crash metric names", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    const body = await res.text();
    expect(body).toContain("crash_bet_volume_total");
    expect(body).toContain("crash_rtp_window");
    expect(body).toContain("crash_multiplier_drift_seconds");
    expect(body).toContain("crash_ws_broadcast_latency_seconds");
    expect(body).toContain("crash_active_ws_connections");
  });

  test("body exposes default Node.js process metrics", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    const body = await res.text();
    expect(body).toContain("process_cpu_seconds_total");
    expect(body).toContain("nodejs_eventloop_lag_seconds");
  });

  test("response body stays bounded (no high-cardinality label explosion)", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    const body = await res.text();
    expect(body.length).toBeLessThan(200_000);
  });
});
