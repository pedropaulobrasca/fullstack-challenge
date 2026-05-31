import { setupGamesTestEnv } from "../../setup";
setupGamesTestEnv();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ClsService } from "nestjs-cls";

import * as otelApi from "@opentelemetry/api";

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
const originalPinoPretty = process.env.PINO_PRETTY;

beforeEach(() => {
  process.env.NODE_ENV = "development";
  delete process.env.PINO_PRETTY;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalPinoPretty === undefined) {
    delete process.env.PINO_PRETTY;
  } else {
    process.env.PINO_PRETTY = originalPinoPretty;
  }
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
  test("transport is pino-pretty in non-production when PINO_PRETTY=1", () => {
    process.env.NODE_ENV = "development";
    process.env.PINO_PRETTY = "1";
    const opts = buildPinoOptions(clsStub(undefined));
    expect(opts.transport).toEqual({
      target: "pino-pretty",
      options: { colorize: true },
    });
  });

  test("transport is undefined in non-production when PINO_PRETTY is unset", () => {
    process.env.NODE_ENV = "development";
    const opts = buildPinoOptions(clsStub(undefined));
    expect(opts.transport).toBeUndefined();
  });

  test("transport is undefined in production even when PINO_PRETTY=1", () => {
    process.env.NODE_ENV = "production";
    process.env.PINO_PRETTY = "1";
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
