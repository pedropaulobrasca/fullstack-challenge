import { describe, test, expect } from "bun:test";

import {
  buildEnvelope,
  parseEnvelope,
  type EnvelopeBuildOptions,
  envelopeToAmqpHeaders,
  amqpHeadersToEnvelopeMeta,
  AMQP_HEADER_KEYS,
} from "../../src/index";

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

describe("buildEnvelope", () => {
  test("fills messageId, correlationId, version, occurredAt defaults", () => {
    const env = buildEnvelope({
      type: "wallet.debited.v1",
      payload: { amount: 100n.toString() },
      causationId: "cause-1",
    });
    expect(typeof env.messageId).toBe("string");
    expect(env.messageId.length).toBeGreaterThan(0);
    expect(env.correlationId).toBe(env.messageId);
    expect(env.version).toBe(1);
    expect(ISO_REGEX.test(env.occurredAt)).toBe(true);
    expect(env.causationId).toBe("cause-1");
    expect(env.type).toBe("wallet.debited.v1");
  });

  test("throws when causationId is missing", () => {
    expect(() =>
      buildEnvelope({
        type: "t",
        payload: {},
      } as unknown as EnvelopeBuildOptions),
    ).toThrow(/causationId/);
  });

  test("throws when causationId is empty string", () => {
    expect(() =>
      buildEnvelope({
        type: "t",
        payload: {},
        causationId: "",
      }),
    ).toThrow(/causationId/);
  });

  test("uses provided messageId when supplied", () => {
    const env = buildEnvelope({
      type: "t",
      payload: {},
      causationId: "c",
      messageId: "msg-fixed",
    });
    expect(env.messageId).toBe("msg-fixed");
  });

  test("uses provided correlationId when supplied", () => {
    const env = buildEnvelope({
      type: "t",
      payload: {},
      causationId: "c",
      messageId: "m",
      correlationId: "corr-explicit",
    });
    expect(env.correlationId).toBe("corr-explicit");
  });

  test("uses provided version when supplied", () => {
    const env = buildEnvelope({
      type: "t",
      payload: {},
      causationId: "c",
      version: 7,
    });
    expect(env.version).toBe(7);
  });

  test("serializes occurredAt as ISO-8601 string", () => {
    const fixed = new Date("2026-01-15T12:30:45.123Z");
    const env = buildEnvelope({
      type: "t",
      payload: {},
      causationId: "c",
      occurredAt: fixed,
    });
    expect(env.occurredAt).toBe(fixed.toISOString());
  });
});

describe("parseEnvelope", () => {
  test("round-trips JSON.stringify(buildEnvelope(...)) losslessly", () => {
    const original = buildEnvelope({
      type: "wallet.credited.v1",
      payload: { amount: "500", currency: "CRD" },
      causationId: "cause-xyz",
      messageId: "msg-xyz",
      correlationId: "corr-xyz",
    });
    const parsed = parseEnvelope(JSON.stringify(original));
    expect(parsed).toEqual(original);
  });

  test("round-trips when input is a Buffer", () => {
    const original = buildEnvelope({
      type: "t",
      payload: { ok: true },
      causationId: "c",
    });
    const parsed = parseEnvelope(Buffer.from(JSON.stringify(original)));
    expect(parsed).toEqual(original);
  });

  test("throws when a required field is missing", () => {
    const broken = {
      messageId: "m",
      correlationId: "c",
      causationId: "x",
      type: "t",
      version: 1,
      payload: {},
    };
    expect(() => parseEnvelope(JSON.stringify(broken))).toThrow(
      /Invalid envelope: missing occurredAt/,
    );
  });

  test("throws when a field has the wrong primitive type", () => {
    const broken = {
      messageId: "m",
      correlationId: "c",
      causationId: "x",
      type: "t",
      version: "1",
      occurredAt: new Date().toISOString(),
      payload: {},
    };
    expect(() => parseEnvelope(JSON.stringify(broken))).toThrow(
      /Invalid envelope: missing version/,
    );
  });

  test("throws when payload key is absent", () => {
    const broken = {
      messageId: "m",
      correlationId: "c",
      causationId: "x",
      type: "t",
      version: 1,
      occurredAt: new Date().toISOString(),
    };
    expect(() => parseEnvelope(JSON.stringify(broken))).toThrow(
      /Invalid envelope: missing payload/,
    );
  });
});

