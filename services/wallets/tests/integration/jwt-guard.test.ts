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

async function post(headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/wallets`, { method: "POST", headers });
}

describe("jwt-guard integration", () => {
  test("missing Authorization header returns 401", async () => {
    const res = await post();
    expect(res.status).toBe(401);
  });

  test("malformed bearer (no Bearer prefix) returns 401", async () => {
    const res = await post({ Authorization: "Basic abc.def.ghi" });
    expect(res.status).toBe(401);
  });

  test("valid token returns 201 (provision happy path)", async () => {
    const token = await mintTestJwt("p-jwt-valid");
    const res = await post({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(201);
  });

  test("mismatched iss claim returns 401", async () => {
    const token = await mintTestJwt("p-jwt-iss", {
      iss: "http://attacker/realms/evil",
    });
    const res = await post({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("mismatched aud claim returns 401", async () => {
    const token = await mintTestJwt("p-jwt-aud", { aud: "wrong-audience" });
    const res = await post({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("expired token returns 401", async () => {
    const expiredSec = Math.floor(Date.now() / 1000) - 120;
    const token = await mintTestJwt("p-jwt-expired", { exp: expiredSec });
    const res = await post({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  test("token signed by foreign key returns 401", async () => {
    const token = await mintTestJwt("p-jwt-foreign", { signWithForeign: true });
    const res = await post({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });
});
