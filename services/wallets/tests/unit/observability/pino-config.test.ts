import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClsService } from "nestjs-cls";

import * as otelApi from "@opentelemetry/api";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/wallets_test";
process.env.RABBITMQ_URL ??= "amqp://test:test@localhost:5672";
process.env.NODE_ENV ??= "test";
process.env.CURRENCY_CODE ??= "CRD";
process.env.CURRENCY_BASE ??= "10";
process.env.CURRENCY_EXPONENT ??= "2";
process.env.PORT ??= "4002";
process.env.INITIAL_BALANCE_CENTS ??= "100000";
process.env.OUTBOX_POLL_INTERVAL_MS ??= "1000";
process.env.OUTBOX_POLL_BATCH_SIZE ??= "100";
process.env.RMQ_DELIVERY_LIMIT_MAIN ??= "5";
process.env.RMQ_DELIVERY_LIMIT_DLQ ??= "3";
process.env.KEYCLOAK_ISSUER ??= "http://localhost:8080/realms/crash-game-test";
process.env.KEYCLOAK_JWKS_URI ??=
  "http://localhost:8080/realms/crash-game-test/protocol/openid-connect/certs";
process.env.KEYCLOAK_AUDIENCE ??= "account";

import { buildPinoOptions } from "../../../src/observability/pino-config";

type SpanContextShape = { traceId: string; spanId: string };

function clsStub(value: string | undefined): ClsService {
  return {
    get: (_key: string) => value,
  } as unknown as ClsService;
}

function fakeActiveSpan(ctx: SpanContextShape | undefined) {
  if (!ctx) return undefined;
  return { spanContext: () => ctx } as unknown as otelApi.Span;
}

const originalGetActiveSpan = otelApi.trace.getActiveSpan;
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = "development";
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  (otelApi.trace as { getActiveSpan: typeof originalGetActiveSpan }).getActiveSpan =
    originalGetActiveSpan;
});

describe("buildPinoOptions.customProps", () => {
  test("returns traceId + spanId + correlationId when both present", () => {
    (otelApi.trace as { getActiveSpan: () => otelApi.Span | undefined }).getActiveSpan =
      mock(() => fakeActiveSpan({ traceId: "abc123", spanId: "def456" }));
    const opts = buildPinoOptions(clsStub("corr-xyz"));
    const props = opts.customProps?.({} as never, {} as never);
    expect(props).toEqual({
      traceId: "abc123",
      spanId: "def456",
      correlationId: "corr-xyz",
    });
  });

  test("returns nulls when no active span and no correlationId, does not throw", () => {
    (otelApi.trace as { getActiveSpan: () => otelApi.Span | undefined }).getActiveSpan =
      mock(() => undefined);
    const opts = buildPinoOptions(clsStub(undefined));
    expect(() => opts.customProps?.({} as never, {} as never)).not.toThrow();
    const props = opts.customProps?.({} as never, {} as never);
    expect(props).toEqual({
      traceId: null,
      spanId: null,
      correlationId: null,
    });
  });
});

describe("buildPinoOptions.transport (Pitfall 2 — no pino-pretty in production)", () => {
  test("transport is pino-pretty in non-production", () => {
    process.env.NODE_ENV = "development";
    const opts = buildPinoOptions(clsStub(undefined));
    expect(opts.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });

  test("transport is undefined in production", () => {
    process.env.NODE_ENV = "production";
    const opts = buildPinoOptions(clsStub(undefined));
    expect(opts.transport).toBeUndefined();
  });
});

describe("buildPinoOptions.redact (Security V5 — no auth tokens in logs)", () => {
  test("redacts req.headers.authorization and req.headers.cookie", () => {
    const opts = buildPinoOptions(clsStub(undefined));
    const redact = opts.redact;
    expect(redact).toBeDefined();
    const paths = Array.isArray(redact)
      ? redact
      : (redact as { paths: string[] }).paths;
    expect(paths).toContain("req.headers.authorization");
    expect(paths).toContain("req.headers.cookie");
  });
});
