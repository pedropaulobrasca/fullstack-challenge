---
phase: 02-outbox-inbox-spine
plan: 05
subsystem: consume side — inbox dedup, idempotent-subscribe decorator, dead-letter consumer
tags: [inbox, idempotent-subscribe, dead-letter, decorator, cls, amqp, golevelup, mikro-orm]
requires:
  - "P2.2 InboxMessage / DeadLetterMessage entities and DDL"
  - "P2.3 envelope/topology/CLS contracts (amqpHeadersToEnvelopeMeta, buildQuorumArgs, deriveDlxFromExchange, CORRELATION_ID_KEY)"
provides:
  - "InboxRepository.tryClaim — atomic INSERT ... ON CONFLICT DO NOTHING RETURNING"
  - "@IdempotentSubscribe(opts) — method decorator wrapping @RabbitSubscribe with same-TX inbox dedup + CLS propagation"
  - "CONSUMER_NAME_META reflect token for plan 02-09 integration tests"
  - "DeadLetterRepository.persist with UNIQUE-based idempotency"
  - "DeadLetterConsumer base class — concrete subclasses bind to a DLQ via @RabbitSubscribe in P2.7"
affects:
  - "P2.6 (MessagingSpineModule will register InboxRepository + DeadLetterRepository as providers)"
  - "P2.7 (concrete service consumers extend DeadLetterConsumer and wear @IdempotentSubscribe)"
  - "P2.9 (integration tests assert handler called exactly once on broker redelivery)"
tech-stack:
  added: []
  patterns:
    - "Decorator factory composes @RabbitSubscribe: replaces descriptor.value first, then forwards to RabbitSubscribe for binding"
    - "Same-TX dedup: cls.run wraps em.transactional wraps tryClaim → handler → markProcessed"
    - "Runtime host-shape assertion catches missing injected fields with a descriptive error"
    - "DLQ persist always acks — even on DB failure — to break the poison loop"
    - "Optional-property spreading to satisfy exactOptionalPropertyTypes (errorClass omitted when absent rather than set to undefined)"
key-files:
  created:
    - packages/messaging-spine/src/inbox/inbox-repository.ts
    - packages/messaging-spine/src/inbox/consumer-name.token.ts
    - packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts
    - packages/messaging-spine/src/dead-letter/dead-letter-repository.ts
    - packages/messaging-spine/src/dead-letter/dead-letter-consumer.service.ts
    - .planning/phases/02-outbox-inbox-spine/02-05-SUMMARY.md
  modified:
    - packages/messaging-spine/src/index.ts (barrel re-exports the five new consume-side surfaces)
decisions:
  - "Runtime host-shape assertion preferred over a host interface — the decorator is applied at class definition time but the host fields are injected at runtime, so a TypeScript-only check would not catch the real failure mode (forgotten constructor injection). The assertion throws on the first invocation with a list of missing fields, making the contract self-documenting."
  - "Field names em / cls / inbox / logger are hard-coded literals matched by property lookup. Renaming on the host class is a runtime contract break — documented in JSDoc above the export."
  - "Decorator stacking order enforced internally: descriptor.value is replaced first, then RabbitSubscribe is applied to the replaced descriptor. Stacking @RabbitSubscribe externally would bind the original (un-wrapped) handler — verified by the integration test in plan 02-09."
  - "deliveryLimit defaults to 5 inline rather than reading MESSAGING_OPTIONS at apply time — decorators run at module load and the options token is not yet resolvable. Callers needing a non-default value pass deliveryLimit explicitly."
  - "DeadLetterConsumer always returns undefined (ack) even when repo.persist throws — the DLQ has its own x-delivery-limit=3 as a final safety net for repeated DB outages, but the common case (transient persist error) must NOT requeue the dead-lettered message back to itself."
metrics:
  duration_minutes: 9
  tasks_completed: 3
  files_created: 5
  files_modified: 1
  commits: 3
completed: 2026-05-24
---

# Phase 2 Plan 5: Inbox Dedup + IdempotentSubscribe + DeadLetterConsumer Summary

The consume side of the messaging spine: a tiny InboxRepository that performs
the canonical atomic dedup claim, the `@IdempotentSubscribe` decorator that
every service AMQP handler will wear, and the DeadLetterConsumer base class
that catches messages exhausting the main-queue delivery limit.

REQ-WALL-05 (exactly-once command processing) is now structurally enforced
through the decorator's same-TX pipeline. REQ-SAGA-05 (DLQ → dead_letter_messages
table) lands through DeadLetterConsumer + DeadLetterRepository. REQ-SAGA-06
(correlationId/causationId propagation on the consume side) lands through the
decorator's CLS bridge that hydrates the scope from `x-correlation-id` /
`x-causation-id` AMQP headers before the user handler runs.

---

## Decorator composition order

`@IdempotentSubscribe` is a single decorator that performs two distinct jobs:

1. **Replace `descriptor.value`** with a wrapper that does
   `cls.run` → `em.transactional` → `inbox.tryClaim` → (skip if duplicate) →
   call original → `inbox.markProcessed`.
