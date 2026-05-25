import type { DomainEventEnvelope } from "@crash/shared-kernel/events";

export const AMQP_HEADER_KEYS = {
  CORRELATION_ID: "x-correlation-id",
  CAUSATION_ID: "x-causation-id",
  MESSAGE_ID: "x-message-id",
  EVENT_TYPE: "x-event-type",
  EVENT_VERSION: "x-event-version",
  OCCURRED_AT: "x-occurred-at",
} as const;

export function envelopeToAmqpHeaders(
  env: DomainEventEnvelope,
): Record<string, string | number> {
  return {
    [AMQP_HEADER_KEYS.CORRELATION_ID]: env.correlationId,
    [AMQP_HEADER_KEYS.CAUSATION_ID]: env.causationId,
    [AMQP_HEADER_KEYS.MESSAGE_ID]: env.messageId,
    [AMQP_HEADER_KEYS.EVENT_TYPE]: env.type,
    [AMQP_HEADER_KEYS.EVENT_VERSION]: env.version,
    [AMQP_HEADER_KEYS.OCCURRED_AT]: env.occurredAt,
  };
}

export interface EnvelopeMeta {
  correlationId: string;
  causationId: string;
  messageId: string;
  type: string;
  version: number;
  occurredAt: string;
}

function readHeaderString(
  headers: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = headers[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return String(raw);
}

export function amqpHeadersToEnvelopeMeta(
  headers: Record<string, unknown> | undefined,
): EnvelopeMeta {
  if (!headers) {
    throw new Error("Invalid AMQP headers: header bag is missing");
  }

  const correlationId = readHeaderString(headers, AMQP_HEADER_KEYS.CORRELATION_ID);
  const causationId = readHeaderString(headers, AMQP_HEADER_KEYS.CAUSATION_ID);
  const messageId = readHeaderString(headers, AMQP_HEADER_KEYS.MESSAGE_ID);
  const type = readHeaderString(headers, AMQP_HEADER_KEYS.EVENT_TYPE);

  if (!correlationId) throw new Error("Invalid AMQP headers: missing x-correlation-id");
  if (!causationId) throw new Error("Invalid AMQP headers: missing x-causation-id");
  if (!messageId) throw new Error("Invalid AMQP headers: missing x-message-id");
  if (!type) throw new Error("Invalid AMQP headers: missing x-event-type");

  const versionRaw = headers[AMQP_HEADER_KEYS.EVENT_VERSION];
  const version =
    typeof versionRaw === "number"
      ? versionRaw
      : versionRaw !== undefined && versionRaw !== null
        ? Number(versionRaw)
        : 1;

  const occurredAt =
    readHeaderString(headers, AMQP_HEADER_KEYS.OCCURRED_AT) ?? new Date().toISOString();

  return {
    correlationId,
    causationId,
    messageId,
    type,
    version: Number.isFinite(version) ? version : 1,
    occurredAt,
  };
}
