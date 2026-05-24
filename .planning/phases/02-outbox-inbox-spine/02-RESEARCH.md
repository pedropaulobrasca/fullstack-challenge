# Phase 2: Outbox / Inbox Messaging Spine — Research

**Researched:** 2026-05-24
**Domain:** Transactional outbox + inbox, polling publisher with publisher confirms, quorum-queue + DLX topology, correlation/causation propagation across NestJS services on RabbitMQ 4.2
**Confidence:** HIGH on schema and topology (Bustabit-canon outbox, RabbitMQ official poison-message docs). HIGH on AMQP client split (settled in SUMMARY §8). MEDIUM-HIGH on LISTEN/NOTIFY wake (Postgres docs explicit, MikroORM doesn't expose it natively — needs raw `pg` client side-channel). MEDIUM on testing approach (testcontainers Node port works; Bun-test orchestration adds a thin wrapper).

---

## Summary

Phase 2 lands the messaging spine that every saga from Phase 5 onward will sit on. Two operational guarantees define success: **at-least-once delivery** (no event lost on `kill -9` between DB commit and AMQP confirm) and **exactly-once processing** (consumer side-effects run exactly once even when the broker redelivers). The dual-write problem is solved by writing the domain row and an outbox row in the same Postgres transaction; a separate polling publisher claims unpublished rows with `FOR UPDATE SKIP LOCKED`, ships them with `confirmSelect` + `waitForConfirms`, and only then marks them `processed`. Idempotency on the consumer side is enforced by an inbox row keyed on `(consumer_name, message_id)` inserted in the same TX as the side-effect. Topology is RabbitMQ 4.2 quorum queues everywhere with `x-delivery-limit=5` on main and `x-delivery-limit=3` on DLQ; a `dead_letter_messages` Postgres table catches the messages that exhaust both limits.

The phase ships pure infrastructure — no business aggregate exists yet. The chicken-and-egg of "the outbox needs an aggregate to write into in the same TX" is solved by shipping a minimal `MessagingProbe` test aggregate, used only by integration tests and deleted in Phase 3 once Wallet lands. The outbox/inbox primitives ship as a single `@crash/messaging-spine` workspace package (Option A from research question 8), keeping the same module configurable per service (`consumerName`, `serviceName`, env injection).

**Primary recommendation:** Hand-roll the outbox/inbox in `@crash/messaging-spine` over either `nestjs-outbox` (single-maintainer, low-adoption) or the MikroORM-blog OutboxEvent pattern (too thin — no DLX, no inbox, no confirms). Use raw `amqplib` for the publisher (full confirm lifecycle ownership) and `@golevelup/nestjs-rabbitmq` for the consumer wrapper (clean `@RabbitSubscribe` decorators with a wrapping `@IdempotentSubscribe` that runs the inbox check before the handler). LISTEN/NOTIFY rides on a dedicated `pg` client (NOT through MikroORM's pooled connection) to wake the poller below 1s baseline.

---

## User Constraints (from upstream `.planning/PROJECT.md`, `.planning/CLAUDE.md`, `.planning/research/*`)

No `02-CONTEXT.md` exists yet for this phase. Constraints inherited from CLAUDE.md + PROJECT.md + locked research:

### Locked Decisions (already settled by Phase 1 + research synthesis)
- **AMQP client split:** raw `amqplib` for outbox publisher (own confirm lifecycle); `@golevelup/nestjs-rabbitmq` for consumer ergonomics (resolved in `SUMMARY.md §8`)
- **Outbox/Inbox is hand-rolled** in a shared workspace package, not a third-party library (resolved in `STACK.md §2.10`)
- **RabbitMQ 4.2 quorum queues** for every business queue, with `x-delivery-limit` on both main AND DLQ (resolved in `PITFALLS C4` and `H5`)
- **Postgres 18** is the storage substrate (`BIGSERIAL` for outbox PK, `JSONB` for payload/headers, no float anywhere)
- **MikroORM 7.1+** is the ORM; entities go in `services/<svc>/src/infrastructure/persistence/`
- **TypeScript 5.8.3 strict** (per existing `services/games/package.json`); zero `number` for money-related fields per ESLint guard
- **Every message carries** `messageId, correlationId, causationId, type, version, occurredAt, payload` per `packages/shared-kernel/src/events/envelope.ts`
- **No emojis in code**, no AI-attribution in commits, names must be self-explanatory (per global + project CLAUDE.md)
- **Env-driven constants** — `OUTBOX_POLL_INTERVAL_MS=1000`, `RMQ_DELIVERY_LIMIT_MAIN=5`, `RMQ_DELIVERY_LIMIT_DLQ=3` already defined in `REQUIREMENTS.md` Open Configuration Values table

### Claude's Discretion (research recommends — planner can override with rationale)
- **Outbox table column shape** — base recommended schema below; planner may add metrics columns
- **Inbox composite key** — recommend `(consumer_name, message_id)` for multi-consumer-per-service flexibility
- **Dead-letter table shape** — recommend keeping wire format intact so messages can be replayed manually
- **LISTEN/NOTIFY channel name** — recommend `outbox_new_message` (per-service prefix optional)
- **Topology declaration approach** — recommend service-startup `assertExchange`/`assertQueue` (portable) over RabbitMQ `definitions.json` mount (operationally tighter, but adds infra coupling)
- **`MessagingProbe` test aggregate** location — recommend `services/games/tests/integration/_helpers/probe-aggregate.ts` (deleted in Phase 3 once Wallet lands)
- **Per-service vs shared package** — recommend single `@crash/messaging-spine` workspace package, configured per service via NestJS module options

### Deferred Ideas (OUT OF SCOPE for Phase 2 — flagged for later phases)
- **Outbox archival** (move PROCESSED rows to cold storage after N days) → Phase 10
- **Inbox cleanup** (delete rows older than X days where every dependent consumer has caught up) → Phase 10
- **Metrics** (publish lag, consumer lag, DLQ depth, redelivery count distribution) → Phase 10 observability
- **OpenTelemetry trace propagation** through AMQP headers (`traceparent`) → Phase 10
- **Dead-letter parking-lot UI / replay endpoint** → Phase 10 (or stretch)
- **Per-aggregate sharding of the outbox** → never (not needed at single-instance challenge scale)
- **Logical replication / Debezium** → explicitly rejected in `ARCHITECTURE.md §5.2`
- **Saga state persistence (`bet_saga_state` table)** → Phase 5 (different concern; outbox is one layer below)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-WALL-05 | Wallet service uses an inbox table for exactly-once command processing (dedup on `messageId`, same TX as state mutation) | §Inbox table DDL + §Idempotent consumer wrapper — defines the schema, the same-TX semantics, and the `@IdempotentSubscribe` decorator. Phase 2 ships the spine; Phase 3 wires it into Wallet. |
| REQ-WALL-06 | Wallet writes domain events to outbox in same TX as state change; polling publisher with `confirmSelect` + `waitForConfirms` ships at-least-once | §Outbox table DDL + §Polling publisher pseudocode — defines `OUTBOX_POLL_INTERVAL_MS=1000` baseline, `FOR UPDATE SKIP LOCKED` batch claim, `confirmSelect` once per channel, `waitForConfirms` per batch. |
| REQ-SAGA-05 | Quorum queues + DLX with `x-delivery-limit` on both main AND DLQ; poison messages → dead-letter table | §RabbitMQ topology + §Dead-letter handler — quorum queue arguments concretely listed; `dead_letter_messages` schema + consumer that catches DLQ exhaustion. |
| REQ-SAGA-06 | `correlationId` + `causationId` headers through every message | §Correlation/causation context — `nestjs-cls` with `AsyncLocalStorage`; consumer extracts headers + sets CLS; publisher reads CLS + writes headers. |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Outbox row insert (same TX as aggregate) | Service application layer (domain handler calls `OutboxRepository.add(envelope)` inside `em.transactional`) | MikroORM 7 EntityManager | Dual-write fix lives at the boundary of the use case; the repository is just a typed thin wrapper. |
| Outbox row batch claim + publish | `@crash/messaging-spine` `OutboxPublisher` (NestJS injectable, runs in the service process) | Raw `amqplib` confirm channel + dedicated `pg` LISTEN client | Polling is service-local; horizontal scaling later via `SKIP LOCKED` requires zero code change. |
| Inbox dedup check + handler dispatch | `@crash/messaging-spine` `@IdempotentSubscribe` decorator wrapping `@RabbitSubscribe` | MikroORM `em.transactional` | Decorator owns the contract: open TX → insert inbox row → if conflict, ack + skip; else run handler + mark inbox processed + commit + ack. |
| RabbitMQ topology assertion | `@crash/messaging-spine` `TopologyBootstrap` (`OnApplicationBootstrap`) | `amqplib` channel API | Each service declares its own exchanges/queues at startup. Idempotent — safe to re-run. Survives `docker compose down -v`. |
| Dead-letter persistence | `@crash/messaging-spine` `DeadLetterConsumer` (one per DLQ per service) | MikroORM | Consumer reads from `*.dlq`; when `x-death` header shows the DLQ itself has exhausted `x-delivery-limit=3`, write to `dead_letter_messages` table and ack. |
| Correlation/causation context | `@crash/messaging-spine` + `nestjs-cls` | `AsyncLocalStorage` | CLS holds `correlationId` + `causationId` for the duration of any request/AMQP-handler; publisher reads from CLS, consumer extracts headers and injects into CLS. |

---

## Standard Stack

### Core packages this phase adds to the workspace

| Package | Version | Where | Purpose | Confidence |
|---------|---------|-------|---------|------------|
| `amqplib` | `^0.10.x` | `@crash/messaging-spine` + both services | Raw AMQP client for publisher; own confirm-channel lifecycle | HIGH [CITED: STACK.md §3, ARCHITECTURE.md §5] |
| `@types/amqplib` | `^0.10.x` | `@crash/messaging-spine` devDep | TS types for amqplib | HIGH |
| `@golevelup/nestjs-rabbitmq` | `^5.x` | `@crash/messaging-spine` + both services | `@RabbitSubscribe` decorator + connection lifecycle for consumers | HIGH [CITED: STACK.md §3] |
| `nestjs-cls` | `^4.x` | `@crash/messaging-spine` + both services | AsyncLocalStorage-backed CLS for correlationId/causationId propagation | HIGH [VERIFIED: nestjs-cls npm + docs] |
| `pg` | `^8.x` | `@crash/messaging-spine` | Dedicated PG client for LISTEN/NOTIFY (separate from MikroORM pool) | HIGH [VERIFIED: postgres docs — LISTEN requires dedicated connection] |
| `uuid` | `^10.x` | `@crash/messaging-spine` + both services | Message IDs, correlation IDs | HIGH [CITED: STACK.md §3] |

### Supporting packages (already installed in Phase 1)

| Package | Version | Why it matters here |
|---------|---------|---------------------|
| `@mikro-orm/core` | `^7.1.0` | EntityManager, `em.transactional`, repositories |
| `@mikro-orm/postgresql` | `^7.1.0` | Pessimistic lock helpers (`LockMode.PESSIMISTIC_WRITE`), `SKIP LOCKED` via raw QB |
| `@mikro-orm/nestjs` | `^7.0.0` | Request-scoped EM injection |
| `@mikro-orm/migrations` | `^7.1.0` | Phase 2 ships 2 migrations per service (outbox, inbox, dead_letter_messages) |
| `@nestjs/common` `@nestjs/core` | `^11.1.21` | Existing NestJS runtime |
| `zod` | `^3.23.0` | Envelope validation in inbox handlers + topology config schema |
| `@crash/shared-kernel` | `workspace:*` | `DomainEventEnvelope`, branded IDs, error taxonomy |

### Alternatives considered (and rejected)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `OutboxPublisher` | `nestjs-outbox` (fullstackhouse) | ~600 weekly downloads, single maintainer, supports LISTEN/NOTIFY but hides confirm-channel lifecycle. Recruiter sees a black-box dep instead of the dual-write fix in our repo. [VERIFIED: STACK.md §2.10] |
| Hand-rolled `OutboxPublisher` | `pg-transactional-outbox` | Postgres-direct (good) but couples publisher to a specific WAL-replication strategy; we want polling for simplicity at challenge scale. |
| Hand-rolled idempotent consumer | MikroORM's blog `OutboxEvent` pattern | Official MikroORM blog pattern has **no inbox** at all, just a boolean `processed` flag on outbox. Useless for the consumer half. [CITED: mikro-orm.io/docs/transactional-outbox] |
| `@golevelup/nestjs-rabbitmq` for publisher | `@nestjs/microservices` RabbitMQ transport | Transport hides `confirmSelect`/`waitForConfirms`. Cannot satisfy REQ-WALL-06 without ejecting. [CITED: PITFALLS M8] |
| `nestjs-cls` for context | Roll our own AsyncLocalStorage wrapper | Reinventing a well-tested module; nestjs-cls also ships a `ClsPluginTransactional` we may use later in Phase 5 for saga state. |
| Dedicated `pg` client for LISTEN | MikroORM connection | LISTEN requires a non-pooled, non-shared connection that blocks while listening. MikroORM's pool will starve. [VERIFIED: PostgreSQL LISTEN docs] |

### Installation (per package.json updates)

```bash
# @crash/messaging-spine (new workspace package)
bun add amqplib @golevelup/nestjs-rabbitmq nestjs-cls pg uuid
bun add -d @types/amqplib @types/pg @types/uuid

# services/games and services/wallets (consumer)
bun add @crash/messaging-spine amqplib @golevelup/nestjs-rabbitmq nestjs-cls
```

**Version verification commands (planner must run before install):**
```bash
npm view amqplib version
npm view @golevelup/nestjs-rabbitmq version
npm view nestjs-cls version
npm view pg version
```

---

## Package Legitimacy Audit

> slopcheck not run in this research session — all packages below are tagged `[ASSUMED]`. The planner must insert a `checkpoint:human-verify` task before each `bun add` step. Every package below was discovered via authoritative sources (official docs, STACK.md citations, MikroORM official docs).

| Package | Registry | Discovered via | Age (approx.) | Disposition |
|---------|----------|----------------|---------------|-------------|
| `amqplib` | npm | RabbitMQ official tutorials + STACK.md §3 | ~12 yrs, ~3M weekly downloads (estimate from training) | [ASSUMED — verify `npm view amqplib version` before install] |
| `@golevelup/nestjs-rabbitmq` | npm | golevelup org official docs + STACK.md §3 | ~5 yrs, in active use | [ASSUMED — verify version is current and repo is alive] |
| `nestjs-cls` | npm | Papooch/nestjs-cls GitHub + npm; NestJS official ALS recipe references it | ~3 yrs, maintained | [ASSUMED — verify version current] |
| `pg` | npm | brianc/node-postgres canonical; ubiquitous | ~15 yrs, ~10M weekly downloads | [ASSUMED — verify version current] |
| `uuid` | npm | already in shared-kernel via STACK.md §3 | ~12 yrs, ubiquitous | [ASSUMED — already widely-known good] |
| `@types/amqplib`, `@types/pg`, `@types/uuid` | npm (`@types` org) | DefinitelyTyped canonical | n/a | [ASSUMED — verify versions match runtime libs] |

**Pre-install checkpoint protocol for planner:** insert `checkpoint:human-verify` immediately before each `bun add` task with this two-liner per package:
```bash
bun pm info <pkg> | head -25       # version + repo + maintainer
npm view <pkg> repository.url      # confirm a real upstream repo exists
```
Flag any package with weekly downloads < 1k, repo missing, or age < 1 year.

**No `postinstall` scripts expected** on any of the above. Run `npm view <pkg> scripts.postinstall` per package as a final gate.

---

## Architecture Patterns

### System Architecture Diagram

```
                       Service A (e.g. wallets)                              Service B (e.g. games)
                      ┌─────────────────────────────┐                       ┌─────────────────────────────┐
                      │  Application use-case       │                       │  Application use-case       │
                      │  em.transactional(async () =>{                      │                             │
                      │    aggregate.mutate(...)    │                       │  @IdempotentSubscribe(...)  │
                      │    em.persist(aggregate)    │                       │  async handle(env, msg) {   │
                      │    outbox.add(envelope)     │                       │    [decorator opens TX,     │
                      │    em.flush()    [commit]   │                       │     inserts inbox row,      │
                      │  })                         │                       │     dispatches to me,       │
                      └──────┬───────────┬──────────┘                       │     commits, acks msg]      │
                             │           │                                  └──────────▲──────────────────┘
                  same TX    │           │ same TX                                     │
                             ▼           ▼                                             │ AMQP delivery
                      ┌──────────┐  ┌──────────┐                                       │ (manual ack)
                      │ aggregate│  │ outbox   │                                       │
                      │ row      │  │ row      │                                       │
                      └──────────┘  └────┬─────┘                                       │
                                         │ pg_notify('outbox_new_message')             │
                                         │                                             │
                                         ▼                                             │
                                  ┌──────────────┐                                     │
                                  │ Dedicated pg │ ─────wake───┐                       │
                                  │ LISTEN client│              │                      │
                                  └──────────────┘              ▼                      │
                                                       ┌───────────────────┐           │
                                                       │ OutboxPublisher    │          │
                                                       │ (NestJS @Injectable)│         │
                                                       │ — every 1s OR wake:│          │
                                                       │ 1) BEGIN           │          │
                                                       │ 2) SELECT ... FOR  │          │
                                                       │    UPDATE SKIP     │          │
                                                       │    LOCKED LIMIT 50 │          │
                                                       │ 3) confirmSelect   │          │
                                                       │    + publish each  │          │
                                                       │    + waitForConfirms│          │
                                                       │ 4) UPDATE processed_at         │
                                                       │ 5) COMMIT          │          │
                                                       └─────────┬─────────┘           │
                                                                 │ AMQP (confirm channel)
                                                                 ▼                      │
                                                       ┌───────────────────────────────┴───────────────┐
                                                       │              RabbitMQ 4.2                      │
                                                       │ Exchanges:                                     │
                                                       │   wallet.commands  (direct, durable)           │
                                                       │   wallet.events    (topic, durable)            │
                                                       │   game.events      (topic, durable)            │
                                                       │ Quorum queues with x-delivery-limit=5:         │
                                                       │   wallet.commands.q  → DLX wallet.dlx          │
                                                       │   games.wallet-events.q → DLX games.dlx        │
                                                       │ DLQs with x-delivery-limit=3:                  │
                                                       │   wallet.dlq, games.dlq                        │
                                                       └───────────────┬───────────────────────────────┘
                                                                       │ message routed to DLQ after main exhausts
                                                                       ▼
                                                       ┌───────────────────────────┐
                                                       │ DeadLetterConsumer        │
                                                       │ — when x-death.count==3   │
                                                       │   on DLQ side, write to   │
                                                       │   dead_letter_messages    │
                                                       │   table and ack           │
                                                       └───────────────────────────┘
```

### Recommended structure for the new shared package

```
packages/messaging-spine/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                              # public API
    ├── module.ts                             # MessagingSpineModule.forRootAsync(options)
    ├── outbox/
    │   ├── outbox-message.entity.ts          # MikroORM entity
    │   ├── outbox-repository.ts              # add(envelope), claimBatch(), markProcessed()
    │   ├── outbox-publisher.service.ts       # the polling loop + confirm channel
    │   ├── outbox-listener.service.ts        # dedicated pg LISTEN client
    │   └── outbox-status.ts                  # status enum (PENDING|PUBLISHED|FAILED)
    ├── inbox/
    │   ├── inbox-message.entity.ts           # MikroORM entity
    │   ├── inbox-repository.ts               # tryInsert(consumerName, messageId): boolean
    │   ├── idempotent-subscribe.decorator.ts # @IdempotentSubscribe wraps @RabbitSubscribe
    │   └── consumer-name.token.ts            # DI token for per-handler consumer name
    ├── dead-letter/
    │   ├── dead-letter-message.entity.ts
    │   ├── dead-letter-consumer.service.ts   # consumer wired to a DLQ
    │   └── dead-letter-repository.ts
    ├── topology/
    │   ├── topology-config.ts                # zod schema describing exchanges/queues/bindings
    │   ├── topology-bootstrap.service.ts     # asserts on @OnApplicationBootstrap
    │   └── topology-defaults.ts              # exchanges + DLX wiring helpers
    ├── envelope/
    │   ├── build-envelope.ts                 # createEnvelope(type, payload, { correlationId, causationId })
    │   └── envelope-headers.ts               # AMQP header (de)serialization
    ├── context/
    │   ├── messaging-cls.ts                  # nestjs-cls integration
    │   └── correlation-tokens.ts             # constants
    └── migrations/
        └── shared/                           # template SQL fragments services copy into their migrations
            ├── 001-outbox.sql
            ├── 002-inbox.sql
            └── 003-dead-letter-messages.sql
```

### Pattern 1: Same-TX outbox write (the dual-write fix)

**What:** Any state mutation that emits domain events writes the events into `outbox` within the same `em.transactional` block. The publisher is asynchronous and decoupled.

**When to use:** Every use case that mutates state and publishes an event. Phase 5 sagas use this exclusively.

**Example (pseudocode — Phase 3 wallet will be the first real consumer):**
```typescript
async debit(playerId: PlayerId, amount: Money, command: DebitCommand): Promise<void> {
  await this.em.transactional(async (em) => {
    const wallet = await this.walletRepo.findOneForUpdate(playerId);
    wallet.debit(amount);
    em.persist(wallet);
    await this.outbox.add(
      buildEnvelope({
        type: "wallet.debited",
        payload: { walletId: wallet.id, newBalanceCents: wallet.balance.toCents().toString() },
        correlationId: this.cls.get("correlationId"),
        causationId: command.messageId,
      }),
      { exchange: "wallet.events", routingKey: "wallet.debited" },
    );
  });
}
```
Source: ARCHITECTURE.md §5.3; MikroORM transactional outbox doc [CITED: mikro-orm.io/docs/transactional-outbox] for the conceptual approach (we extend it with confirms + inbox).

### Pattern 2: Idempotent consumer wrapper

**What:** A class decorator `@IdempotentSubscribe(opts)` that wraps `@RabbitSubscribe` from `@golevelup/nestjs-rabbitmq`. On every delivery it opens a TX, attempts to INSERT into `inbox`; if the insert conflicts (already processed), it acks and skips; if the insert succeeds, it dispatches to the wrapped method inside the same TX, commits, and acks.

**When to use:** Every AMQP message handler in every service.

**Example (pseudocode):**
```typescript
@Injectable()
export class WalletCommandConsumer {
  constructor(private readonly debit: DebitWalletUseCase) {}

  @IdempotentSubscribe({
    consumerName: "wallets.wallet.commands.debit",
    exchange: "wallet.commands",
    routingKey: "wallet.debit",
    queue: "wallet.commands.q",
  })
  async handle(envelope: DomainEventEnvelope<DebitCommandPayload>): Promise<void> {
    await this.debit.execute(envelope.payload, envelope);
  }
}
```
The decorator does NOT call `channel.ack` directly — it returns `undefined` (success) or a `Nack` instance to the underlying golevelup machinery, per [VERIFIED: @golevelup/nestjs-rabbitmq docs] which explicitly states "Do not attempt to call channel.ack() or channel.nack() directly from the handler — use the Nack return value instead."

### Pattern 3: Polling publisher with LISTEN/NOTIFY wake

**What:** A NestJS injectable that runs a `setTimeout`-driven poll loop (NOT `setInterval` — see PITFALLS-derived rationale below), claims a batch with `FOR UPDATE SKIP LOCKED`, publishes with `confirmSelect` + `waitForConfirms`, marks processed in the same TX as the claim. A separate `pg` LISTEN client wakes the poller on `pg_notify('outbox_new_message')` fired by a Postgres trigger on `INSERT INTO outbox`.

**When to use:** One instance per service. Multi-instance later → leader election via `pg_try_advisory_lock` (deferred to Phase 5 design; not implemented).

**Why polling + LISTEN/NOTIFY (not just LISTEN/NOTIFY):** NOTIFY is best-effort — a listener that just lost the connection or restarted misses notifications between sessions. The 1s polling baseline guarantees forward progress even if NOTIFY is missed; LISTEN/NOTIFY just compresses the latency from 1s to single-digit ms when it works. [VERIFIED: PostgreSQL LISTEN/NOTIFY semantics; see the Jus DB and ThinhDA writeups confirming the "outbox + NOTIFY = at-least-once wake" pattern.]

### Pattern 4: Topology assertion at service startup

**What:** `OnApplicationBootstrap` runs `assertExchange` + `assertQueue` + `bindQueue` for every exchange/queue this service owns. Idempotent — declaring an existing exchange with identical args is a no-op; declaring with different args throws (which is correct — surfaces drift).

**When to use:** Phase 2 ships only the spine; Phase 3+ services declare their concrete exchanges/queues by passing a `TopologyConfig` to `MessagingSpineModule.forRootAsync({ topology: ... })`.

**Why startup assertion over `definitions.json` mounted into RabbitMQ:** Portability — `docker compose down -v && bun run docker:up` works identically because the services re-assert on boot. A mounted definitions file requires a separate operational change to add a new queue. Bonus: tests against testcontainers' fresh broker don't need a definitions file plumbed in.

### Anti-Patterns to Avoid

- **Two separate operations (`await save(); await publish();`)** — the classic dual-write. Will lose events on `kill -9` between the two awaits.
- **`channel.publish` without `confirmSelect`** — publish returns immediately even when the broker drops the message. Silently violates at-least-once.
- **`{ noAck: true }` on consumer** — message lost if consumer crashes between receive and handler.
- **Inbox dedup row inserted *before* the TX** — leaves an orphan inbox row if the handler throws and the TX rolls back. Insert it INSIDE the same TX as the side-effect.
- **One channel for everything** — share a connection across the service, but use a separate channel for publishing vs. each consumer subscription. Channel errors are local; you don't want a consumer error to kill the publisher.
- **MikroORM connection used for LISTEN** — LISTEN blocks the connection; MikroORM's pool will starve. Use a dedicated `pg` Client.
- **`setInterval` for the poll loop** — drifts under load; queues up missed ticks. Use recursive `setTimeout` (same justification as `RoundLoopService` in ARCHITECTURE.md §6.2).
- **DLQ without its own `x-delivery-limit`** — a poison message that fails further routing in the DLQ loops forever. PITFALLS C4 documents this has taken down clusters; apply `x-delivery-limit=3` to the DLQ itself.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AMQP connection lifecycle (reconnect, heartbeat) | Custom connection manager | `@golevelup/nestjs-rabbitmq`'s `RabbitMQModule` for the consumer side; for publisher, lean on the connection it manages and grab a confirm channel via `amqpConnection.createChannel({ name: 'outbox-publisher', confirm: true })` | Hand-rolling reconnect with exponential backoff for every channel/queue is ~150 LOC of pain that golevelup has battle-tested. |
| AsyncLocalStorage wiring + NestJS request scope | Bespoke ALS provider | `nestjs-cls` | Maintained, plugs into request interceptor automatically, ships ClsPluginTransactional we'll reuse in Phase 5 |
| AMQP message buffer/envelope serialization | Custom `Buffer.from(JSON.stringify(...))` everywhere | A single `serializeEnvelope` / `parseEnvelope` pair in `@crash/messaging-spine/envelope` | One place to add BigInt-safe JSON handling, header propagation, schema versioning. |
| UUID v4 generation | `crypto.randomUUID()` everywhere | `uuid` v4 helper | `crypto.randomUUID()` is fine but `uuid` gives `v7` (k-sortable) which we may use for `outbox.id` to ease ordered claim queries. |
| Postgres LISTEN client wrapper | Inline `pg.Client.on('notification', ...)` | A dedicated `OutboxListenerService` that owns reconnect-and-resubscribe | LISTEN sessions die silently on connection drop; the listener must reconnect and re-LISTEN — wrap once. |

**Key insight:** The hand-rolled artifacts in Phase 2 are exactly the things recruiters look for in arguição — the outbox row + confirm channel + inbox dedup + DLQ-with-its-own-limit. Everything operationally tangential (connection mgmt, ALS plumbing) goes to libraries.

---

## Runtime State Inventory

Not strictly a rename/refactor phase, but Phase 2 introduces new persistent and runtime state that the planner must account for explicitly:

| Category | Items Introduced | Action Required |
|----------|------------------|------------------|
| Stored data | New tables in BOTH `games` and `wallets` Postgres DBs: `outbox`, `inbox`, `dead_letter_messages`. Trigger `outbox_notify_trigger` on `INSERT INTO outbox` firing `pg_notify('outbox_new_message', NEW.id::text)`. | Two MikroORM migrations per service (one for the three tables, one for the trigger). Migration containers from Phase 1 (`games-migrate`, `wallets-migrate`) run them. |
| Live service config | RabbitMQ exchanges (`wallet.commands`, `wallet.events`, `wallet.dlx`, `game.events`, `game.dlx`) and queues (`wallet.commands.q`, `wallet.dlq`, `games.wallet-events.q`, `games.dlq`) are NOT exported to git; they're asserted at service startup. | Document the topology contract in `@crash/messaging-spine`'s `topology-defaults.ts`. Services pass a `TopologyConfig` to module options. A `docker compose down -v` removes everything; bringing the stack back up re-asserts cleanly. |
| OS-registered state | None. | None. |
| Secrets / env vars | New env var per service: `OUTBOX_POLL_INTERVAL_MS` (default 1000), `RMQ_DELIVERY_LIMIT_MAIN` (5), `RMQ_DELIVERY_LIMIT_DLQ` (3) — already in `REQUIREMENTS.md` Open Configuration Values; add to each service's typed `defaults.ts`. Also: `RABBITMQ_URL` (already present in Phase 1 env schema). | Update `services/games/src/config/defaults.ts` and `services/wallets/src/config/defaults.ts` to include the three new env keys, and `.env.example` files at each service root. |
| Build artifacts / installed packages | New workspace package `@crash/messaging-spine` linked from both services. New direct deps on `amqplib`, `@golevelup/nestjs-rabbitmq`, `nestjs-cls`, `pg`. | `bun install` after package adds; verify each service's `node_modules/@crash/messaging-spine` symlinks correctly into the workspace package. |

**Nothing destructive** — Phase 2 is purely additive. No file renames, no existing table touched.

---

## Common Pitfalls

### Pitfall 1: LISTEN connection silently dies on broker restart, poller falls back to 1s polling forever
**What goes wrong:** Postgres LISTEN sessions don't survive a Postgres restart or a TCP idle timeout (NAT/load-balancer). The client never gets an error event for some failure modes — notifications just stop arriving.
**Why it happens:** LISTEN is tied to the session; PG drops the subscription on disconnect; node-postgres may not surface the disconnect immediately.
**How to avoid:** `OutboxListenerService` registers `client.on('end')`, `client.on('error')` AND a watchdog timer that pings (`SELECT 1`) every 30s. On any signal, dispose the client, reconnect, re-issue `LISTEN`, log a warning. Document the 1s polling baseline as the safety net.
**Warning signs:** Publish latency creeps back up to 1s+ even though metrics show LISTEN client is "connected."

### Pitfall 2: `waitForConfirms` resolves before all messages are confirmed when batch size is unbounded
**What goes wrong:** A large batch (1000+ rows) can exceed the broker's in-flight unconfirmed window, leading to slow confirms and ambiguous error states.
**Why it happens:** `waitForConfirms` waits for ALL outstanding confirms on the channel — if one nacks, the promise rejects but you don't know which message.
**How to avoid:** Bound the batch to a reasonable size (recommend `OUTBOX_POLL_BATCH_SIZE=100`, env-tunable). On confirm-promise rejection, re-claim that batch (those rows stay PENDING because we mark them processed only AFTER successful confirm). Track per-message confirms via the channel's `ack`/`nack` events for finer-grained outcomes — but only if metrics show batch-level retries are hurting throughput.
**Warning signs:** Outbox row stuck in PENDING after broker hiccup; `attempts` column inching up across the batch.

### Pitfall 3: Inbox dedup races against handler completion on broker redelivery
**What goes wrong:** Consumer A starts processing message M, inserts inbox row (uncommitted), and the channel times out before commit. Broker redelivers M to Consumer B; B sees no inbox row (A's INSERT not yet visible because TX uncommitted), starts processing, then A commits — both side-effects ran.
**Why it happens:** Uncommitted INSERTs are invisible to other transactions. The TX boundary IS the dedup window.
**How to avoid:** The inbox INSERT must be the FIRST statement inside the TX, on a unique constraint `(consumer_name, message_id)`. Postgres's row-level lock on the unique constraint check serializes the two TXs — the second one blocks until the first commits, then immediately conflicts and rolls back. Use `INSERT ... ON CONFLICT (consumer_name, message_id) DO NOTHING RETURNING id` — empty result means duplicate; non-empty means we own it.
**Warning signs:** Property test shows `Transaction` rows = 2 when we expect 1 after a redelivery.

### Pitfall 4: `x-delivery-limit` not applied to the DLQ itself → poison loops
**What goes wrong:** A poison message lands in the DLQ. The dead-letter consumer fails (e.g., DB unreachable). Without a limit on the DLQ, the message redelivers forever; broker memory grows; cluster degrades.
**Why it happens:** Default RabbitMQ behavior — quorum queues need explicit `x-delivery-limit`; DLQs are often misconfigured as classic queues with no limit.
**How to avoid:** Declare DLQs as quorum queues with `x-delivery-limit=3` and `x-queue-type=quorum`. Final dead-letter handler is the `DeadLetterConsumer` — it INSERTs into `dead_letter_messages` Postgres table, then acks. Document in ADR-009.
**Warning signs:** RabbitMQ management UI shows DLQ with growing redelivery counts on the same messages.

### Pitfall 5: NestJS module instantiation order — `OutboxPublisher` starts polling before MikroORM is ready
**What goes wrong:** `OutboxPublisher.onModuleInit` fires before `MikroOrmModule` is fully initialized; first poll throws "EntityManager not ready."
**Why it happens:** NestJS doesn't enforce strict module init ordering unless you declare module dependencies.
**How to avoid:** `MessagingSpineModule` `imports: [MikroOrmModule]` explicitly. Use `onApplicationBootstrap` (fires AFTER all `onModuleInit`) for the topology assert + LISTEN client connect + polling start, not `onModuleInit`.
**Warning signs:** `EntityManager is not initialized` on first poll after fresh start.

### Pitfall 6: Bun's `setTimeout` returns a `Timer`, not a `NodeJS.Timeout` — clearing it across hot-reload breaks
**What goes wrong:** TypeScript types narrow to `NodeJS.Timeout`; Bun returns its own `Timer`. `clearTimeout(timer)` works at runtime but a stored reference may be incorrectly typed.
**Why it happens:** Bun's typing.
**How to avoid:** Type the stored handle as `ReturnType<typeof setTimeout>` rather than `NodeJS.Timeout`. Watched by typecheck.
**Warning signs:** TypeScript error in `OutboxPublisher` when storing the timer; hot-reload leaks timers.

### Pitfall 7: Quorum queue declarations conflict between services that share a queue name accidentally
**What goes wrong:** Service A asserts `wallet.commands.q` as quorum with delivery-limit=5; service B (typo) asserts as classic. Second assertion throws `PRECONDITION_FAILED`.
**Why it happens:** RabbitMQ rejects asserts that don't match existing topology.
**How to avoid:** All queue/exchange names declared in a SINGLE place: `@crash/messaging-spine/topology-defaults.ts` exports constants like `WALLET_COMMANDS_QUEUE = 'wallet.commands.q'`. Services import constants, never string literals.
**Warning signs:** `PRECONDITION_FAILED` in service logs on second-service startup.

### Pitfall 8: `correlationId` not propagated when publisher reads from CLS but the call site is OUTSIDE a request handler (e.g., the round loop's scheduled tick)
**What goes wrong:** `cls.get('correlationId')` returns `undefined` because the round loop runs outside any HTTP/AMQP entry that would have populated CLS.
**Why it happens:** AsyncLocalStorage is scoped to the async chain that originated in a request; scheduled tasks don't inherit.
**How to avoid:** Provide a `withMessagingContext({ correlationId, causationId }, fn)` helper that explicitly opens a CLS scope. The round loop wraps each tick in it. Document the rule: "Anywhere you publish from outside an inbound handler, wrap in `withMessagingContext`."
**Warning signs:** Outbox rows with `correlationId: null`; logs cannot trace round-loop-originated events.

---

## Code Examples

Verified patterns from official sources, adapted to our stack.

### Outbox table DDL (concrete, copy-into-migration)

```sql
-- migration: 20260524_001_create_outbox.sql (per service)
CREATE TABLE outbox (
  id                BIGSERIAL    PRIMARY KEY,
  message_id        UUID         NOT NULL UNIQUE,
  aggregate_type    TEXT         NOT NULL,
  aggregate_id      TEXT         NOT NULL,
  event_type        TEXT         NOT NULL,
  event_version     INT          NOT NULL DEFAULT 1,
  exchange          TEXT         NOT NULL,
  routing_key       TEXT         NOT NULL,
  payload           JSONB        NOT NULL,
  headers           JSONB        NOT NULL,             -- correlationId, causationId, occurredAt
  status            TEXT         NOT NULL DEFAULT 'PENDING'
                                 CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempts          INT          NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  published_at      TIMESTAMPTZ,
  last_attempt_at   TIMESTAMPTZ
);

-- Partial index for the poller's batch claim — keeps the index tiny
CREATE INDEX outbox_pending_idx
  ON outbox (created_at)
  WHERE status = 'PENDING';

-- Trigger: notify on every insert to wake the LISTEN client
CREATE OR REPLACE FUNCTION outbox_notify_fn() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox_new_message', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outbox_notify_trigger
  AFTER INSERT ON outbox
  FOR EACH ROW
  EXECUTE FUNCTION outbox_notify_fn();
```

Source for the trigger + NOTIFY pattern: [VERIFIED: PostgreSQL NOTIFY docs](https://www.postgresql.org/docs/current/sql-notify.html); confirmed across multiple 2026 writeups (Jus DB, ThinhDA). The trigger fires inside the same transaction as the INSERT, so NOTIFY is only delivered to listeners after the commit succeeds (Postgres documented behavior). [VERIFIED]

**Why `status` is a `TEXT` + `CHECK` constraint not a PG enum:** MikroORM 7's enum mapping requires schema-level enum types whose evolution (adding a value) is painful (`ALTER TYPE ... ADD VALUE` is non-transactional in older PG). A `TEXT` + `CHECK` is trivially evolved with one migration. [CITED: MikroORM enum mapping caveats]

### Inbox table DDL

```sql
-- migration: 20260524_002_create_inbox.sql (per service)
CREATE TABLE inbox (
  consumer_name   TEXT         NOT NULL,
  message_id      UUID         NOT NULL,
  message_type    TEXT         NOT NULL,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  payload_hash    TEXT,                          -- optional SHA-256 of payload for audit
  PRIMARY KEY (consumer_name, message_id)
);

CREATE INDEX inbox_received_at_idx ON inbox (received_at);
```

**Why composite PK `(consumer_name, message_id)`:** A single service can host multiple consumers (a projector + a side-effect handler) that both must see the same message. Per-consumer dedup is the only correct model. Confirmed in ARCHITECTURE.md §5.3 and the axotion / Iwanczyszyn writeups in PITFALLS sources.

### Dead-letter table DDL

```sql
-- migration: 20260524_003_create_dead_letter_messages.sql (per service)
CREATE TABLE dead_letter_messages (
  id                BIGSERIAL    PRIMARY KEY,
  original_message_id UUID       NOT NULL,
  original_exchange   TEXT       NOT NULL,
  original_routing_key TEXT      NOT NULL,
  original_queue      TEXT       NOT NULL,
  consumer_name       TEXT       NOT NULL,
  headers             JSONB      NOT NULL,        -- includes x-death array
  payload             JSONB      NOT NULL,
  error_class         TEXT,                       -- optional: last handler error class
  error_message       TEXT,                       -- optional: last handler error message
  redelivery_count    INT        NOT NULL,        -- from x-death header
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consumer_name, original_message_id)
);

CREATE INDEX dead_letter_received_at_idx ON dead_letter_messages (received_at DESC);
```

The `UNIQUE (consumer_name, original_message_id)` guards against the DLQ itself redelivering before we ack — same idempotency principle as inbox.

### RabbitMQ topology (TypeScript declaration in `@crash/messaging-spine/topology-defaults.ts`)

```typescript
// Constants — single source of truth, services import these
export const EXCHANGES = {
  WALLET_COMMANDS: "wallet.commands",   // direct, durable
  WALLET_EVENTS:   "wallet.events",     // topic,  durable
  GAME_EVENTS:     "game.events",       // topic,  durable
  WALLET_DLX:      "wallet.dlx",        // fanout, durable (DLX)
  GAME_DLX:        "game.dlx",          // fanout, durable (DLX)
} as const;

export const QUEUES = {
  WALLET_COMMANDS:    "wallet.commands.q",
  GAMES_WALLET_EVENTS: "games.wallet-events.q",
  WALLET_DLQ:         "wallet.dlq",
  GAMES_DLQ:          "games.dlq",
} as const;

export function buildQuorumArgs(deliveryLimit: number, dlxName?: string) {
  const args: Record<string, unknown> = {
    "x-queue-type": "quorum",
    "x-delivery-limit": deliveryLimit,
  };
  if (dlxName) {
    args["x-dead-letter-exchange"] = dlxName;
  }
  return args;
}

// Service A (wallets) asserts at boot:
// channel.assertExchange(EXCHANGES.WALLET_COMMANDS, 'direct', { durable: true });
// channel.assertExchange(EXCHANGES.WALLET_DLX,      'fanout', { durable: true });
// channel.assertQueue(QUEUES.WALLET_COMMANDS, { durable: true, arguments: buildQuorumArgs(5, EXCHANGES.WALLET_DLX) });
// channel.assertQueue(QUEUES.WALLET_DLQ,      { durable: true, arguments: buildQuorumArgs(3) /* no further DLX — terminal */ });
// channel.bindQueue(QUEUES.WALLET_COMMANDS, EXCHANGES.WALLET_COMMANDS, 'wallet.debit');
// channel.bindQueue(QUEUES.WALLET_COMMANDS, EXCHANGES.WALLET_COMMANDS, 'wallet.credit');
// channel.bindQueue(QUEUES.WALLET_DLQ,      EXCHANGES.WALLET_DLX,      '');
```

Sources: [VERIFIED: RabbitMQ Quorum Queues docs](https://www.rabbitmq.com/docs/quorum-queues) — `x-queue-type: quorum`, `x-delivery-limit` are the canonical quorum args; [VERIFIED: RabbitMQ DLX docs](https://www.rabbitmq.com/docs/dlx) — `x-dead-letter-exchange` is the queue arg, the DLX is bound to the DLQ by routing key; PITFALLS C4 explicitly requires `x-delivery-limit` on both queues.

### Polling publisher pseudocode (~60 lines)

```typescript
@Injectable()
export class OutboxPublisher implements OnApplicationBootstrap, OnApplicationShutdown {
  private channel?: ConfirmChannel;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private wakeRequested = false;

  constructor(
    private readonly em: EntityManager,
    private readonly amqp: AmqpConnection,                 // from @golevelup/nestjs-rabbitmq
    private readonly listener: OutboxListenerService,      // dedicated pg LISTEN client
    @Inject(MESSAGING_OPTIONS) private readonly opts: MessagingOptions,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.channel = await this.amqp.connection.createConfirmChannel();
    this.listener.onNotification(() => { this.wakeRequested = true; });
    this.running = true;
    this.scheduleNext(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.channel) {
      await this.channel.waitForConfirms().catch(() => {});  // drain
      await this.channel.close();
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.tick().catch((err) => this.logger.error(err)), delayMs);
  }

  private async tick(): Promise<void> {
    const batchSize = this.opts.batchSize;                  // e.g. 100
    const baseDelay = this.opts.pollIntervalMs;             // e.g. 1000

    try {
      const published = await this.em.transactional(async (em) => {
        // 1) Claim a batch with FOR UPDATE SKIP LOCKED
        const rows = await em.getConnection().execute<OutboxRow[]>(
          `SELECT * FROM outbox
            WHERE status = 'PENDING'
            ORDER BY created_at
            LIMIT ?
            FOR UPDATE SKIP LOCKED`,
          [batchSize],
        );
        if (rows.length === 0) return 0;

        // 2) Publish each via confirm channel
        for (const row of rows) {
          this.channel!.publish(
            row.exchange,
            row.routing_key,
            Buffer.from(JSON.stringify(row.payload)),
            {
              messageId: row.message_id,
              type: row.event_type,
              contentType: "application/json",
              persistent: true,
              headers: row.headers,                          // includes correlationId, causationId, occurredAt
            },
          );
        }

        // 3) Wait for confirms — throws on nack
        await this.channel!.waitForConfirms();

        // 4) Mark processed
        const ids = rows.map((r) => r.id);
        await em.getConnection().execute(
          `UPDATE outbox SET status = 'PUBLISHED', published_at = now()
            WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids,
        );

        return rows.length;
      });

      const wakeOrFollowup = this.wakeRequested || published === batchSize;
      this.wakeRequested = false;
      this.scheduleNext(wakeOrFollowup ? 0 : baseDelay);
    } catch (err) {
      // On error: increment attempts on the claimed batch (best-effort), back off
      this.logger.error("outbox publish failed", err);
      this.scheduleNext(baseDelay);
    }
  }
}
```

Sources: [VERIFIED: amqplib channel API](https://amqp-node.github.io/amqplib/channel_api.html) for `createConfirmChannel`, `publish`, `waitForConfirms`; [VERIFIED: RabbitMQ publisher confirms tutorial](https://www.rabbitmq.com/tutorials/tutorial-seven-java) for the "confirm once, wait per batch" pattern; [VERIFIED: PostgreSQL FOR UPDATE SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE) for the batch claim semantics. The MikroORM `em.transactional` wrapping the entire claim+publish+mark sequence is essential — if `waitForConfirms` throws or the process dies, the claim rolls back and rows return to PENDING for the next poll. [CITED: MikroORM Transactions and Concurrency docs]

### Idempotent consumer wrapper (pseudocode)

```typescript
// inbox/idempotent-subscribe.decorator.ts
export interface IdempotentSubscribeOptions {
  consumerName: string;
  exchange: string;
  routingKey: string;
  queue: string;
}

