function applyDefaults(): void {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/games_test";
  process.env.RABBITMQ_URL ??= "amqp://test:test@localhost:5672";
  process.env.NODE_ENV ??= "test";
  process.env.CURRENCY_CODE ??= "CRD";
  process.env.CURRENCY_BASE ??= "10";
  process.env.CURRENCY_EXPONENT ??= "2";
  process.env.PORT ??= "4001";
  process.env.BETTING_WINDOW_MS ??= "5000";
  process.env.COOLDOWN_MS ??= "2000";
  process.env.SERVER_TICK_HZ ??= "30";
  process.env.GROWTH_RATE ??= "0.06";
  process.env.INSTANT_CRASH_BUCKET ??= "101";
  process.env.BET_MIN_CENTS ??= "100";
  process.env.BET_MAX_CENTS ??= "100000";
  process.env.HASH_CHAIN_LENGTH ??= "1000000";
  process.env.SAGA_TIMEOUT_MS ??= "5000";
  process.env.SAGA_SWEEP_INTERVAL_MS ??= "1000";
  process.env.OUTBOX_POLL_INTERVAL_MS ??= "1000";
  process.env.OUTBOX_POLL_BATCH_SIZE ??= "100";
  process.env.RMQ_DELIVERY_LIMIT_MAIN ??= "5";
  process.env.RMQ_DELIVERY_LIMIT_DLQ ??= "3";
  process.env.AUTO_CASHOUT_MAX_X ??= "100";
  process.env.LEADERBOARD_WINDOW_HOURS ??= "24";
  process.env.LEADERBOARD_TOP_N ??= "10";
  process.env.KEYCLOAK_ISSUER ??= "http://localhost:8080/realms/crash-game-test";
  process.env.KEYCLOAK_JWKS_URI ??=
    "http://localhost:8080/realms/crash-game-test/protocol/openid-connect/certs";
  process.env.KEYCLOAK_AUDIENCE ??= "account";
  process.env.WS_PATH ??= "/ws";
  process.env.WS_PORT ??= "4101";
}

applyDefaults();

export function setupGamesTestEnv(): void {
  applyDefaults();
}
