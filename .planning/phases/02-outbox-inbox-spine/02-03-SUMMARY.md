---
phase: 02-outbox-inbox-spine
plan: 03
subsystem: envelope, topology, and CLS contracts for the messaging spine
tags: [contracts, envelope, topology, nestjs-cls, correlation, amqp]
requires:
  - "Phase 1 shared-kernel (DomainEventEnvelope type)"
  - "P2.1 messaging-spine workspace bootstrap (nestjs-cls + zod available in workspace)"
provides:
  - "buildEnvelope() and parseEnvelope() with required causationId enforcement"
  - "envelopeToAmqpHeaders() / amqpHeadersToEnvelopeMeta() bidirectional AMQP header bridge"
  - "EXCHANGES, QUEUES, buildQuorumArgs(), deriveDlxFromExchange() topology constants"
  - "topologyConfigSchema (zod) for bootstrap-time topology declaration"
  - "MessagingClsModule.forRoot() global CLS module with correlation-id middleware"
  - "withMessagingContext(cls, ctx, fn) helper for non-HTTP entry points"
affects:
  - "P2.4 (OutboxRepository.add will call envelopeToAmqpHeaders to populate the headers JSONB column)"
  - "P2.5 (IdempotentSubscribe will call amqpHeadersToEnvelopeMeta and consume CORRELATION_ID_KEY / CAUSATION_ID_KEY)"
  - "P2.6 (TopologyBootstrap will pass buildQuorumArgs() return value verbatim to channel.assertQueue)"
  - "Phase 4 round loop (will wrap each tick in withMessagingContext to seed correlation/causation)"
tech-stack:
  added:
    - "zod@^3.23 (declared as peer dependency on @crash/messaging-spine; already in workspace via shared-kernel)"
  patterns:
    - "Pure functions over classes for envelope construction (no DI, no side effects)"
    - "Const-asserted objects for header keys + topology names so consumers get exhaustive autocomplete"
    - "Required causationId at construction time — impossible to publish a traceless event (T-02-06 mitigation)"
    - "Single source of truth for exchange/queue names — services import constants, never write literals (T-02-08 mitigation)"
    - "CLS middleware honours both x-correlation-id and x-request-id headers, falls back to generated UUID"
key-files:
  created:
    - packages/messaging-spine/src/envelope/build-envelope.ts
    - packages/messaging-spine/src/envelope/envelope-headers.ts
    - packages/messaging-spine/src/topology/topology-defaults.ts
    - packages/messaging-spine/src/topology/topology-config.ts
    - packages/messaging-spine/src/context/correlation-tokens.ts
    - packages/messaging-spine/src/context/messaging-cls.ts
  modified:
    - packages/messaging-spine/src/index.ts (barrel re-exports the six new public surfaces)
    - packages/messaging-spine/package.json (added zod to peerDependencies)
    - bun.lock (peer-dep relink, no new packages downloaded)
decisions:
  - "causationId is REQUIRED at buildEnvelope() — flow-origin events MUST pass the same value as messageId. This makes REQ-SAGA-06 (every event traceable to its trigger) a compile-time-equivalent contract rather than a runtime hope."
  - "correlationId defaults to messageId when omitted — a brand-new flow self-correlates rather than carrying a separate UUID. Mid-saga events still receive an explicit correlationId from the inbound envelope."
  - "AMQP_HEADER_KEYS are the x-* canonical names (x-correlation-id, x-causation-id, x-message-id, x-event-type, x-event-version, x-occurred-at) — the same shape RabbitMQ management UI and consumer libraries expect."
  - "deriveDlxFromExchange() lives in topology-defaults so the IdempotentSubscribe decorator (P2.5) can declare an inline queue and resolve its DLX without duplicating the mapping."
  - "zod added as a peer dependency rather than a direct dependency — shared-kernel already declares it, and the host service installs decide the exact 3.x version."
metrics:
  duration_minutes: 12
  tasks_completed: 3
  files_created: 6
  files_modified: 3
  commits: 3
completed: 2026-05-25
---

# Phase 2 Plan 3: Envelope, Topology, and CLS Contracts Summary

Shipped the three contract layers every other Phase 2 plan depends on: the
`DomainEventEnvelope` build/parse helpers plus AMQP-header bridge, the canonical
`EXCHANGES` / `QUEUES` constants plus `buildQuorumArgs()` helper plus zod
`topologyConfigSchema`, and the `MessagingClsModule` plus `withMessagingContext()`
helper for correlation/causation propagation through both HTTP-originated and
scheduled-task-originated flows.

## Envelope contract

### `buildEnvelope<TPayload>(opts: EnvelopeBuildOptions): DomainEventEnvelope<TPayload>`

```ts
interface EnvelopeBuildOptions {
  type: string;                // event type, e.g. "wallet.debited.v1"
  version?: number;            // defaults to 1
  payload: unknown;            // domain payload (serialisable)
  correlationId?: string;      // defaults to messageId — self-correlating new flows
  causationId: string;         // REQUIRED — upstream messageId, or same as messageId for flow origins
  occurredAt?: Date;           // defaults to new Date(); serialised as ISO string
  messageId?: string;          // defaults to crypto.randomUUID()
}
```