2. **Apply `@RabbitSubscribe`** to the **replaced** descriptor so the queue
   declaration (quorum + DLX inline via `buildQuorumArgs` +
   `deriveDlxFromExchange`) and the broker subscription bind to the wrapper,
   not the bare user method.

Stacking these in user code as `@RabbitSubscribe(...)` over
`@IdempotentSubscribe(...)` would bind RabbitMQ to the wrapped handler but
leave the queue declaration in user hands, defeating the topology guarantee.
Always use `@IdempotentSubscribe` alone — never combine with `@RabbitSubscribe`.

---

## Host-class contract

The class carrying a `@IdempotentSubscribe`-decorated method **must** inject:

| Field    | Type             | From                            | Purpose                                  |
| -------- | ---------------- | ------------------------------- | ---------------------------------------- |
| `em`     | `EntityManager`  | `@mikro-orm/postgresql`         | Opens the transaction wrapping the handler |
| `cls`    | `ClsService`     | `nestjs-cls`                    | Hydrates correlation/causation context   |
| `inbox`  | `InboxRepository`| `@crash/messaging-spine`        | Performs the atomic dedup claim          |
| `logger` | `Logger`         | `@nestjs/common` (optional)     | Structured error logging                 |

Field **names** are matched by literal property lookup. Renaming any of the
three required fields breaks the decorator at runtime — the assertion fires
on the first message delivery and throws:

```
@IdempotentSubscribe(<consumerName>): host class is missing required injected
fields: <list>. Declare `em: EntityManager`, `cls: ClsService`, `inbox: InboxRepository`
(and optionally `logger: Logger`) on the consumer class.
```

This is the CONCERN-03 fix from research review — a TypeScript-only check
would be defeated by `as any` and would not catch the typical mistake
(forgotten constructor parameter).

---

## Nack semantics

Per `@golevelup/nestjs-rabbitmq`, the handler controls ack/nack via return
value, **not** by calling `channel.ack` / `channel.nack` directly:

| Return value          | Broker action                                            | When we use it                                |
| --------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `undefined`           | ack                                                      | Success path, AND duplicate-detected path     |
| `new Nack(false)`     | drop — routed to DLX by the bound `x-dead-letter-exchange` | Envelope-header parse failure; handler throw  |
| `new Nack(true)`      | requeue                                                  | Never — DLX is the canonical compensation path |

Requeue is deliberately never used. A handler that throws transiently and
deserves a retry will get redelivery via the main queue's
`x-delivery-limit=5`; once exhausted, the broker DLX-routes the message and
the operator decides whether to replay from `dead_letter_messages`.

---

## DLQ behaviour

`DeadLetterConsumer` parses the AMQP `x-death` header to recover the original
routing metadata:

| `x-death[0]` field   | Mapped to `DeadLetterRecord`     | Fallback                          |
| -------------------- | -------------------------------- | --------------------------------- |
| `queue`              | `originalQueue`                  | `msg.fields.routingKey` → `'unknown'` |
| `exchange`           | `originalExchange`               | `msg.fields.exchange` → `'unknown'`   |
| `routing-keys[0]`    | `originalRoutingKey`             | `msg.fields.routingKey` → `''`    |
| `count`              | `redeliveryCount`                | `1`                               |

Plus `headers['x-first-death-reason']` → `errorClass` (when string).

The handler **always returns `undefined` (ack)** — even when `repo.persist`
throws. Persist failure is logged at `error` level so operators see it, but
the message must NOT be requeued back to the DLQ that just delivered it. The
DLQ's own `x-delivery-limit=3` (declared in P2.7 on each concrete consumer)
is the final safety net for repeated DB outages: after three attempts the
broker drops the message entirely.

---

## Subclass pattern for plan 02-07

Concrete services extend `DeadLetterConsumer` and add `@RabbitSubscribe`
themselves — the base class deliberately does **not** wear it, because the
exchange/queue names differ per service:

```ts
@Injectable()
export class WalletDeadLetterConsumer extends DeadLetterConsumer {
  protected readonly consumerName = "wallet.dlq.persist";

  @RabbitSubscribe({
    exchange: EXCHANGES.WALLET_DLX,
    routingKey: "",
    queue: QUEUES.WALLET_DLQ,
    queueOptions: {
      durable: true,
      arguments: buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_DLQ),
    },
  })
  handle(rawPayload: unknown, msg: ConsumeMessage) {
    return this.handleDeadLetter(rawPayload, msg);
  }
}
```

Note `buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_DLQ)` is called **without** a
DLX argument — the DLQ has no further dead-letter destination; it terminates
the chain.

---

## Public exports (barrel)

Added to `packages/messaging-spine/src/index.ts`:

- `InboxRepository`
- `IdempotentSubscribe`, type `IdempotentSubscribeOptions`
- `CONSUMER_NAME_META`
- `DeadLetterRepository`, type `DeadLetterRecord`
- `DeadLetterConsumer`

