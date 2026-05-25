---
phase: 02-outbox-inbox-spine
plan: 06
subsystem: messaging spine composition — TopologyBootstrap + MessagingSpineModule
tags: [nestjs, dynamic-module, topology, rabbitmq, mikro-orm, golevelup, composition]
requires:
  - "P2.3 buildQuorumArgs + TopologyConfig + MessagingClsModule.forRoot"
  - "P2.4 MESSAGING_OPTIONS, OutboxRepository, OutboxListenerService, OutboxPublisher"
  - "P2.5 InboxRepository, DeadLetterRepository, DeadLetterConsumer, IdempotentSubscribe"
  - "P2.2 OutboxMessage/InboxMessage/DeadLetterMessage EntitySchemas"
  - "@golevelup/nestjs-rabbitmq ^9.0.2 (RabbitMQModule.forRootAsync, AmqpConnection)"
  - "@mikro-orm/nestjs ^7.0.2 (MikroOrmModule.forFeature with EntitySchema)"
provides:
  - "TopologyBootstrap @Injectable — asserts every exchange/queue/binding at OnApplicationBootstrap with quorum + DLX wiring"
  - "MessagingSpineModule.forRootAsync(opts) — single DynamicModule wiring CLS + Rabbit + MikroORM entities + every messaging-spine provider"
  - "MessagingSpineModuleAsyncOptions interface — { imports?, useFactory, inject? }"
affects:
  - "P2.7 service wiring will call MessagingSpineModule.forRootAsync from services/wallets and services/games AppModule"
  - "P2.9 integration tests will reuse the same module against testcontainers"
  - "Phase 3 wallet handlers will inject the repositories exported here"
  - "Phase 4 round loop will inject OutboxRepository to publish round events"
tech-stack:
  added: []
  patterns:
    - "DynamicModule with forRootAsync(useFactory + inject) — caller's env layer feeds MESSAGING_OPTIONS without leaking into the spine"
    - "Imports order: CLS first (global), Rabbit second (AmqpConnection ready for TopologyBootstrap), MikroORM forFeature last (concrete entities)"
    - "One-shot AMQP channel for topology assertion (createChannel, NOT createConfirmChannel) — declarations are idempotent and don't benefit from confirms"
    - "OnApplicationBootstrap (not onModuleInit) so MikroORM is fully initialised when TopologyBootstrap runs — closes Pitfall 5"
    - "Re-export MikroOrmModule + RabbitMQModule + MessagingClsModule so consumer services don't have to import them separately"
key-files:
  created:
    - packages/messaging-spine/src/topology/topology-bootstrap.service.ts
    - packages/messaging-spine/src/module.ts
    - .planning/phases/02-outbox-inbox-spine/02-06-SUMMARY.md
  modified:
    - packages/messaging-spine/src/index.ts (barrel now exports TopologyBootstrap + MessagingSpineModule + MessagingSpineModuleAsyncOptions)
decisions:
  - "MikroOrmModule.forFeature is passed the EntitySchema instances (OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema) — not the bare classes — because the entities in this package use EntitySchema rather than class decorators, and forFeature accepts EntityName<AnyEntity>[] which covers both."
  - "TopologyBootstrap uses createChannel (not createConfirmChannel) — assertExchange/assertQueue/bindQueue are idempotent declarative calls; confirm semantics buy nothing here and would pull in a heavier teardown."
  - "Channel cleanup runs in a finally block — declaration failures still need to release the channel; failing to close would leak channels across service restarts on misconfigured topology."
  - "Imports order is deliberate: MessagingClsModule.forRoot() first (global CLS must exist before any consumer registers handlers that read correlation/causation), RabbitMQModule.forRootAsync next (AmqpConnection must be DI-resolvable for TopologyBootstrap), MikroOrmModule.forFeature last (entity refs are concrete so order is informational here, but mirrors the runtime dependency direction)."
  - "AmqpConnection.connection is typed as amqplib.Connection (EventEmitter narrowing) but at runtime is the amqp-connection-manager ChannelModel that exposes createChannel — same boundary cast already used by OutboxPublisher in P2.4."
metrics:
  duration_minutes: 12
  tasks_completed: 2
  files_created: 2
  files_modified: 1
  commits: 2
  completed: 2026-05-24
---

# Phase 2 Plan 6: Messaging Spine Composition Summary

Wires every artefact built in waves 1-3 (entities, repositories, publisher,
listener, decorator, dead-letter, CLS) into a single `MessagingSpineModule`
that each service imports once with its own `MessagingOptions`. The companion
`TopologyBootstrap` service asserts every configured exchange, quorum queue
and binding at `OnApplicationBootstrap`, after MikroORM is fully initialised
but before any handler starts consuming.

