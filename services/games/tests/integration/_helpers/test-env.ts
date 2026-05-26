/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

const DEFAULTS: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://admin:admin@localhost:5432/games",
  RABBITMQ_URL: "amqp://admin:admin@localhost:5672",
  PORT: "0",
  CURRENCY_CODE: "CRD",
  CURRENCY_BASE: "10",
  CURRENCY_EXPONENT: "2",
  BETTING_WINDOW_MS: "200",
  COOLDOWN_MS: "100",
  SERVER_TICK_HZ: "30",
  GROWTH_RATE: "0.06",
  INSTANT_CRASH_BUCKET: "101",
  BET_MIN_CENTS: "100",
  BET_MAX_CENTS: "100000",
  HASH_CHAIN_LENGTH: "20",
  SAGA_TIMEOUT_MS: "5000",
  OUTBOX_POLL_INTERVAL_MS: "1000",
  OUTBOX_POLL_BATCH_SIZE: "100",
  RMQ_DELIVERY_LIMIT_MAIN: "5",
  RMQ_DELIVERY_LIMIT_DLQ: "3",
  AUTO_CASHOUT_MAX_X: "100",
  LEADERBOARD_WINDOW_HOURS: "24",
  LEADERBOARD_TOP_N: "10",
  KEYCLOAK_ISSUER: "http://localhost:8080/realms/crash-game",
  KEYCLOAK_JWKS_URI:
    "http://localhost:8080/realms/crash-game/protocol/openid-connect/certs",
  KEYCLOAK_AUDIENCE: "account",
};

export function setupIntegrationEnv(
  overrides: Record<string, string> = {},
): void {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

const KEYCLOAK_TOKEN_URL =
  "http://localhost:8080/realms/crash-game/protocol/openid-connect/token";

export async function fetchPlayerToken(
  username = "player",
  password = "player123",
  clientId = "crash-game-client",
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username,
    password,
  });
  const res = await fetch(KEYCLOAK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `keycloak token grant failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("keycloak token grant returned no access_token");
  }
  return json.access_token;
}

export async function loadAppModule(): Promise<{
  Test: any;
  AppModule: any;
  EntityManager: any;
}> {
  const { Test } = await import("@nestjs/testing");
  const { AppModule } = await import("../../../src/app.module");
  const { EntityManager } = await import("@mikro-orm/postgresql");
  return { Test, AppModule, EntityManager };
}
