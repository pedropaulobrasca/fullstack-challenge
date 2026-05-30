import { z } from "zod";

const replaySpeedsSchema = z
  .string()
  .optional()
  .default("1,2,4")
  .transform((raw) => raw.split(",").map((token) => Number(token.trim())))
  .pipe(z.array(z.number().positive().finite()).nonempty());

const replayAutostartSchema = z
  .string()
  .optional()
  .default("true")
  .transform((raw) => raw === "true")
  .pipe(z.boolean());

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
  VITE_REPLAY_SPEEDS: replaySpeedsSchema,
  VITE_REPLAY_AUTOSTART: replayAutostartSchema,
  VITE_DRAWER_SLIDE_MS: z.coerce.number().int().positive().default(220),
  VITE_INSTANT_CRASH_BUCKET: z.coerce.number().int().positive().default(101),
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
  replay: Readonly<{ speeds: readonly number[]; autostart: boolean }>;
  drawer: Readonly<{ slideMs: number }>;
  fairness: Readonly<{ instantCrashBucket: number }>;
}>;

export function buildConfig(env: ParsedConfig): AppConfig {
  if (!env.VITE_REPLAY_SPEEDS.includes(1)) {
    throw new Error(
      "VITE_REPLAY_SPEEDS must include 1 (default 1x speed per D-03 / UI-SPEC)",
    );
  }
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
    replay: Object.freeze({
      speeds: Object.freeze([...env.VITE_REPLAY_SPEEDS]),
      autostart: env.VITE_REPLAY_AUTOSTART,
    }),
    drawer: Object.freeze({ slideMs: env.VITE_DRAWER_SLIDE_MS }),
    fairness: Object.freeze({ instantCrashBucket: env.VITE_INSTANT_CRASH_BUCKET }),
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