Throws `Error('causationId is required — pass the upstream messageId or, for
flow-origin events, the same value as messageId')` when `causationId` is missing
or empty.

### `parseEnvelope<TPayload>(raw: string | Buffer): DomainEventEnvelope<TPayload>`

Round-trips `JSON.stringify(buildEnvelope(...))` losslessly. Validates the seven
required fields (`messageId`, `correlationId`, `causationId`, `type`, `version`,
`occurredAt`, `payload`) and their primitive shapes; throws
`Error('Invalid envelope: missing <field>')` on the first violation.

## AMQP header bridge

| Envelope field    | AMQP header             |
| ----------------- | ----------------------- |
| `correlationId`   | `x-correlation-id`      |
| `causationId`     | `x-causation-id`        |
| `messageId`       | `x-message-id`          |
| `type`            | `x-event-type`          |
| `version`         | `x-event-version`       |
| `occurredAt`      | `x-occurred-at`         |

`envelopeToAmqpHeaders(env)` returns the header bag verbatim. The publisher
sets `headers` on `channel.publish` while still passing the well-known
`messageId` / `type` / `contentType` / `persistent` options on the publish
call itself.

`amqpHeadersToEnvelopeMeta(headers)` reads the bag (handles Buffer-valued
headers from amqplib), throws on missing `x-correlation-id`,
`x-causation-id`, `x-message-id`, or `x-event-type`, and defaults `version`
to `1` and `occurredAt` to `new Date().toISOString()` when absent.

## Topology constants

### `EXCHANGES`

| Constant            | Value              | Type    |
| ------------------- | ------------------ | ------- |
| `WALLET_COMMANDS`   | `wallet.commands`  | direct  |
| `WALLET_EVENTS`     | `wallet.events`    | topic   |
| `GAME_EVENTS`       | `game.events`      | topic   |
| `WALLET_DLX`        | `wallet.dlx`       | fanout  |
| `GAME_DLX`          | `game.dlx`         | fanout  |

### `QUEUES`

| Constant                | Value                  |
| ----------------------- | ---------------------- |
| `WALLET_COMMANDS`       | `wallet.commands.q`    |
| `GAMES_WALLET_EVENTS`   | `games.wallet-events.q`|
| `WALLET_DLQ`            | `wallet.dlq`           |
| `GAMES_DLQ`             | `games.dlq`            |

### `buildQuorumArgs(deliveryLimit, dlxName?)`

| Input                                        | RabbitMQ arg key            | Value                |
| -------------------------------------------- | --------------------------- | -------------------- |
| (always)                                     | `x-queue-type`              | `"quorum"`           |
| `deliveryLimit`                              | `x-delivery-limit`          | the number passed    |
| `dlxName` (when present)                     | `x-dead-letter-exchange`    | the string passed    |
| `dlxName` (when omitted)                     | (key absent)                | —                    |

### `deriveDlxFromExchange(exchange)`

| Input               | Output         |
| ------------------- | -------------- |
| `wallet.commands`   | `wallet.dlx`   |
| `wallet.events`     | `wallet.dlx`   |
| `game.events`       | `game.dlx`     |
| anything else       | throws         |

### `topologyConfigSchema` (zod)

```ts
{
  exchangesToAssert: Array<{ name: string; type: 'direct'|'topic'|'fanout'; durable?: boolean }>;
  queuesToAssert:    Array<{ name: string; deliveryLimit: number; dlx?: string }>;
  bindings:          Array<{ queue: string; exchange: string; routingKey: string }>;
}
```

P2.6 `TopologyBootstrap` parses runtime config against this schema before
asserting anything against RabbitMQ.

## CLS contract

### Module wiring

`MessagingClsModule.forRoot()` returns a NestJS `DynamicModule` that imports
`ClsModule.forRoot({ global: true, middleware: { mount, generateId, idGenerator, setup } })`.
The middleware:

1. Generates a new UUID per request via `crypto.randomUUID()`.
2. `setup(cls, req)` reads `x-correlation-id` first, then `x-request-id`,
   falling back to `cls.getId()` if neither is present. The chosen value is
   written under `CORRELATION_ID_KEY` (`"correlationId"`).
3. Exports `ClsModule` so consumers can `@Inject(ClsService)`.

### Who sets what

| Caller                                          | Sets in CLS                              | Reads in CLS                                  |
| ----------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| HTTP middleware (`MessagingClsModule`)          | `correlationId` (from header or generated) | —                                           |
| Round loop / recovery scan (`withMessagingContext`) | `correlationId` + `causationId`     | —                                             |
| `IdempotentSubscribe` decorator (P2.5)          | `correlationId` + `causationId` from inbound AMQP headers | — |
| Outbox writer (P2.4)                            | —                                        | `correlationId`, `causationId` (to stamp envelope) |
| Logger / interceptors                           | —                                        | `correlationId` (for log enrichment)          |

### `withMessagingContext(cls, ctx, fn)`