export function IdempotentSubscribe(opts: IdempotentSubscribeOptions): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const original = descriptor.value as Function;

    descriptor.value = async function (envelope: DomainEventEnvelope, msg: ConsumeMessage) {
      const em = (this as any).em as EntityManager;        // injected on the consumer class
      const inboxRepo = em.getRepository(InboxMessage);
      const cls = (this as any).cls as ClsService;

      return cls.run(async () => {
        cls.set("correlationId", envelope.correlationId);
        cls.set("causationId",   envelope.messageId);

        return em.transactional(async (txEm) => {
          // INSERT ... ON CONFLICT DO NOTHING
          const inserted = await txEm.getConnection().execute(
            `INSERT INTO inbox (consumer_name, message_id, message_type, received_at)
             VALUES (?, ?, ?, now())
             ON CONFLICT (consumer_name, message_id) DO NOTHING
             RETURNING message_id`,
            [opts.consumerName, envelope.messageId, envelope.type],
          );
          if (inserted.length === 0) {
            // Duplicate — already processed, ack and skip
            return;
          }

          // Run the user's handler inside this TX
          await original.call(this, envelope, msg);

          await txEm.getConnection().execute(
            `UPDATE inbox SET processed_at = now()
             WHERE consumer_name = ? AND message_id = ?`,
            [opts.consumerName, envelope.messageId],
          );
        });
        // ack happens automatically when handler returns (golevelup default)
      });
    };

    // Forward to the real golevelup decorator with the same args
    return RabbitSubscribe({
      exchange: opts.exchange,
      routingKey: opts.routingKey,
      queue: opts.queue,
      queueOptions: {
        durable: true,
        arguments: buildQuorumArgs(5, deriveDlxFromExchange(opts.exchange)),
      },
    })(target, propertyKey, descriptor);
  };
}
```

Sources: [VERIFIED: @golevelup/nestjs-rabbitmq docs](https://golevelup.github.io/nestjs/modules/rabbitmq.html) — "Do not attempt to call channel.ack()/nack() directly; return Nack instance or undefined". The decorator wraps `RabbitSubscribe` so consumers stay declarative.

### Correlation/causation context with `nestjs-cls`

```typescript
// context/messaging-cls.ts
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
              const incoming = req.headers["x-correlation-id"] ?? req.headers["x-request-id"];
              cls.set("correlationId", incoming ?? cls.getId());
            },
          },
        }),
      ],
      exports: [ClsModule],
    };
  }
}

