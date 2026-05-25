if (!process.env.INTEGRATION) {
  console.log("skipping integration suite — set INTEGRATION=1");
  process.exit(0);
}

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  bootstrapWalletsApp,
  mintTestJwt,
  resetWalletsSchema,
  stopJwksServer,
} from "./setup";

let app: { stop: () => Promise<void> };
let baseUrl: string;
let em: any;

const INITIAL_BALANCE_CENTS = "100000";

beforeAll(async () => {
  const booted = await bootstrapWalletsApp();
  app = booted;
  baseUrl = booted.baseUrl;
  em = booted.em;
}, 60_000);

afterEach(async () => {
  await resetWalletsSchema(em);
});

afterAll(async () => {
  if (app) await app.stop();
  await stopJwksServer();
}, 30_000);

describe("provision-wallet integration", () => {
  test("first POST /wallets returns 201 with initial balance", async () => {
    const playerId = "p-provision-first";
    const token = await mintTestJwt(playerId);
    const res = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.playerId).toBe(playerId);
    expect(body.balance.amount).toBe(INITIAL_BALANCE_CENTS);
    expect(body.balance.currency).toBe("CRD");
  });

  test("second POST /wallets with same JWT returns 200 and same wallet id", async () => {
    const playerId = "p-provision-second";
    const token = await mintTestJwt(playerId);
    const first = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.balance.amount).toBe(INITIAL_BALANCE_CENTS);
  });

  test("GET /wallets/me without prior POST returns 404 WALLET_NOT_PROVISIONED", async () => {
    const playerId = "p-not-provisioned";
    const token = await mintTestJwt(playerId);
    const res = await fetch(`${baseUrl}/wallets/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message?.code ?? body.code).toBe("WALLET_NOT_PROVISIONED");
  });

  test("GET /wallets/me after POST returns 200 with the provisioned balance", async () => {
    const playerId = "p-provision-getme";
    const token = await mintTestJwt(playerId);
    await fetch(`${baseUrl}/wallets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await fetch(`${baseUrl}/wallets/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.playerId).toBe(playerId);
    expect(body.balance.amount).toBe(INITIAL_BALANCE_CENTS);
  });
});
