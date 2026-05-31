import { trace } from "@opentelemetry/api";
import type { Params } from "nestjs-pino";
import type { ClsService } from "nestjs-cls";

import { env } from "../config/defaults";

type PinoHttpOptions = Extract<
  NonNullable<Params["pinoHttp"]>,
  { customProps?: unknown }
>;

export function buildPinoOptions(cls: ClsService): PinoHttpOptions {
  const isProd = process.env.NODE_ENV === "production";
  const base: PinoHttpOptions = {
    level: env.LOG_LEVEL,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    customProps: () => {
      const spanContext = trace.getActiveSpan()?.spanContext();
      return {
        traceId: spanContext?.traceId ?? null,
        spanId: spanContext?.spanId ?? null,
        correlationId: cls.get<string>("correlationId") ?? null,
      };
    },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      remove: true,
    },
  };
  if (!isProd) {
    base.transport = { target: "pino-pretty", options: { colorize: true } };
  }
  return base;
}
