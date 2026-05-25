import type { DomainEventEnvelope } from "@crash/shared-kernel/events";

export interface EnvelopeBuildOptions {
  type: string;
  version?: number;
  payload: unknown;
  correlationId?: string;
  causationId: string;
  occurredAt?: Date;
  messageId?: string;
}

export function buildEnvelope<TPayload>(
  opts: EnvelopeBuildOptions,
): DomainEventEnvelope<TPayload> {
  if (!opts.causationId) {
    throw new Error(
      "causationId is required — pass the upstream messageId or, for flow-origin events, the same value as messageId",
    );
  }

  const messageId = opts.messageId ?? crypto.randomUUID();
  const correlationId = opts.correlationId ?? messageId;
  const occurredAt = (opts.occurredAt ?? new Date()).toISOString();
  const version = opts.version ?? 1;

  return {
    messageId,
    correlationId,
    causationId: opts.causationId,
    type: opts.type,
    version,
    occurredAt,
    payload: opts.payload as TPayload,
  };
}

const REQUIRED_FIELDS: ReadonlyArray<{
  key: keyof DomainEventEnvelope;
  kind: "string" | "number";
}> = [
  { key: "messageId", kind: "string" },
  { key: "correlationId", kind: "string" },
  { key: "causationId", kind: "string" },
  { key: "type", kind: "string" },
  { key: "version", kind: "number" },
  { key: "occurredAt", kind: "string" },
];

export function parseEnvelope<TPayload = unknown>(
  raw: string | Buffer,
): DomainEventEnvelope<TPayload> {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const parsed = JSON.parse(text) as Record<string, unknown>;

  for (const { key, kind } of REQUIRED_FIELDS) {
    const value = parsed[key];
    if (value === undefined || value === null) {
      throw new Error(`Invalid envelope: missing ${key}`);
    }
    if (typeof value !== kind) {
      throw new Error(`Invalid envelope: missing ${key}`);
    }
  }

  if (!("payload" in parsed)) {
    throw new Error("Invalid envelope: missing payload");
  }

  return parsed as unknown as DomainEventEnvelope<TPayload>;
}
