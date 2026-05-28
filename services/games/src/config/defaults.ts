// Phase 1 defaults from REQUIREMENTS §Open Configuration Values.
// OD8 (BET_MIN/MAX_CENTS) and OD14 (AUTO_CASHOUT_MAX_X) pending user confirmation pre-Phase 4 / pre-Phase 9.

import { sharedEnvSchema } from "@crash/shared-kernel";
import { z } from "zod";

const bigIntFromString = z
  .string()
  .regex(/^\d+$/)
  .transform((raw) => BigInt(raw));

export const gamesEnvSchema = sharedEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4001),
  WS_PORT: z.coerce.number().int().positive().default(4101),
  BETTING_WINDOW_MS: z.coerce.number().int().positive().default(5000),
  COOLDOWN_MS: z.coerce.number().int().positive().default(2000),
  SERVER_TICK_HZ: z.coerce.number().int().positive().default(30),
  GROWTH_RATE: z.coerce.number().positive().default(0.06),
  INSTANT_CRASH_BUCKET: z.coerce.number().int().positive().default(101),
  BET_MIN_CENTS: bigIntFromString.default("100"),
  BET_MAX_CENTS: bigIntFromString.default("100000"),
  HASH_CHAIN_LENGTH: z.coerce.number().int().positive().default(1_000_000),
  SAGA_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  SAGA_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  RMQ_DELIVERY_LIMIT_MAIN: z.coerce.number().int().positive().default(5),
  RMQ_DELIVERY_LIMIT_DLQ: z.coerce.number().int().positive().default(3),
  AUTO_CASHOUT_MAX_X: z.coerce.number().positive().default(100),
  LEADERBOARD_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  LEADERBOARD_TOP_N: z.coerce.number().int().positive().default(10),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_JWKS_URI: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1).default("account"),
  WS_PATH: z
    .string()
    .regex(/^\/.+$/, "WS_PATH must start with '/' and be non-empty")
    .default("/ws"),
});

export const env = Object.freeze(gamesEnvSchema.parse(process.env));
export type GamesEnv = typeof env;
