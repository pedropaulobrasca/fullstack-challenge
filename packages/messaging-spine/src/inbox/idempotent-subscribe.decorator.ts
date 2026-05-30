import { Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { Nack, RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import type { ClsService } from "nestjs-cls";
import type { ConsumeMessage } from "amqplib";

import { amqpHeadersToEnvelopeMeta } from "../envelope/envelope-headers";
import {
  CAUSATION_ID_KEY,
  CORRELATION_ID_KEY,
} from "../context/correlation-tokens";
import {
  buildQuorumArgs,
  deriveDlxFromExchange,
} from "../topology/topology-defaults";
import { CONSUMER_NAME_META } from "./consumer-name.token";
import type { InboxRepository } from "./inbox-repository";

export interface IdempotentSubscribeOptions {
  consumerName: string;
  exchange: string;
  routingKey: string | string[];
  queue: string;
  deliveryLimit?: number;
}

interface IdempotentSubscribeHost {
  em: EntityManager;
  cls: ClsService;
  inbox: InboxRepository;
  logger?: Logger;
}

const REQUIRED_HOST_FIELDS: ReadonlyArray<keyof IdempotentSubscribeHost> = [
  "em",
  "cls",
  "inbox",
];

function assertHostShape(
  host: unknown,
  consumerName: string,
): asserts host is IdempotentSubscribeHost {
  if (!host || typeof host !== "object") {
    throw new Error(
      `@IdempotentSubscribe(${consumerName}): handler invoked without a class instance — decorator only applies to methods of a NestJS provider class`,
    );
  }
  const candidate = host as Record<string, unknown>;
  const missing = REQUIRED_HOST_FIELDS.filter((field) => candidate[field] == null);
  if (missing.length > 0) {
    throw new Error(
      `@IdempotentSubscribe(${consumerName}): host class is missing required injected fields: ${missing.join(", ")}. Declare \`em: EntityManager\`, \`cls: ClsService\`, \`inbox: InboxRepository\` (and optionally \`logger: Logger\`) on the consumer class.`,
    );
  }
}

/**
 * Wraps `@RabbitSubscribe` with the canonical inbox-dedup + CLS-propagation
 * pipeline that every Phase 2+ AMQP consumer must wear.
 *
 * Host-class contract — the class carrying the decorated method MUST inject:
 *   - `em: EntityManager`           (from `@mikro-orm/postgresql`)
 *   - `cls: ClsService`             (from `nestjs-cls`)
 *   - `inbox: InboxRepository`      (from this package)
 *   - `logger?: Logger`             (optional, from `@nestjs/common`)
 *
 * Field names are matched by literal property lookup; renaming any of the
 * three required fields breaks the decorator at runtime.
 *
 * Handler signature delivered to the wrapped method:
 *   `(envelope, msg, txEm) => undefined | Nack`
 *
 *   - `envelope.payload` is the original publisher payload (one hop). The
 *     decorator unwraps the wire-level envelope so handlers never have to
 *     walk `envelope.payload.payload.x` — this resolves OI-1 from Phase 2.
 *   - `txEm` is the MikroORM `EntityManager` bound to the open transaction
 *     opened around inbox dedupe. Use it for entity persistence inside the
 *     handler; do not use `host.em` which is the root EM and will not flush
 *     deterministically inside this TX. This resolves OI-3 from Phase 2.
 *
 * Per @golevelup/nestjs-rabbitmq, ack/nack is controlled by the handler's
 * return value — return `undefined` to ack, return `new Nack(false)` to drop
 * to the DLX. We never call `channel.ack`/`channel.nack` directly.
 */
export function IdempotentSubscribe(
  opts: IdempotentSubscribeOptions,
): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    if (typeof original !== "function") {
      throw new Error(
        `@IdempotentSubscribe(${opts.consumerName}) can only decorate methods`,
      );
    }

    Reflect.defineMetadata(CONSUMER_NAME_META, opts.consumerName, target, propertyKey);

    descriptor.value = async function decorated(
      this: unknown,
      rawPayload: unknown,
      msg: ConsumeMessage,
    ): Promise<undefined | Nack> {
      assertHostShape(this, opts.consumerName);
      const host = this;

      const headers = (msg?.properties?.headers ?? {}) as Record<string, unknown>;
      let meta;
      try {
        meta = amqpHeadersToEnvelopeMeta(headers);
      } catch (err) {
        host.logger?.error(
          `[${opts.consumerName}] envelope headers invalid — dropping to DLX`,
          err as Error,
        );
        return new Nack(false);
      }

      return host.cls.run(async () => {
        host.cls.set(CORRELATION_ID_KEY, meta.correlationId);
        host.cls.set(CAUSATION_ID_KEY, meta.causationId);

        try {
          await host.em.transactional(async (txEm) => {
            const claimed = await host.inbox.tryClaim(
              opts.consumerName,
              meta.messageId,
              meta.type,
            );
            if (!claimed) return;

            const wirePayload =
              rawPayload &&
              typeof rawPayload === "object" &&
              "payload" in (rawPayload as object)
                ? (rawPayload as { payload: unknown }).payload
                : rawPayload;

            const envelope = {
              messageId: meta.messageId,
              correlationId: meta.correlationId,
              causationId: meta.causationId,
              type: meta.type,
              version: meta.version,
              occurredAt: meta.occurredAt,
              payload: wirePayload,
            };

            await original.call(host, envelope, msg, txEm);
            await host.inbox.markProcessed(opts.consumerName, meta.messageId);
          });
          return undefined;
        } catch (err) {
          host.logger?.error(
            `[${opts.consumerName}] handler threw — routing to DLX (requeue=false)`,
            err as Error,
          );
          return new Nack(false);
        }
      });
    };

    const subscribe = RabbitSubscribe({
      exchange: opts.exchange,
      routingKey: opts.routingKey,
      queue: opts.queue,
      queueOptions: {
        durable: true,
        arguments: buildQuorumArgs(
          opts.deliveryLimit ?? 5,
          deriveDlxFromExchange(opts.exchange),
        ),
      },
    });

    return subscribe(target, propertyKey, descriptor);
  };
}
