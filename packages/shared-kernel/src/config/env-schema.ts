import { z } from "zod";

export const sharedEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  CURRENCY_CODE: z.string().min(1).default("CRD"),
  CURRENCY_BASE: z.coerce.number().int().positive().default(10),
  CURRENCY_EXPONENT: z.coerce.number().int().nonnegative().default(2),
});

export type SharedEnv = z.infer<typeof sharedEnvSchema>;
