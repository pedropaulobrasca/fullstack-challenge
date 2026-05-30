import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { gamesEnvSchema } from "../../src/config/defaults";

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

describe("Phase 9 env extensions — gamesEnvSchema", () => {
  test("parses LEADERBOARD_UPDATE_THROTTLE_MS as a positive integer", () => {
    const parsed = gamesEnvSchema.parse({
      ...baseValidEnv(),
      LEADERBOARD_UPDATE_THROTTLE_MS: "500",
    });
    expect(parsed.LEADERBOARD_UPDATE_THROTTLE_MS).toBe(500);
  });

  test("applies locked Phase 9 defaults when none of the 4 new keys are provided", () => {
    const parsed = gamesEnvSchema.parse(baseValidEnv());
    expect(parsed.LEADERBOARD_UPDATE_THROTTLE_MS).toBe(0);
    expect(parsed.STOP_LOSS_CENTS_MAX).toBe(100000);
    expect(parsed.STOP_WIN_CENTS_MAX).toBe(100000);
    expect(parsed.AUTO_BET_MIN_TARGET_CENTI_X).toBe(101);
  });

  test("rejects AUTO_BET_MIN_TARGET_CENTI_X below 101 (1.01x floor)", () => {
    expect(() =>
      gamesEnvSchema.parse({
        ...baseValidEnv(),
        AUTO_BET_MIN_TARGET_CENTI_X: "100",
      }),
    ).toThrow();
  });

  test("rejects STOP_LOSS_CENTS_MAX of zero", () => {
    expect(() =>
      gamesEnvSchema.parse({
        ...baseValidEnv(),
        STOP_LOSS_CENTS_MAX: "0",
      }),
    ).toThrow();
  });

  test("rejects STOP_WIN_CENTS_MAX of zero", () => {
    expect(() =>
      gamesEnvSchema.parse({
        ...baseValidEnv(),
        STOP_WIN_CENTS_MAX: "0",
      }),
    ).toThrow();
  });

  test("rejects negative LEADERBOARD_UPDATE_THROTTLE_MS", () => {
    expect(() =>
      gamesEnvSchema.parse({
        ...baseValidEnv(),
        LEADERBOARD_UPDATE_THROTTLE_MS: "-1",
      }),
    ).toThrow();
  });

  test("accepts explicit overrides for all 4 new keys", () => {
    const parsed = gamesEnvSchema.parse({
      ...baseValidEnv(),
      LEADERBOARD_UPDATE_THROTTLE_MS: "250",
      STOP_LOSS_CENTS_MAX: "200000",
      STOP_WIN_CENTS_MAX: "150000",
      AUTO_BET_MIN_TARGET_CENTI_X: "150",
    });
    expect(parsed.LEADERBOARD_UPDATE_THROTTLE_MS).toBe(250);
    expect(parsed.STOP_LOSS_CENTS_MAX).toBe(200000);
    expect(parsed.STOP_WIN_CENTS_MAX).toBe(150000);
    expect(parsed.AUTO_BET_MIN_TARGET_CENTI_X).toBe(150);
  });
});
