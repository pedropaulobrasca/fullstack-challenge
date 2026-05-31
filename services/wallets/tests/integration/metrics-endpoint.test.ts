if (!process.env.INTEGRATION) {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bootstrapWalletsApp, stopJwksServer } from "./setup";

let app: { stop: () => Promise<void> };
let baseUrl: string;

beforeAll(async () => {
  const booted = await bootstrapWalletsApp();
  app = booted;
  baseUrl = booted.baseUrl;
}, 60_000);

afterAll(async () => {
  if (app) await app.stop();
  await stopJwksServer();
}, 30_000);

describe("GET /metrics (wallets) — REQ-OBS-02", () => {
  test("returns 200 with Prometheus exposition content-type", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType.startsWith("text/plain")).toBe(true);
    expect(contentType).toContain("version=0.0.4");
  });

  test("body exposes default Node.js process metrics", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    const body = await res.text();
    expect(body).toContain("process_cpu_seconds_total");
    expect(body).toContain("nodejs_eventloop_lag_seconds");
  });

  test("body does NOT expose any games-specific custom metrics", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    const body = await res.text();
    expect(body).not.toContain("crash_bet_volume_total");
    expect(body).not.toContain("crash_rtp_window");
    expect(body).not.toContain("crash_multiplier_drift_seconds");
    expect(body).not.toContain("crash_ws_broadcast_latency_seconds");
    expect(body).not.toContain("crash_active_ws_connections");
  });
});
