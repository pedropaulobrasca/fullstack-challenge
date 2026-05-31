// Phase 1 defaults from REQUIREMENTS §Open Configuration Values.
// INITIAL_BALANCE_CENTS is consumed by Phase 3 wallet provisioning (REQ-WALL-03 + REQ-DOM-05).

import { sharedEnvSchema } from "@crash/shared-kernel";
import { z } from "zod";

const bigIntFromString = z
  .string()
  .regex(/^\d+$/)
  .transform((raw) => BigInt(raw));

const walletsEnvSchema = sharedEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4002),
  INITIAL_BALANCE_CENTS: bigIntFromString.default("100000"),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  RMQ_DELIVERY_LIMIT_MAIN: z.coerce.number().int().positive().default(5),
  RMQ_DELIVERY_LIMIT_DLQ: z.coerce.number().int().positive().default(3),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_JWKS_URI: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .default("http://jaeger:4318/v1/traces"),
  OTEL_SERVICE_NAME: z.string().min(1).default("wallets-service"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
});

export const env = Object.freeze(walletsEnvSchema.parse(process.env));
export type WalletsEnv = typeof env;