---

## Verification

| Criterion                                                                              | Result |
| -------------------------------------------------------------------------------------- | ------ |
| `bun run typecheck` in messaging-spine                                                 | PASS (0 errors) |
| `grep "ON CONFLICT (consumer_name, message_id) DO NOTHING" src/inbox/inbox-repository.ts` | PASS  |
| `grep "RETURNING message_id" src/inbox/inbox-repository.ts`                            | PASS  |
| `grep "buildQuorumArgs" src/inbox/idempotent-subscribe.decorator.ts`                   | PASS (2 hits — opts default + queueOptions) |
| `grep "deriveDlxFromExchange" src/inbox/idempotent-subscribe.decorator.ts`             | PASS  |
| `grep "cls.run" src/inbox/idempotent-subscribe.decorator.ts`                           | PASS  |
| `grep "em.transactional" src/inbox/idempotent-subscribe.decorator.ts`                  | PASS  |
| `grep "tryClaim" src/inbox/idempotent-subscribe.decorator.ts`                          | PASS  |
| `grep "amqpHeadersToEnvelopeMeta" src/inbox/idempotent-subscribe.decorator.ts`         | PASS  |
| `grep "new Nack"` returns 3 hits (envelope parse, host-shape no-op, handler throw)     | PASS  |
| No direct `channel.ack` / `channel.nack` calls in any new file                         | PASS (one comment match, no call sites) |
| `grep "ON CONFLICT (consumer_name, original_message_id) DO NOTHING" src/dead-letter/dead-letter-repository.ts` | PASS |
| `grep "x-death" src/dead-letter/dead-letter-consumer.service.ts`                       | PASS  |
| `grep "abstract get consumerName" src/dead-letter/dead-letter-consumer.service.ts`     | PASS  |
| Runtime barrel import resolves `IdempotentSubscribe`, `InboxRepository`, `DeadLetterRepository`, `DeadLetterConsumer`, `CONSUMER_NAME_META === 'messaging-spine:consumer-name'` | PASS |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Adapted DeadLetterRecord construction to `exactOptionalPropertyTypes`**
- **Found during:** Task 3 typecheck (TS2375)
- **Issue:** Setting `errorClass: undefined` and `errorMessage: undefined` literal-style fails under `exactOptionalPropertyTypes: true` because the field type is `string` (optional via `?`) not `string | undefined`.
- **Fix:** Spread the `errorClass` field conditionally — `...(typeof firstDeathReason === "string" ? { errorClass: firstDeathReason } : {})` — and drop the explicit `errorMessage: undefined` (the field is simply absent when not set). Same record shape, satisfies the strict-optional rule.
- **Files modified:** `packages/messaging-spine/src/dead-letter/dead-letter-consumer.service.ts`
- **Commit:** `7fbc0fd`

### Adjusted from plan text

- Plan action body specified `errorClass: headers['x-first-death-reason'] as string | undefined` and `errorMessage: undefined`. Under the project's strict tsconfig those literal-undefined assignments fail. The adjustment above preserves semantics (errorClass omitted when no string reason header is present).
- Logger is read off the host via `host.logger?.error(...)` — the optional chaining matches the JSDoc contract that `logger` is the only non-required injected field. The decorator never depends on logger being present.

---

## Authentication gates

None. Plan was offline-only (file authoring + tsc + runtime barrel resolution).

---

## Deferred Issues

None remaining. An earlier transient TS error in `src/outbox/outbox-listener.service.ts` (P2.4 territory — the parallel wave) cleared by the time the final verification ran; the P2.4 worker resolved it concurrently.

---

## Threat Flags

(None — every artefact in this plan implements a mitigation already enumerated
in `<threat_model>`. T-02-14, T-02-15, T-02-16, T-02-17, T-02-18 are all
addressed structurally.)

---

## Commits

| Commit    | Task   | Description                                              |
| --------- | ------ | -------------------------------------------------------- |
| `30061f1` | Task 1 | InboxRepository.tryClaim + markProcessed + CONSUMER_NAME_META |
| `c5aed19` | Task 2 | @IdempotentSubscribe decorator with same-TX inbox dedup  |
| `7fbc0fd` | Task 3 | DeadLetterRepository + DeadLetterConsumer + barrel updates |

---

## Self-Check: PASSED

Files exist:
- `packages/messaging-spine/src/inbox/inbox-repository.ts` — FOUND
- `packages/messaging-spine/src/inbox/consumer-name.token.ts` — FOUND
- `packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts` — FOUND
- `packages/messaging-spine/src/dead-letter/dead-letter-repository.ts` — FOUND
- `packages/messaging-spine/src/dead-letter/dead-letter-consumer.service.ts` — FOUND
- `packages/messaging-spine/src/index.ts` — FOUND (modified)

Commits exist:
- `30061f1` (Task 1) — FOUND
- `c5aed19` (Task 2) — FOUND
- `7fbc0fd` (Task 3) — FOUND
