import { describe, expect, test } from "bun:test";
import { sharedEnvSchema } from "../src/config/env-schema";

describe("sharedEnvSchema", () => {
  test("parses a minimally valid env with defaults applied", () => {
    const parsed = sharedEnvSchema.parse({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://x:y@h:5432/d",
      RABBITMQ_URL: "amqp://x:y@h:5672",
    });

    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.CURRENCY_CODE).toBe("CRD");
    expect(parsed.CURRENCY_BASE).toBe(10);
    expect(parsed.CURRENCY_EXPONENT).toBe(2);
  });

  test("rejects empty env (DATABASE_URL and RABBITMQ_URL required)", () => {
    expect(() => sharedEnvSchema.parse({})).toThrow();
  });

  test("rejects malformed DATABASE_URL", () => {
    expect(() =>
      sharedEnvSchema.parse({
        NODE_ENV: "production",
        DATABASE_URL: "not-a-url",
        RABBITMQ_URL: "amqp://x:y@h:5672",
      }),
    ).toThrow();
  });

  test("rejects NODE_ENV outside the development|test|production enum", () => {
    expect(() =>
      sharedEnvSchema.parse({
        NODE_ENV: "staging",
        DATABASE_URL: "postgresql://x:y@h:5432/d",
        RABBITMQ_URL: "amqp://x:y@h:5672",
      }),
    ).toThrow();
  });

  test("coerces numeric env strings into numbers", () => {
    const parsed = sharedEnvSchema.parse({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://x:y@h:5432/d",
      RABBITMQ_URL: "amqp://x:y@h:5672",
      CURRENCY_BASE: "10",
    });

    expect(parsed.CURRENCY_BASE).toBe(10);
    expect(typeof parsed.CURRENCY_BASE).toBe("number");
  });
});