REQ-WALL-05 and REQ-WALL-06 (wallet command/event topology) and
REQ-SAGA-05/REQ-SAGA-06 (DLX wiring + outbox/inbox composition) are now
structurally satisfied — Phase 3 only has to extend the topology config
with concrete wallet routes and inject the exported repositories.

---

## `MessagingSpineModule.forRootAsync` signature

```ts
import { MessagingSpineModule, EXCHANGES, QUEUES } from "@crash/messaging-spine";

@Module({
  imports: [
    MikroOrmModule.forRoot(/* ... */),
    MessagingSpineModule.forRootAsync({
      imports: [WalletsEnvModule],
      useFactory: (env: WalletsEnv) => ({
        amqpUrl: env.RABBITMQ_URL,
        databaseUrl: env.DATABASE_URL,
        serviceName: "wallets",
        outbox: {
          pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
          batchSize: 100,
        },
        topology: {
          exchangesToAssert: [
            { name: EXCHANGES.WALLET_COMMANDS, type: "direct", durable: true },
            { name: EXCHANGES.WALLET_EVENTS, type: "topic", durable: true },
            { name: EXCHANGES.WALLET_DLX, type: "fanout", durable: true },
          ],
          queuesToAssert: [
            { name: QUEUES.WALLET_COMMANDS, deliveryLimit: env.RMQ_DELIVERY_LIMIT_MAIN, dlx: EXCHANGES.WALLET_DLX },
            { name: QUEUES.WALLET_DLQ,      deliveryLimit: env.RMQ_DELIVERY_LIMIT_DLQ },
          ],
          bindings: [
            { queue: QUEUES.WALLET_COMMANDS, exchange: EXCHANGES.WALLET_COMMANDS, routingKey: "wallet.debit" },
            { queue: QUEUES.WALLET_COMMANDS, exchange: EXCHANGES.WALLET_COMMANDS, routingKey: "wallet.credit" },
            { queue: QUEUES.WALLET_DLQ,      exchange: EXCHANGES.WALLET_DLX,      routingKey: "" },
          ],
        },
      }),
      inject: [WALLETS_ENV_TOKEN],
    }),
  ],
})
export class AppModule {}
```

The interface itself:

```ts
export interface MessagingSpineModuleAsyncOptions {
  imports?: ModuleMetadata["imports"];
  useFactory: (...deps: unknown[]) => MessagingOptions | Promise<MessagingOptions>;
  inject?: FactoryProvider["inject"];
}
```

`imports` is forwarded into the dynamic module's `imports` array — useful for
pulling the env module (or any other module the factory depends on) into the
spine's scope without re-declaring it globally.

---

## Startup ordering guarantee

The module wires four lifecycle phases:

1. **DI resolution** — `MESSAGING_OPTIONS` factory runs once with whatever
   `inject` symbols the caller passed.
2. **`onModuleInit` (skipped)** — TopologyBootstrap, OutboxPublisher and
   OutboxListenerService deliberately implement `OnApplicationBootstrap`,
   not `OnModuleInit`, per 02-RESEARCH §Pitfall 5. This guarantees MikroORM
   has finished its own `onModuleInit` and the EntityManager is fully wired
   before any messaging artefact runs.
3. **`onApplicationBootstrap`** — runs in registration order:
   - `TopologyBootstrap.onApplicationBootstrap` asserts every exchange/queue/binding
   - `OutboxListenerService.onApplicationBootstrap` connects the LISTEN client
   - `OutboxPublisher.onApplicationBootstrap` creates the confirm channel and
     starts the polling loop
4. **`onApplicationShutdown`** — OutboxPublisher drains pending confirms and
   closes its channel; OutboxListenerService ends its dedicated pg.Client.

The topology MUST be asserted before any consumer binds, otherwise the
consumer will create the queue with default (classic, no DLX) arguments and
the first publish will succeed against an unrouted queue. The base class
pattern in `DeadLetterConsumer` and the `@IdempotentSubscribe` decorator both
declare queues with `buildQuorumArgs` on first delivery, so they agree with
TopologyBootstrap's declarations — the assertion just guarantees the queues
exist with the right shape before the broker even sees the consumer.

---

## TopologyBootstrap behaviour

```ts
async onApplicationBootstrap(): Promise<void> {
  const connection = this.amqp.connection as unknown as ChannelModel;
  const channel = await connection.createChannel();
  try {
    for (const ex of this.opts.topology.exchangesToAssert) {
      await channel.assertExchange(ex.name, ex.type, { durable: ex.durable });
      this.logger.log(`assertExchange ${ex.name} (${ex.type})`);
    }
    for (const q of this.opts.topology.queuesToAssert) {
      await channel.assertQueue(q.name, {
        durable: true,
        arguments: buildQuorumArgs(q.deliveryLimit, q.dlx),
      });
      this.logger.log(`assertQueue ${q.name} (deliveryLimit=${q.deliveryLimit}, dlx=${q.dlx ?? "none"})`);
    }
    for (const b of this.opts.topology.bindings) {
      await channel.bindQueue(b.queue, b.exchange, b.routingKey);
      this.logger.log(`bindQueue ${b.queue} <- ${b.exchange} :: ${b.routingKey}`);
    }
  } finally {
    await channel.close().catch((err) =>
      this.logger.warn(`topology channel close failed: ${(err as Error).message}`),
    );
  }
}
```