```ts
async function withMessagingContext<T>(
  cls: ClsService,
  ctx: { correlationId: string; causationId?: string },
  fn: () => Promise<T>,
): Promise<T>
```

Used by non-request entry points (Phase 4 round loop, Phase 5 outbox recovery
scan, scheduled tasks) to enter a CLS scope and seed correlation/causation
before invoking domain code that emits events.

## Public exports (barrel `packages/messaging-spine/src/index.ts`)

- `buildEnvelope`, `parseEnvelope`, type `EnvelopeBuildOptions`
- `envelopeToAmqpHeaders`, `amqpHeadersToEnvelopeMeta`, `AMQP_HEADER_KEYS`, type `EnvelopeMeta`
- `EXCHANGES`, `QUEUES`, `buildQuorumArgs`, `deriveDlxFromExchange`, types `ExchangeName`, `QueueName`
- `topologyConfigSchema`, type `TopologyConfig`
- `CORRELATION_ID_KEY`, `CAUSATION_ID_KEY`
- `MessagingClsModule`, `withMessagingContext`

## Verification

| Criterion                                                                                | Result   |
| ---------------------------------------------------------------------------------------- | -------- |
| Isolated `tsc --noEmit` over the six new files                                           | PASS     |
| `buildEnvelope({type, payload, causationId:'abc'})` yields all seven fields              | PASS     |
| `parseEnvelope(JSON.stringify(buildEnvelope(...)))` round-trips losslessly               | PASS     |
| `buildEnvelope` throws when `causationId` is missing/empty                               | PASS     |
| `parseEnvelope` throws on missing required field                                         | PASS     |
| `envelopeToAmqpHeaders` → `amqpHeadersToEnvelopeMeta` preserves `correlationId`          | PASS     |
| `buildQuorumArgs(5,'wallet.dlx')` produces all three keys                                | PASS     |
| `buildQuorumArgs(3)` omits `x-dead-letter-exchange`                                      | PASS     |
| `deriveDlxFromExchange` covers all five known exchanges and throws on unknown            | PASS     |
| `topologyConfigSchema` parses the canonical wallet topology shape                        | PASS     |
| `CORRELATION_ID_KEY === 'correlationId'` and `CAUSATION_ID_KEY === 'causationId'`        | PASS     |
| `MessagingClsModule.forRoot()` returns a `DynamicModule` with `imports` + `exports`      | PASS     |
| All six surfaces reachable from the public barrel                                        | PASS     |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `zod` to messaging-spine peer dependencies**
- **Found during:** Task 2 verification (typecheck failed with "Cannot find module 'zod'")
- **Issue:** `topologyConfigSchema` imports `zod`, but the package never declared a relationship to it. Workspace hoisting placed zod inside `node_modules/.bun` only because `@crash/shared-kernel` depends on it — relying on a transitive sibling install is fragile.
- **Fix:** Added `"zod": "^3.23.0"` to `peerDependencies` in `packages/messaging-spine/package.json` and re-ran `bun install` to re-link the peer.
- **Files modified:** `packages/messaging-spine/package.json`, `bun.lock`
- **Commit:** `728bc3a`

## Deferred Issues

**Pre-existing typecheck errors in P2.2-scoped files** — `bun run typecheck`
inside `packages/messaging-spine` reports 11 errors across
`src/dead-letter/dead-letter-message.entity.ts`,
`src/inbox/inbox-message.entity.ts`,
`src/outbox/outbox-message.entity.ts` (MikroORM decorator imports such as
`Entity`, `PrimaryKey`, `Property`, `Unique` not resolving from
`@mikro-orm/core`). These files are **untracked** local stubs that pre-date P2.3
and live in directories explicitly out of P2.3's scope (P2.2 owns them per the
plan's "Important" section). Per the SCOPE BOUNDARY rule, P2.3 did not touch
them. Isolated `tsc --noEmit` over the six P2.3 files succeeds with zero errors.

P2.2 will replace those stubs with the real entity definitions and resolve the
MikroORM v7 named-export issue.

## Threat Flags

(None — this plan ships pure contracts. The threat model's two mitigations
(T-02-06 required causationId, T-02-08 single-source topology constants) are
both implemented exactly as written.)

## Self-Check: PASSED

Files exist:
- `packages/messaging-spine/src/envelope/build-envelope.ts` — FOUND
- `packages/messaging-spine/src/envelope/envelope-headers.ts` — FOUND
- `packages/messaging-spine/src/topology/topology-defaults.ts` — FOUND
- `packages/messaging-spine/src/topology/topology-config.ts` — FOUND
- `packages/messaging-spine/src/context/correlation-tokens.ts` — FOUND
- `packages/messaging-spine/src/context/messaging-cls.ts` — FOUND
- `packages/messaging-spine/src/index.ts` — FOUND (modified)

Commits exist:
- `3005f81` (Task 1: envelope helpers + AMQP header bridge) — FOUND
- `728bc3a` (Task 2: topology constants + zod schema) — FOUND
- `c6fa3f6` (Task 3: MessagingClsModule + withMessagingContext) — FOUND
