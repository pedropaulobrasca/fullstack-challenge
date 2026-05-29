import { z } from "zod";

export const configSchema = z.object({
  VITE_KEYCLOAK_ISSUER: z.string().url(),
  VITE_KEYCLOAK_CLIENT_ID: z.string().min(1),
  VITE_WS_URL: z.string().url(),
  VITE_REST_BASE: z.string().url(),
  VITE_GROWTH_RATE: z.coerce.number().positive(),
  VITE_EWMA_ALPHA: z.coerce.number().min(0).max(1),
  VITE_HISTORY_RED_MAX_X: z.coerce.number().positive(),
  VITE_HISTORY_YELLOW_MAX_X: z.coerce.number().positive(),
  VITE_BET_MIN_CENTS: z.coerce.number().int().nonnegative(),
  VITE_BET_MAX_CENTS: z.coerce.number().int().positive(),
  VITE_CURRENCY_CODE: z.string().min(1),
  VITE_FEED_BUFFER_SIZE: z.coerce.number().int().positive(),
  VITE_HISTORY_SIZE: z.coerce.number().int().positive(),
});

export type RawConfig = z.input<typeof configSchema>;

export type ParsedConfig = z.infer<typeof configSchema>;

export type AppConfig = Readonly<{
  keycloak: Readonly<{ issuer: string; clientId: string }>;
  ws: Readonly<{ url: string }>;
  rest: Readonly<{ base: string }>;
  growthRate: number;
  ewmaAlpha: number;
  history: Readonly<{ redMaxX: number; yellowMaxX: number }>;
  // eslint-disable-next-line @crash/no-number-for-money -- raw integer cents parsed from env, never a Money value; wrapped in Money.of(BigInt(...)) at the only consumer (features/bet/bet-amount.ts)
  bet: Readonly<{ minCents: number; maxCents: number }>;
  currencyCode: string;
  feedBufferSize: number;
  historySize: number;
}>;

export function buildConfig(env: ParsedConfig): AppConfig {
  return Object.freeze({
    keycloak: Object.freeze({
      issuer: env.VITE_KEYCLOAK_ISSUER,
      clientId: env.VITE_KEYCLOAK_CLIENT_ID,
    }),
    ws: Object.freeze({ url: env.VITE_WS_URL }),
    rest: Object.freeze({ base: env.VITE_REST_BASE }),
    growthRate: env.VITE_GROWTH_RATE,
    ewmaAlpha: env.VITE_EWMA_ALPHA,
    history: Object.freeze({
      redMaxX: env.VITE_HISTORY_RED_MAX_X,
      yellowMaxX: env.VITE_HISTORY_YELLOW_MAX_X,
    }),
    bet: Object.freeze({
      minCents: env.VITE_BET_MIN_CENTS,
      maxCents: env.VITE_BET_MAX_CENTS,
    }),
    currencyCode: env.VITE_CURRENCY_CODE,
    feedBufferSize: env.VITE_FEED_BUFFER_SIZE,
    historySize: env.VITE_HISTORY_SIZE,
  });
}

export function parseConfig(env: unknown): AppConfig {
  return buildConfig(configSchema.parse(env));
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= parseConfig(import.meta.env);
  return cached;
}