Key points:

- **One-shot channel** — `createChannel` (not `createConfirmChannel`). The
  three `assert*` operations are idempotent and don't benefit from publisher
  confirms; using a regular channel keeps the close path simple.
- **try/finally** — the channel always closes, even when an assertion throws.
  This is important because a `PRECONDITION_FAILED` (see drift recovery
  below) raises in the middle of the loop; without `finally` the channel
  would leak across service restarts on misconfigured topology.
- **Per-line logging** — every assertion is logged so operators can correlate
  service startup with broker state. The deliveryLimit/dlx values are
  emitted inline for `assertQueue` to make drift visible at a glance.

---

## Failure modes & operator recovery

`PRECONDITION_FAILED` from RabbitMQ on a second service start indicates
topology drift — typically a queue declared somewhere else (a stale dev
container, a manual `rabbitmqctl` call, or a previous service version) with
different `arguments`. The broker refuses to redeclare it with new args, and
the assert throws.

Recovery path (will be documented in ADR-009 in plan 02-07):

```bash
bun run docker:down
bun run docker:prune   # wipe RabbitMQ volume so all queue state is gone
bun run docker:up      # services re-declare everything from scratch
```

This is a deliberate "fail loud" design choice (threat T-02-20 / T-02-21):
half-declared topology would silently route messages to the wrong DLX, so we
prefer to abort bootstrap. The service does not become healthy until the
topology matches the config — which is the entire point of running the
assertion at startup.

---

## Exported providers — who injects what in Phase 3+

| Symbol                | Exported as | Who injects it                                                                  |
| --------------------- | ----------- | ------------------------------------------------------------------------------- |
| `MESSAGING_OPTIONS`   | provider    | Any caller that needs the resolved options (rare — most code uses the repos)    |
| `OutboxRepository`    | provider    | Phase 3 wallet command handlers (debit/credit) inside `em.transactional`         |
|                       |             | Phase 4 round-loop event publishers                                              |
| `InboxRepository`     | provider    | `@IdempotentSubscribe` host classes — wallet command consumer, games event consumer |
| `DeadLetterRepository`| provider    | Phase 3+ concrete `DeadLetterConsumer` subclasses (one per service)              |
| `RabbitMQModule`      | re-export   | Re-exported so consumer services can use `@RabbitSubscribe` without importing it directly |
| `MessagingClsModule`  | re-export   | Re-exported so request-scoped CLS is available to controllers + middleware       |
| `MikroOrmModule`      | re-export   | Re-exported so the three messaging entities are visible to consumer repositories  |

Internal-only (registered as providers but NOT exported):
- `OutboxListenerService` — only `OutboxPublisher` uses it
- `OutboxPublisher` — runs autonomously via lifecycle hooks
- `TopologyBootstrap` — runs autonomously via lifecycle hooks
- `Logger` — registered so `OutboxPublisher` (Phase 3+ extensions) can inject it without each consumer providing one

---

## Why imports order matters

`MessagingClsModule.forRoot()` → `RabbitMQModule.forRootAsync(...)` → `MikroOrmModule.forFeature([...])`

1. **CLS first** — `ClsModule.forRoot({ global: true })` mounts middleware
   that must exist before any HTTP controller registers. Loading CLS later
   in the imports array works but creates a subtle bootstrap-order risk if a
   Phase 3+ controller depends on CLS in its constructor.
2. **RabbitMQ second** — `AmqpConnection` must be DI-resolvable by the time
   `TopologyBootstrap` enters `onApplicationBootstrap`. RabbitMQModule's own
   `onApplicationBootstrap` initialises the connection; placing the module
   first guarantees its hook runs before TopologyBootstrap's.
3. **MikroORM forFeature last** — the entities are concrete classes/schemas
   passed by reference, so the ordering here is informational rather than
   technical. Placing it last mirrors the runtime dependency direction
   (CLS doesn't need anything; Rabbit needs CLS for header propagation in
   Phase 3+ subscribers; MikroORM repositories use both).

---

## Verification results