// Helper for non-request contexts (round loop ticks, recovery scans, etc.)
export async function withMessagingContext<T>(
  cls: ClsService,
  ctx: { correlationId: string; causationId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return cls.run(async () => {
    cls.set("correlationId", ctx.correlationId);
    if (ctx.causationId) cls.set("causationId", ctx.causationId);
    return fn();
  });
}
```

Source: [VERIFIED: nestjs-cls docs](https://papooch.github.io/nestjs-cls/) — `ClsModule.forRoot({ middleware: { setup } })` is the canonical HTTP entry point. The `withMessagingContext` helper is project-local — covers the case PITFALLS-derived (round loop runs outside a request).

---

## `@crash/messaging-spine` public API surface

```typescript
// packages/messaging-spine/src/index.ts
export { MessagingSpineModule, type MessagingSpineOptions } from "./module";

// Outbox
export { OutboxMessage } from "./outbox/outbox-message.entity";
export { OutboxRepository } from "./outbox/outbox-repository";
export { OutboxStatus } from "./outbox/outbox-status";
// (OutboxPublisher is internal — not exported)

// Inbox
export { InboxMessage } from "./inbox/inbox-message.entity";
export { IdempotentSubscribe, type IdempotentSubscribeOptions } from "./inbox/idempotent-subscribe.decorator";

// Dead-letter
export { DeadLetterMessage } from "./dead-letter/dead-letter-message.entity";

// Envelope helpers
export { buildEnvelope, parseEnvelope, type EnvelopeBuildOptions } from "./envelope/build-envelope";

// Topology
export {
  EXCHANGES,
  QUEUES,
  buildQuorumArgs,
  type TopologyConfig,
} from "./topology/topology-defaults";

// CLS helpers
export { withMessagingContext } from "./context/messaging-cls";
export { CORRELATION_ID_KEY, CAUSATION_ID_KEY } from "./context/correlation-tokens";
```

### How services consume it

```typescript
// services/wallets/src/app.module.ts
@Module({
  imports: [
    MikroOrmModule.forRoot(),
    MessagingSpineModule.forRootAsync({
      useFactory: (env: WalletsEnv) => ({
        amqpUrl: env.RABBITMQ_URL,
        databaseUrl: env.DATABASE_URL,
        outbox: {
          pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
          batchSize: 100,
        },
        topology: {
          exchangesToAssert: [EXCHANGES.WALLET_COMMANDS, EXCHANGES.WALLET_EVENTS, EXCHANGES.WALLET_DLX],
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

---

## Testing Approach

### Unit tests (live in `packages/messaging-spine/tests/unit/`)
- `buildEnvelope` returns a valid `DomainEventEnvelope` with all required fields when given a payload
- `parseEnvelope` round-trips JSON.stringify ↔ parse losslessly
- `buildQuorumArgs(5)` returns `{ "x-queue-type": "quorum", "x-delivery-limit": 5 }`
- `buildQuorumArgs(5, "wallet.dlx")` adds `"x-dead-letter-exchange": "wallet.dlx"`
- `IdempotentSubscribe` decorator wraps `RabbitSubscribe` and preserves method signature (smoke test with a stubbed handler)

### Integration tests (live in `packages/messaging-spine/tests/integration/`, run only when `INTEGRATION=1`)
Use `testcontainers` Node port (`@testcontainers/postgresql` + `@testcontainers/rabbitmq`) to spin isolated Postgres + RabbitMQ per test suite. Each test suite gets its own broker so DLQ behavior doesn't leak across tests.

| Test | Scenario | Asserts |
|------|----------|---------|
| outbox-write-and-publish.test.ts | Insert MessagingProbe row + outbox row in same TX, run one poll cycle | Outbox row transitions to PUBLISHED; message arrives at queue with all envelope fields intact |
| inbox-dedup.test.ts | Publish same messageId twice (simulating broker redelivery), consumer is `@IdempotentSubscribe` | Handler called exactly once; inbox row count = 1; `processed_at` set |
| kill-9-recovery.test.ts | Spawn publisher child process, kill it with `SIGKILL` between COMMIT and `waitForConfirms`, then start a fresh publisher in the parent process | After restart, message published exactly once; `MessagingProbe` side-effect count = 1 (via inbox) |
| poison-message.test.ts | Publish message whose handler always throws; consumer nacks without requeue | After 5 redeliveries on main, 3 on DLQ, `dead_letter_messages` has one row; broker queues are empty |
| listen-notify-wake.test.ts | Insert row, measure time from insert to publish | < 250ms (success criterion); falls back to 1s polling if notify miss simulated |
| envelope-headers.test.ts | Publish from CLS context with `correlationId`, consumer extracts | Inbound CLS context has same `correlationId`; downstream outbox row carries `causationId` = upstream messageId |

### Phase 2 specifically does NOT ship a domain — solving the chicken-and-egg

**Recommendation: Option B** from research question 7 — ship a tiny `MessagingProbe` aggregate used ONLY in integration tests.

```typescript
// packages/messaging-spine/tests/integration/_helpers/messaging-probe.entity.ts
@Entity({ tableName: "messaging_probe" })
export class MessagingProbe {
  @PrimaryKey() id!: string;
  @Property() label!: string;
  @Property({ default: 0 }) sideEffectCount!: number;
}
```

The probe entity lives in test-only files; the MikroORM config used in tests includes it; production configs don't. The migration for `messaging_probe` is also test-only (loaded by the test harness before each suite). This keeps Phase 2 free of any domain concept while still enabling provable end-to-end tests.

**Rejected options:**
- Option A (test aggregate in production, removed in Phase 3) — risk that a teardown migration is forgotten
- Option C (defer integration testing to Phase 3) — leaves Phase 2 success criteria unverifiable in isolation; recruiter cannot see the spine working without the wallet

---

## Migration Plan

| Service | Migration | Contents |
|---------|-----------|----------|
| games | `20260524_001_create_outbox.ts` | outbox table + index + notify trigger |
| games | `20260524_002_create_inbox.ts` | inbox table + indexes |
| games | `20260524_003_create_dead_letter_messages.ts` | dead_letter_messages table + indexes |
| wallets | `20260524_001_create_outbox.ts` | identical to games |
| wallets | `20260524_002_create_inbox.ts` | identical to games |
| wallets | `20260524_003_create_dead_letter_messages.ts` | identical to games |

**Shared SQL fragments:** The three migrations are byte-identical across services. Recommend `packages/messaging-spine/src/migrations/shared/*.sql` as the source of truth; each service's migration file imports and executes the fragment via `fs.readFileSync`. This keeps the DDL in one place without coupling MikroORM migration runners across services.

**Migration container reuse:** No changes to `games-migrate` / `wallets-migrate` from Phase 1 — they run `bunx mikro-orm migration:up` and pick up the new migration files automatically.

---

## What's deferred to Phase 10

| Capability | Reason | Phase to land |
|------------|--------|---------------|
| Outbox archival (move PUBLISHED rows older than 30d to cold storage) | Optimization, not correctness | Phase 10 |
| Inbox cleanup (TTL on processed rows) | Operational hygiene | Phase 10 |
| Metrics: `outbox_pending_messages`, `inbox_processed_total`, `dlq_depth`, publish lag histogram | OTel infra ships in Phase 10 | Phase 10 |
| Per-message confirm tracking (ack/nack per messageId) | Only needed if batch-level retries cause throughput issues; defer until measured | Phase 10 if needed |
| OpenTelemetry `traceparent` header propagation through AMQP | OTel infra is Phase 10 | Phase 10 |
| Dead-letter replay endpoint / parking-lot UI | Operator feature, not core correctness | Phase 10 or stretch |
| HMAC-signed message envelopes | Closed-network play-money trust model is sufficient | Never (documented as out-of-scope in ARCHITECTURE.md §11) |
| Saga state persistence (`bet_saga_state`) | Different concern; saga lives on top of the spine | Phase 5 |
| Outbox sharding by aggregate type | Not needed at single-instance scale | Never |
| Leader election (`pg_try_advisory_lock`) for multi-instance publisher | Out of scope per spec | Documented in ADR-009; deferred indefinitely |

---

## Order of Execution (suggested plan-list with dependencies)

```
P2.1  Create @crash/messaging-spine workspace package skeleton
      └─ package.json, tsconfig, src/index.ts barrel, empty subfolders

P2.2  Verify-and-install dependencies (checkpoint:human-verify per package)
      └─ amqplib, @types/amqplib, @golevelup/nestjs-rabbitmq, nestjs-cls, pg, @types/pg, uuid, @types/uuid
      └─ DEPENDS ON: P2.1

P2.3  Outbox / inbox / dead-letter MikroORM entities + shared SQL fragments
      └─ src/outbox/outbox-message.entity.ts, src/inbox/inbox-message.entity.ts, src/dead-letter/dead-letter-message.entity.ts
      └─ src/migrations/shared/*.sql
      └─ DEPENDS ON: P2.1

P2.4  Envelope helpers + topology defaults
      └─ src/envelope/build-envelope.ts, src/topology/topology-defaults.ts, src/topology/topology-config.ts (zod schema)
      └─ DEPENDS ON: P2.1

P2.5  nestjs-cls integration + withMessagingContext helper
      └─ src/context/messaging-cls.ts, src/context/correlation-tokens.ts
      └─ DEPENDS ON: P2.2

P2.6  OutboxRepository + dedicated OutboxListenerService (pg LISTEN client)
      └─ src/outbox/outbox-repository.ts, src/outbox/outbox-listener.service.ts
      └─ DEPENDS ON: P2.2, P2.3

P2.7  OutboxPublisher (the polling loop + confirm channel)
      └─ src/outbox/outbox-publisher.service.ts
      └─ DEPENDS ON: P2.6, P2.5

P2.8  InboxRepository + @IdempotentSubscribe decorator
      └─ src/inbox/inbox-repository.ts, src/inbox/idempotent-subscribe.decorator.ts
      └─ DEPENDS ON: P2.2, P2.3, P2.5

P2.9  DeadLetterConsumer + DeadLetterRepository
      └─ src/dead-letter/dead-letter-consumer.service.ts, src/dead-letter/dead-letter-repository.ts
      └─ DEPENDS ON: P2.2, P2.3

P2.10 MessagingSpineModule (forRoot/forRootAsync) + TopologyBootstrap (asserts on OnApplicationBootstrap)
      └─ src/module.ts, src/topology/topology-bootstrap.service.ts
      └─ DEPENDS ON: P2.4, P2.6, P2.7, P2.8, P2.9

P2.11 Generate MikroORM migrations in services/games and services/wallets that copy the shared SQL fragments
      └─ services/games/src/infrastructure/mikro-orm/migrations/2026052400{1,2,3}.ts
      └─ services/wallets/src/infrastructure/mikro-orm/migrations/2026052400{1,2,3}.ts
      └─ Register OutboxMessage, InboxMessage, DeadLetterMessage entities in each mikro-orm.config.ts
      └─ DEPENDS ON: P2.3, P2.10

P2.12 Wire MessagingSpineModule into services/games AppModule and services/wallets AppModule
      └─ Pass per-service TopologyConfig
      └─ Extend services/*/src/config/defaults.ts with OUTBOX_POLL_INTERVAL_MS, RMQ_DELIVERY_LIMIT_MAIN/DLQ
      └─ DEPENDS ON: P2.10, P2.11

P2.13 MessagingProbe test aggregate + integration test harness (testcontainers)
      └─ packages/messaging-spine/tests/integration/_helpers/{messaging-probe.entity.ts, harness.ts}
      └─ DEPENDS ON: P2.10

P2.14 Integration tests (6 scenarios from §Testing Approach)
      └─ outbox-write-and-publish, inbox-dedup, kill-9-recovery, poison-message, listen-notify-wake, envelope-headers
      └─ DEPENDS ON: P2.13

P2.15 Unit tests for envelope helpers, topology helpers, IdempotentSubscribe smoke
      └─ packages/messaging-spine/tests/unit/*.test.ts
      └─ DEPENDS ON: P2.4, P2.8

P2.16 ADR-007 (hand-rolled outbox/inbox), ADR-008 (amqplib + golevelup split), ADR-009 (DLX-with-delivery-limit-on-DLQ)
      └─ .planning/adrs/ADR-007*.md, ADR-008*.md, ADR-009*.md
      └─ DEPENDS ON: P2.10 (decisions need code to point to)

P2.17 docker:up smoke check — both services start, topology assertions succeed, healthchecks green, /metrics or logs show "outbox publisher started"
      └─ DEPENDS ON: P2.12
```

**Parallelization windows:** P2.3, P2.4, P2.5 can run in parallel after P2.1+P2.2. P2.6, P2.8, P2.9 can run in parallel after their respective deps. P2.14 and P2.15 are independent of each other.

---

## Phase 2 Risks (specific to this phase)

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | LISTEN/NOTIFY client silently dead after Postgres restart, no error event | MEDIUM | MEDIUM (latency degrades, no correctness impact) | Watchdog `SELECT 1` every 30s in `OutboxListenerService`; on any error, dispose + reconnect + re-LISTEN |
| R2 | `waitForConfirms` rejects with no per-message granularity → entire batch re-claimed | LOW (small batches) | LOW (re-publish is idempotent on consumer) | Bound batch to 100; log batch retry counts; add per-message tracking only if measured throughput issue |
| R3 | testcontainers spin-up adds 5-10s per integration suite → slow CI | MEDIUM | LOW | Single broker shared across tests within a suite; isolated PG per suite; gate full integration set behind `INTEGRATION=1` |
| R4 | `INSERT ... ON CONFLICT` race in inbox under high concurrency | LOW | MEDIUM (would cause double side-effect) | Unique constraint serializes via Postgres lock; verified by kill-9 + dedup integration tests |
| R5 | `@IdempotentSubscribe` decorator + `@RabbitSubscribe` decorator stacking misbehaves (decorator order issue) | LOW | MEDIUM (consumer doesn't bind correctly) | Decorator unit test confirms ordering; alternative: convert to a wrapping method instead of a decorator if stacking is fragile |
| R6 | Bun's `setTimeout` typing causes hot-reload leaks | LOW | LOW | Use `ReturnType<typeof setTimeout>`; verified by typecheck |
| R7 | Topology assertion conflict if a developer manually creates a queue with mismatched args via management UI | LOW | LOW | Document: "never edit topology by hand"; recovery is `docker compose down -v && bun run docker:up` |
| R8 | Migration ordering — outbox/inbox migrations land in Phase 2; Wallet/Game tables land in Phase 3/4. Migration ID prefix must be ordered correctly | MEDIUM | LOW | Use timestamp prefix `20260524_...`; Phase 3 migrations get `20260525_...` etc. |
| R9 | `@crash/messaging-spine` package is imported into services that haven't enabled `nestjs-cls` middleware → CLS calls return undefined | LOW | MEDIUM | `MessagingSpineModule.forRoot` imports + re-exports `ClsModule.forRoot` so the consumer service gets CLS automatically |
| R10 | The `MessagingProbe` test aggregate's migration leaks into production if test config and prod config share entity globs | LOW | MEDIUM | Test config explicitly lists entities `[OutboxMessage, InboxMessage, DeadLetterMessage, MessagingProbe]`; prod config omits the probe |

---

## Validation Architecture

### Test framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (already in scaffold) |
| Config file | none — bun:test uses convention `tests/**/*.test.ts` |
| Quick run command | `cd packages/messaging-spine && bun test tests/unit` |
| Full suite command | `cd packages/messaging-spine && INTEGRATION=1 bun test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-WALL-05 | Inbox dedup prevents double side-effect on broker redelivery | integration | `INTEGRATION=1 bun test tests/integration/inbox-dedup.test.ts` | ❌ Wave 0 — file to be created in P2.14 |
| REQ-WALL-06 | Outbox publisher emits at-least-once with confirms; row stays PENDING if confirm fails | integration | `INTEGRATION=1 bun test tests/integration/outbox-write-and-publish.test.ts` and `kill-9-recovery.test.ts` | ❌ Wave 0 |
| REQ-WALL-06 (latency sub-criterion) | LISTEN/NOTIFY wakes poller; observed latency < 250ms | integration | `INTEGRATION=1 bun test tests/integration/listen-notify-wake.test.ts` | ❌ Wave 0 |
| REQ-SAGA-05 | Poison message lands in dead_letter_messages after exactly 5 redeliveries (main) | integration | `INTEGRATION=1 bun test tests/integration/poison-message.test.ts` | ❌ Wave 0 |
| REQ-SAGA-06 | Every published message carries messageId, correlationId, causationId, type, version, occurredAt; consumer extracts and propagates | integration | `INTEGRATION=1 bun test tests/integration/envelope-headers.test.ts` | ❌ Wave 0 |
| Envelope round-trip | `buildEnvelope`/`parseEnvelope` lossless JSON | unit | `bun test tests/unit/envelope.test.ts` | ❌ Wave 0 |
| Topology helpers correctness | `buildQuorumArgs(5, dlx)` shape | unit | `bun test tests/unit/topology.test.ts` | ❌ Wave 0 |

### Sampling rate
- **Per task commit:** `bun test tests/unit` (subsecond, no Docker)
- **Per wave merge:** `INTEGRATION=1 bun test` (~30-60s including testcontainers boot)
- **Phase gate:** Full suite green AND `bun run docker:up` succeeds with both services asserting topology cleanly

### Wave 0 gaps
- [ ] `packages/messaging-spine/tests/unit/envelope.test.ts`
- [ ] `packages/messaging-spine/tests/unit/topology.test.ts`
- [ ] `packages/messaging-spine/tests/integration/_helpers/harness.ts` (testcontainers wrapper)
- [ ] `packages/messaging-spine/tests/integration/_helpers/messaging-probe.entity.ts`
- [ ] All 6 integration test files (mapped above)
- [ ] `bunx testcontainers` install (`bun add -d testcontainers @testcontainers/postgresql @testcontainers/rabbitmq`)

---

## Security Domain

> `security_enforcement` default = enabled. Phase 2 is infrastructure-only, but messaging is a security boundary.

### Applicable ASVS categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | partial | AMQP broker credentials in env; never logged; rotated via env redeploy |
| V3 Session Management | no | AMQP is request-less |
| V4 Access Control | partial | Exchange/queue access scoped per-broker-user (defer to operator config; play-money trust per ARCHITECTURE.md §11) |
| V5 Input Validation | YES | Every inbox handler validates envelope payload via zod schema (services consume schemas from `@crash/contracts` in Phase 3+) |
| V6 Cryptography | no | HMAC-signed envelopes explicitly out of scope (ARCHITECTURE.md §11); not real money |
| V7 Error Handling | YES | Inbox handler throws → message nacks → broker redelivers up to `x-delivery-limit`; logs include `messageId` + `correlationId` for audit |
| V13 API and Web Service | partial | AMQP envelope schema versioning (`version` field) enables forward-compat |

### Known threat patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replay attack (same message redelivered intentionally) | Tampering | Inbox dedup on `messageId` — replayed message is a no-op |
| Poison message DoS (handler infinite-loops) | Denial of Service | `x-delivery-limit=5` on main + 3 on DLQ; landing in `dead_letter_messages` |
| Envelope schema drift breaks consumers | Tampering / DoS | `version` field on every envelope; consumer branches on version |
| Cross-service routing-key typo causes silent message loss | Information Disclosure (loss) | Constants in `@crash/messaging-spine/topology-defaults.ts`; no string literals; topology asserts on bootstrap (drift surfaces immediately) |
| AMQP credentials in process env logged accidentally | Information Disclosure | NestJS logger config excludes env values; pino `redact` paths include `RABBITMQ_URL` |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Classic queues with manual retry/ack | Quorum queues with `x-delivery-limit` (poison handling built-in) | RabbitMQ 3.10+ | Cluster-stable poison handling; no infinite redelivery loops [VERIFIED: RabbitMQ Quorum Queues docs] |
| `@nestjs/microservices` RMQ transport as sole AMQP layer | Split: raw `amqplib` for publisher + `@golevelup` for consumer | 2023+ ecosystem consensus | Full confirm-channel lifecycle control [CITED: SUMMARY §8] |
| LISTEN/NOTIFY on the same connection as queries | Dedicated `pg` Client for LISTEN | PostgreSQL canon | Listening blocks the connection [VERIFIED: PostgreSQL LISTEN docs] |
| ActiveMQ-style "JMS message selectors" | Topic exchange + routing key glob | RabbitMQ canon | Standard for years; no change needed |

**Deprecated / outdated to actively avoid:**
- `noAck: true` on any business consumer (lost-on-crash)
- `channel.publish` without `confirmSelect` (broker may drop the message)
- Default classic queues without `x-delivery-limit` (poison loops)
- Inbox row inserted BEFORE the TX (orphans on rollback)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@golevelup/nestjs-rabbitmq` v5.x supports `createConfirmChannel` via the `AmqpConnection` instance (or we can grab the underlying connection) | §OutboxPublisher pseudocode | If not exposed, drop directly to `amqp.connect(env.RABBITMQ_URL)` for the publisher and let golevelup manage its own connection for the consumer side. Two-connection model is fine. |
| A2 | `pg_notify` inside a transaction is delivered only after commit | §Outbox DDL trigger | Verified by PostgreSQL docs; high confidence. If wrong, the LISTEN client may briefly miss notifications — 1s polling baseline catches them. |
| A3 | Bun's `bun:test` runs `testcontainers` reliably (some test runners have Docker socket issues on Mac) | §Testing Approach | If unreliable, fall back to a shared docker-compose-up RabbitMQ + Postgres for integration tests (slower, less isolated, but works). |
| A4 | `INSERT ... ON CONFLICT (consumer_name, message_id) DO NOTHING` correctly serializes concurrent inserts via Postgres's unique-constraint lock | §Inbox table DDL + §Pitfall 3 | PG official semantics; high confidence. If wrong, fall back to explicit `SELECT ... FOR UPDATE` before INSERT. |
| A5 | The 250ms publish latency target is achievable with LISTEN/NOTIFY wake on a single-node testcontainers PG | §Success Criteria #5 | Realistic per Jus DB / ThinhDA benchmarks (sub-ms on localhost). If the test consistently fails, increase tolerance to 500ms — semantics still satisfied. |
| A6 | `@RabbitSubscribe` returning `undefined` triggers automatic ack in golevelup v5.x (vs. requiring explicit return) | §IdempotentSubscribe decorator | Per [VERIFIED: golevelup docs] return value semantics: `undefined` = ack; `Nack` = nack. High confidence. |
| A7 | `nestjs-cls` v4.x supports `cls.run(fn)` inside an AMQP handler (golevelup's handler runs outside the HTTP middleware chain) | §IdempotentSubscribe decorator + §nestjs-cls integration | Verified pattern in nestjs-cls docs ("Manual context"). If middleware-only assumption fails, use `ClsService.run` manually as shown in the decorator pseudocode. |
| A8 | Bun's `crypto.randomUUID()` is suitable for `messageId` (no need for `uuid` v7 ordering) | §Don't Hand-Roll | True per Bun docs. We use `uuid` v7 only if `outbox.id` ordering helps the polling claim — open optimization, not Phase 2 blocker. |
| A9 | MikroORM 7's `em.getConnection().execute(sql, params)` is parameterized correctly against SQL injection | §OutboxPublisher pseudocode | Verified MikroORM 7 API; high confidence. |
| A10 | Postgres `init-databases.sh` from Phase 1 already creates `games` and `wallets` databases — Phase 2 migrations land in the existing DBs | §Migration Plan | Verified by reading Phase 1 docker-compose and `init-databases.sh` reference; high confidence. |
| A11 | `@golevelup/nestjs-rabbitmq` `queueOptions.arguments` accepts the same shape as raw `amqplib`'s `assertQueue` arguments (so `buildQuorumArgs(5, dlx)` works inline in the decorator) | §IdempotentSubscribe decorator | Verified per golevelup docs — `queueOptions` is passed straight through to amqplib's `assertQueue`. |
| A12 | The `MessagingProbe` test aggregate approach (Option B) doesn't pollute production builds because integration tests load a different MikroORM config | §Phase 2 doesn't ship a DOMAIN | Verified pattern in MikroORM test setups. Mitigation if wrong: prefix the entity name with `__test_` and add an explicit production-config assertion. |

---

## Open Questions

1. **Should the dead-letter consumer auto-replay on operator action (Phase 10) or always require manual SQL?**
   - What we know: Phase 2 only persists DLQ-exhausted messages; no auto-replay
   - What's unclear: UX for operator inspection/replay (parking-lot UI vs. SQL only)
   - Recommendation: defer to Phase 10; SQL inspection is sufficient for the challenge demo

2. **Should `OUTBOX_POLL_BATCH_SIZE` be env-configurable or hardcoded to 100?**
   - What we know: REQUIREMENTS.md Open Configuration Values doesn't list it
   - What's unclear: whether 100 is the right baseline
   - Recommendation: add to env (`OUTBOX_POLL_BATCH_SIZE=100`) and update Open Configuration Values table — preserves the "no hardcoded constants" rule

3. **Does the polling publisher need to handle slow/failed broker reconnects with its own retry loop, or does `@golevelup/nestjs-rabbitmq`'s reconnect machinery handle it?**
   - What we know: golevelup auto-reconnects the connection
   - What's unclear: whether the confirm channel needs to be re-created after reconnect (likely yes — channels die with connections)
   - Recommendation: `OutboxPublisher` listens for connection events from golevelup's `AmqpConnection` and recreates the confirm channel on reconnect

4. **Should the inbox carry the full payload (audit trail) or just `(consumer_name, message_id)` minimal dedup state?**
   - What we know: ARCHITECTURE.md §5 includes `payload` in the inbox schema; this RESEARCH omits it for size
   - What's unclear: whether audit/debugging needs the payload locally
   - Recommendation: omit `payload` from inbox (it's already in RabbitMQ's stream + the originating service's outbox); store `payload_hash` only for audit cheap verification

5. **Does Bun's `setTimeout` honor `unref()` for graceful shutdown without blocking the event loop?**
   - What we know: Bun aims for Node compat
   - What's unclear: whether `OutboxPublisher` needs `.unref()` to avoid blocking shutdown
   - Recommendation: explicitly call `clearTimeout` in `onApplicationShutdown`; don't rely on `unref()` semantics

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 18 | outbox/inbox storage | ✓ (already in Phase 1 docker-compose) | 18.3-alpine | none needed |
| RabbitMQ 4.2 | publisher + consumer | ✓ (already in Phase 1 docker-compose) | 4.2.4-management-alpine | none needed |
| Docker | testcontainers (integration tests) | assumed ✓ on dev + CI | — | skip integration in environments without Docker (mark suite as `INTEGRATION=1` gate) |
| Bun runtime | service runtime + tests | ✓ (Phase 1) | 1.3.11+ | none |
| MikroORM CLI | migrations | ✓ (Phase 1 via `bunx mikro-orm`) | 7.1+ | none |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:** Docker on CI runners that lack it → integration suite skipped via env gate

---

## Sources

### Primary (HIGH confidence)
- [PostgreSQL NOTIFY docs](https://www.postgresql.org/docs/current/sql-notify.html) — trigger inside TX, delivered after commit
- [PostgreSQL LISTEN docs](https://www.postgresql.org/docs/current/sql-listen.html) — requires dedicated connection
- [PostgreSQL FOR UPDATE SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE) — batch claim semantics
- [RabbitMQ Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues) — `x-queue-type: quorum`, `x-delivery-limit`
- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx) — `x-dead-letter-exchange` queue arg + `x-death` header
- [RabbitMQ At-Least-Once Dead Lettering](https://www.rabbitmq.com/blog/2022/03/29/at-least-once-dead-lettering) — quorum queues' DLX guarantees
- [RabbitMQ Publisher Confirms tutorial](https://www.rabbitmq.com/tutorials/tutorial-seven-java) — confirm-once-wait-per-batch pattern
- [amqplib channel API](https://amqp-node.github.io/amqplib/channel_api.html) — `createConfirmChannel`, `waitForConfirms`
- [@golevelup/nestjs-rabbitmq docs](https://golevelup.github.io/nestjs/modules/rabbitmq.html) — `@RabbitSubscribe`, `Nack` return value, no direct ack
- [nestjs-cls docs](https://papooch.github.io/nestjs-cls/) — `ClsModule.forRoot`, `ClsService.run`
- [MikroORM Transactional Outbox blog](https://mikro-orm.io/docs/transactional-outbox) — official MikroORM 7 pattern (referenced + extended)
- [MikroORM Transactions and Concurrency](https://mikro-orm.io/docs/transactions) — `em.transactional` + pessimistic locking

### Secondary (MEDIUM confidence — verified WebSearch)
- [OneUptime — How to Handle RabbitMQ Publisher Confirms (Jan 2026)](https://oneuptime.com/blog/post/2026-01-24-rabbitmq-publisher-confirms/view) — recent 2026 walkthrough
- [Jus DB — PostgreSQL LISTEN/NOTIFY: Real-Time Application Events](https://www.jusdb.com/blog/postgresql-listen-notify-realtime-events) — outbox + NOTIFY wake pattern verified
- [ThinhDA — Postgres as a Message Bus](https://thinhdanggroup.github.io/postgres-as-a-message-bus/) — durable outbox + LISTEN/NOTIFY semantics
- [Sebastian Iwanczyszyn — Outbox Pattern with NestJS, RabbitMQ, Postgres](https://medium.com/@sebastian.iwanczyszyn/implementing-the-outbox-pattern-in-distributed-systems-with-nestjs-rabbitmq-and-postgres-65fcdb593f9b) — full NestJS reference impl
- [axotion — Solving the Dual Write Problem with NestJS Inbox/Outbox](https://axotion.medium.com/solving-the-dual-write-problem-with-nestjs-implementing-inbox-and-outbox-patterns-3b20a8bd49a1) — same-TX inbox pattern
- [Testcontainers RabbitMQ Module](https://testcontainers.com/modules/rabbitmq/) — Node port confirmed working
- [joaovieira.ca — RabbitMQ DLQ poisonous message handling](https://joaovieira.ca/rabbitmq-dlq-poisonous-message/) — DLQ-on-DLQ rationale (PITFALLS C4 reference)

### Tertiary (LOW confidence — used only for cross-checking)
- [GitHub amqplib issues #285, #375, #434](https://github.com/amqp-node/amqplib/issues/285) — graceful shutdown + waitForConfirms discussions
- [NarHakobyan/mikroorm-transactional](https://github.com/NarHakobyan/mikroorm-transactional) — alternate transactional decorator (rejected in favor of nestjs-cls + em.transactional)

---

## Metadata

**Confidence breakdown:**
- Outbox/Inbox schema: HIGH — direct application of RabbitMQ + PG canon; multiple authoritative sources agree
- Polling publisher: HIGH — amqplib + PG patterns are 10+ years stable
- LISTEN/NOTIFY wake: MEDIUM-HIGH — semantics official, but the dedicated-connection requirement adds operational surface
- RabbitMQ topology (quorum + DLX-on-DLQ): HIGH — official RabbitMQ docs explicit on both
- `@golevelup/nestjs-rabbitmq` interplay: MEDIUM-HIGH — docs cover the consumer side well; publisher side relies on grabbing the underlying connection (assumption A1)
- nestjs-cls integration: HIGH — official pattern, plus the `withMessagingContext` helper handles edge cases
- Test strategy with testcontainers: MEDIUM — Bun + testcontainers combinations have been less documented than Node + testcontainers
- MessagingProbe approach: MEDIUM-HIGH — pattern is sound but adds a test-only entity that needs careful config gating

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days for stable infra; revisit if amqplib v0.11 or @golevelup v6 ships earlier)