describe("envelopeToAmqpHeaders and amqpHeadersToEnvelopeMeta", () => {
  test("maps every envelope field to AMQP_HEADER_KEYS bidirectionally", () => {
    const env = buildEnvelope({
      type: "wallet.debited.v1",
      payload: { x: 1 },
      causationId: "cause-1",
      correlationId: "corr-1",
      messageId: "msg-1",
      version: 2,
      occurredAt: new Date("2026-02-02T02:02:02.000Z"),
    });

    const headers = envelopeToAmqpHeaders(env);
    expect(headers[AMQP_HEADER_KEYS.CORRELATION_ID]).toBe("corr-1");
    expect(headers[AMQP_HEADER_KEYS.CAUSATION_ID]).toBe("cause-1");
    expect(headers[AMQP_HEADER_KEYS.MESSAGE_ID]).toBe("msg-1");
    expect(headers[AMQP_HEADER_KEYS.EVENT_TYPE]).toBe("wallet.debited.v1");
    expect(headers[AMQP_HEADER_KEYS.EVENT_VERSION]).toBe(2);
    expect(headers[AMQP_HEADER_KEYS.OCCURRED_AT]).toBe(
      "2026-02-02T02:02:02.000Z",
    );

    const meta = amqpHeadersToEnvelopeMeta(headers);
    expect(meta.correlationId).toBe(env.correlationId);
    expect(meta.causationId).toBe(env.causationId);
    expect(meta.messageId).toBe(env.messageId);
    expect(meta.type).toBe(env.type);
    expect(meta.version).toBe(env.version);
    expect(meta.occurredAt).toBe(env.occurredAt);
  });

  test("decodes Buffer-valued headers (amqplib delivery shape)", () => {
    const env = buildEnvelope({
      type: "t",
      payload: {},
      causationId: "c",
      correlationId: "corr-buf",
      messageId: "msg-buf",
    });
    const headers: Record<string, unknown> = {
      [AMQP_HEADER_KEYS.CORRELATION_ID]: Buffer.from("corr-buf"),
      [AMQP_HEADER_KEYS.CAUSATION_ID]: Buffer.from("c"),
      [AMQP_HEADER_KEYS.MESSAGE_ID]: Buffer.from("msg-buf"),
      [AMQP_HEADER_KEYS.EVENT_TYPE]: Buffer.from(env.type),
      [AMQP_HEADER_KEYS.EVENT_VERSION]: 1,
      [AMQP_HEADER_KEYS.OCCURRED_AT]: Buffer.from(env.occurredAt),
    };
    const meta = amqpHeadersToEnvelopeMeta(headers);
    expect(meta.correlationId).toBe("corr-buf");
    expect(meta.messageId).toBe("msg-buf");
    expect(meta.type).toBe(env.type);
  });

  test("throws when required header x-message-id is missing", () => {
    const headers: Record<string, unknown> = {
      [AMQP_HEADER_KEYS.CORRELATION_ID]: "corr",
      [AMQP_HEADER_KEYS.CAUSATION_ID]: "cause",
      [AMQP_HEADER_KEYS.EVENT_TYPE]: "t",
    };
    expect(() => amqpHeadersToEnvelopeMeta(headers)).toThrow(/x-message-id/);
  });

  test("throws when header bag is missing entirely", () => {
    expect(() => amqpHeadersToEnvelopeMeta(undefined)).toThrow(/header bag/);
  });

  test("defaults version to 1 when header absent", () => {
    const headers: Record<string, unknown> = {
      [AMQP_HEADER_KEYS.CORRELATION_ID]: "corr",
      [AMQP_HEADER_KEYS.CAUSATION_ID]: "cause",
      [AMQP_HEADER_KEYS.MESSAGE_ID]: "msg",
      [AMQP_HEADER_KEYS.EVENT_TYPE]: "t",
    };
    const meta = amqpHeadersToEnvelopeMeta(headers);
    expect(meta.version).toBe(1);
  });
});
