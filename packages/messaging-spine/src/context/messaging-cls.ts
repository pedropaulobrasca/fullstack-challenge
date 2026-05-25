import { type DynamicModule, Module } from "@nestjs/common";
import { ClsModule, type ClsService } from "nestjs-cls";

import { CAUSATION_ID_KEY, CORRELATION_ID_KEY } from "./correlation-tokens";

function readIncomingCorrelationId(req: {
  headers?: Record<string, unknown>;
}): string | undefined {
  const headers = req.headers ?? {};
  const candidates = [headers["x-correlation-id"], headers["x-request-id"]];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

@Module({})
export class MessagingClsModule {
  static forRoot(): DynamicModule {
    return {
      module: MessagingClsModule,
      imports: [
        ClsModule.forRoot({
          global: true,
          middleware: {
            mount: true,
            generateId: true,
            idGenerator: () => crypto.randomUUID(),
            setup: (cls, req) => {
              const incoming = readIncomingCorrelationId(req);
              cls.set(CORRELATION_ID_KEY, incoming ?? cls.getId());
            },
          },
        }),
      ],
      exports: [ClsModule],
    };
  }
}

export async function withMessagingContext<T>(
  cls: ClsService,
  ctx: { correlationId: string; causationId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return cls.run(async () => {
    cls.set(CORRELATION_ID_KEY, ctx.correlationId);
    if (ctx.causationId) cls.set(CAUSATION_ID_KEY, ctx.causationId);
    return fn();
  });
}