| Criterion                                                                              | Result |
| -------------------------------------------------------------------------------------- | ------ |
| `bun run typecheck` over `packages/messaging-spine`                                    | PASS   |
| `grep -c OnApplicationBootstrap src/topology/topology-bootstrap.service.ts` >= 1       | PASS (2 hits — implements clause + import) |
| `grep -c onModuleInit\|OnModuleInit src/topology/topology-bootstrap.service.ts` == 0   | PASS   |
| `grep -q assertExchange/assertQueue/bindQueue` in bootstrap source                     | PASS   |
| `grep -q buildQuorumArgs` in bootstrap source                                          | PASS   |
| `grep -q channel.close` in bootstrap source                                            | PASS   |
| `grep -q RabbitMQModule.forRootAsync src/module.ts`                                    | PASS   |
| `grep -q MikroOrmModule.forFeature src/module.ts`                                      | PASS   |
| `grep -q MessagingClsModule.forRoot src/module.ts`                                     | PASS   |
| `grep -q TopologyBootstrap src/module.ts`                                              | PASS   |
| `grep -q OutboxPublisher src/module.ts`                                                | PASS   |
| Module exports include OutboxRepository, InboxRepository, DeadLetterRepository         | PASS (verified by grep on exports block) |
| Inline `bun -e` import smoke verifies forRootAsync is a function and every named export resolves (MessagingSpineModule, TopologyBootstrap, IdempotentSubscribe, DeadLetterConsumer, MESSAGING_OPTIONS, buildEnvelope, EXCHANGES.WALLET_COMMANDS, MessagingClsModule, withMessagingContext) | PASS |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] MikroOrmModule.forFeature accepts EntitySchemas, not classes**

- **Found during:** Task 2 implementation review.
- **Issue:** The plan's `<interfaces>` section showed
  `MikroOrmModule.forFeature([OutboxMessage, InboxMessage, DeadLetterMessage])` —
  passing the bare classes. But every entity in this package is declared via
  `EntitySchema` (see `outbox-message.entity.ts`, `inbox-message.entity.ts`,
  `dead-letter-message.entity.ts`), not class decorators. Passing the bare
  class would register an entity without metadata, and MikroORM would either
  throw at boot or silently treat the class as unmapped.
- **Fix:** Imported and passed the `*Schema` exports instead:
  `MikroOrmModule.forFeature([OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema])`.
  The `EntityName<AnyEntity>[]` signature on `forFeature` accepts both shapes,
  so this is a type-safe, runtime-correct fix that matches how the rest of
  the package authoritatively defines its entities.
- **Files modified:** `packages/messaging-spine/src/module.ts`
- **Commit:** `33f6647`

### No Logger token leak

The plan listed `Logger` as a provider. It is registered (so `OutboxPublisher`
and friends can inject a project-wide logger via DI if desired) but is NOT
re-exported — that would leak a global token name from this module and
collide with consumer-side `Logger` providers. TopologyBootstrap instantiates
its own `new Logger(TopologyBootstrap.name)` like the other spine services,
which is the established pattern in this codebase.

### One-shot channel typed via ChannelModel cast

`AmqpConnection.connection` is typed as `amqplib.Connection` (an
`EventEmitter` per `@types/amqplib`), but at runtime it is the
`ChannelModel` returned by `amqp-connection-manager` which exposes
`createChannel`. The cast `this.amqp.connection as unknown as ChannelModel`
is the same boundary cast used by `OutboxPublisher` in P2.4 — confined to
the bootstrap edge of each file, never widening the type for callers.

---

## Authentication gates

None. All work was offline — file authoring + tsc + an isolated `bun -e`
import smoke test.

---

## Known Stubs

None. Every provider declared in this module has a concrete implementation
behind it; the module is fully usable by Phase 3+ services as-is.

---

## Threat Flags

(None — every artefact in this plan implements a mitigation already
enumerated in `<threat_model>`. T-02-20, T-02-21, T-02-22 are all addressed
structurally.)

---

## Commits

| Commit    | Task   | Description                                                                  |
| --------- | ------ | ---------------------------------------------------------------------------- |
| `8786fb7` | Task 1 | `TopologyBootstrap` service — asserts exchanges/queues/bindings at boot      |
| `33f6647` | Task 2 | `MessagingSpineModule.forRootAsync` + barrel update                          |

---

## Self-Check: PASSED

Files exist on disk:
- `packages/messaging-spine/src/topology/topology-bootstrap.service.ts` — FOUND
- `packages/messaging-spine/src/module.ts` — FOUND
- `packages/messaging-spine/src/index.ts` — FOUND (modified)
- `.planning/phases/02-outbox-inbox-spine/02-06-SUMMARY.md` — FOUND (this file)

Commits exist in git log:
- `8786fb7 feat(02-06): add TopologyBootstrap service for AMQP topology assertion` — FOUND
- `33f6647 feat(02-06): add MessagingSpineModule composition with topology + repositories` — FOUND
