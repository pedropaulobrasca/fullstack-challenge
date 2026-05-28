import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { env, gamesEnvSchema } from "../../src/config/defaults";

function baseValidEnv(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://test:test@localhost:5432/games_test",
    RABBITMQ_URL: "amqp://test:test@localhost:5672",
    NODE_ENV: "test",
    CURRENCY_CODE: "CRD",
    CURRENCY_BASE: "10",
    CURRENCY_EXPONENT: "2",
    KEYCLOAK_ISSUER: "http://localhost:8080/realms/crash-game-test",
    KEYCLOAK_JWKS_URI:
      "http://localhost:8080/realms/crash-game-test/protocol/openid-connect/certs",
    KEYCLOAK_AUDIENCE: "account",
  };
}

describe("env.WS_PATH", () => {
  test("env.WS_PATH defaults to /ws when unset", () => {
    const parsed = gamesEnvSchema.parse(baseValidEnv());
    expect(parsed.WS_PATH).toBe("/ws");
  });

  test("frozen env exposes WS_PATH at runtime", () => {
    expect(env.WS_PATH).toBe("/ws");
  });

  test("accepts a custom path starting with /", () => {
    const parsed = gamesEnvSchema.parse({
      ...baseValidEnv(),
      WS_PATH: "/realtime",
    });
    expect(parsed.WS_PATH).toBe("/realtime");
  });

  test("rejects values that do not start with /", () => {
    expect(() =>
      gamesEnvSchema.parse({ ...baseValidEnv(), WS_PATH: "ws" }),
    ).toThrow();
  });

  test("rejects empty string", () => {
    expect(() =>
      gamesEnvSchema.parse({ ...baseValidEnv(), WS_PATH: "" }),
    ).toThrow();
  });
});
