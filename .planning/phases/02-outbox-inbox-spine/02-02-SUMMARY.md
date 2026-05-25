---
phase: 02-outbox-inbox-spine
plan: 02
subsystem: outbox/inbox/dead-letter schema + entity contracts
tags: [schema, mikro-orm, entity-schema, outbox, inbox, dead-letter, sql, postgres]
requires:
  - "@crash/messaging-spine package skeleton (P2.1)"
  - "@mikro-orm/core@7.1.1, @mikro-orm/postgresql@7.1.1"
provides:
  - "Canonical SQL fragments for outbox, inbox and dead_letter_messages tables"
  - "MikroORM EntitySchema definitions for OutboxMessage, InboxMessage, DeadLetterMessage"
  - "OutboxStatus literal union mirroring the SQL CHECK constraint"
  - "pg_notify('outbox_new_message', NEW.id::text) trigger on outbox INSERT"
affects:
  - services/games (will register OutboxMessageSchema, InboxMessageSchema in P2.8)
  - services/wallets (same — both DBs receive the same DDL fragments)
  - Plan 02-04 OutboxListenerService (will LISTEN outbox_new_message)
tech-stack:
  added: []
  patterns:
    - "EntitySchema-based definitions (MikroORM 7 dropped decorator exports)"
    - "Class + paired *Schema constant per entity file"
    - "camelCase TS field with fieldName override mapping to snake_case SQL column"
    - "Composite primary key flagged via two properties with primary:true (inbox)"
    - "Partial index expressed via IndexOptions.where as raw SQL fragment"
    - "Status as TEXT + CHECK (not native enum) — TS literal union + OUTBOX_STATUSES tuple are sole source of truth"
key-files:
  created:
    - packages/messaging-spine/src/migrations/shared/001-outbox.sql
    - packages/messaging-spine/src/migrations/shared/002-inbox.sql
    - packages/messaging-spine/src/migrations/shared/003-dead-letter-messages.sql
    - packages/messaging-spine/src/outbox/outbox-status.ts
    - packages/messaging-spine/src/outbox/outbox-message.entity.ts
    - packages/messaging-spine/src/inbox/inbox-message.entity.ts
    - packages/messaging-spine/src/dead-letter/dead-letter-message.entity.ts
    - .planning/phases/02-outbox-inbox-spine/02-02-SUMMARY.md
  modified:
    - packages/messaging-spine/src/index.ts
decisions:
  - "Use EntitySchema (not decorators) for all three entities — MikroORM 7.1.1 dropped @Entity, @PrimaryKey, @Property, @Unique decorator exports; downgrading violates STACK.md lock"
  - "Export both class and *Schema symbol per entity — class is used as the type in repositories and the discoverable handle; *Schema is what gets registered in mikro-orm.config.entities"
  - "Inbox composite PK declared as two properties with primary:true — EntitySchema's idiomatic composite-PK form, matches SQL PRIMARY KEY (consumer_name, message_id)"
  - "OUTBOX_STATUSES tuple is the canonical list — OutboxStatus type derived from it, SQL CHECK constraint list must stay in sync (covered by P2.9 integration test per plan)"
  - "Partial pending index encoded via IndexOptions.where as raw SQL string — portable enough since target is Postgres-only and matches the SQL fragment exactly"
metrics:
  duration_minutes: 12
  tasks_completed: 3
  files_created: 8
  files_modified: 1
  completed: 2026-05-24
---

# Phase 02 Plan 02: Outbox/Inbox/Dead-Letter Schema + Entities Summary

Canonical DDL fragments and MikroORM EntitySchema definitions for the three persistence pillars of the messaging spine (outbox, inbox, dead-letter), with column-level field mapping and the pg_notify trigger contract that the P2.4 LISTEN client will subscribe to.

---

## What landed

### SQL fragments (Task 1, committed earlier in `5ae2f56`)

Three byte-faithful DDL files under `packages/messaging-spine/src/migrations/shared/`:

| File | Statements | Highlights |
|------|------------|------------|
| `001-outbox.sql` | 4 (table + index + function + trigger) | `CHECK (status IN ('PENDING','PUBLISHED','FAILED'))`, partial `outbox_pending_idx` on `(created_at) WHERE status='PENDING'`, `outbox_notify_fn()` plpgsql + `outbox_notify_trigger AFTER INSERT` |
| `002-inbox.sql` | 2 (table + index) | Composite `PRIMARY KEY (consumer_name, message_id)`, `inbox_received_at_idx` on `(received_at)` |
| `003-dead-letter-messages.sql` | 2 (table + index; UNIQUE inline) | `UNIQUE (consumer_name, original_message_id)`, `dead_letter_received_at_idx ON (received_at DESC)` |

All fragments are idempotent-safe (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` preceding `CREATE TRIGGER`).

### Entities (Task 2, committed in `55be603`)

Three EntitySchema-backed classes plus the status literal union.

### Barrel exports (Task 3, committed in `716ef63`)

`packages/messaging-spine/src/index.ts` now re-exports:

- `OutboxMessage`, `OutboxMessageSchema`
- `InboxMessage`, `InboxMessageSchema`
- `DeadLetterMessage`, `DeadLetterMessageSchema`
- `OUTBOX_STATUSES`, `OutboxStatus` (type)

---

## Field-to-column mapping

### OutboxMessage → `outbox`

| TS field | SQL column | Type | Notes |
|----------|-----------|------|-------|
| `id` | `id` | `bigint` (BIGSERIAL) | Primary key, returned as string |
| `messageId` | `message_id` | `uuid` | Unique |
| `aggregateType` | `aggregate_type` | `text` | |
| `aggregateId` | `aggregate_id` | `text` | |
| `eventType` | `event_type` | `text` | |
| `eventVersion` | `event_version` | `int` | Default 1 |
| `exchange` | `exchange` | `text` | |
| `routingKey` | `routing_key` | `text` | |
| `payload` | `payload` | `jsonb` | |
| `headers` | `headers` | `jsonb` | Carries correlationId/causationId/occurredAt |
| `status` | `status` | `text` | Default `'PENDING'`; CHECK constraint enforced at DB; literal union in TS |
| `attempts` | `attempts` | `int` | Default 0 |
| `lastError` | `last_error` | `text` | Nullable |
| `createdAt` | `created_at` | `timestamptz` | `defaultRaw: 'now()'` |
| `publishedAt` | `published_at` | `timestamptz` | Nullable |
| `lastAttemptAt` | `last_attempt_at` | `timestamptz` | Nullable |

Index: `outbox_pending_idx ON (created_at) WHERE status = 'PENDING'`.

### InboxMessage → `inbox`

| TS field | SQL column | Type | Notes |
|----------|-----------|------|-------|
| `consumerName` | `consumer_name` | `text` | Primary (composite) |
| `messageId` | `message_id` | `uuid` | Primary (composite) |
| `messageType` | `message_type` | `text` | |
| `receivedAt` | `received_at` | `timestamptz` | `defaultRaw: 'now()'` |
| `processedAt` | `processed_at` | `timestamptz` | Nullable |
| `payloadHash` | `payload_hash` | `text` | Nullable |

Composite PK: `(consumer_name, message_id)`. Index: `inbox_received_at_idx ON (received_at)`.

### DeadLetterMessage → `dead_letter_messages`

| TS field | SQL column | Type | Notes |
|----------|-----------|------|-------|
| `id` | `id` | `bigint` (BIGSERIAL) | Primary |
| `originalMessageId` | `original_message_id` | `uuid` | |
| `originalExchange` | `original_exchange` | `text` | |
| `originalRoutingKey` | `original_routing_key` | `text` | |
| `originalQueue` | `original_queue` | `text` | |
| `consumerName` | `consumer_name` | `text` | |
| `headers` | `headers` | `jsonb` | |
| `payload` | `payload` | `jsonb` | |
| `errorClass` | `error_class` | `text` | Nullable |
| `errorMessage` | `error_message` | `text` | Nullable |
| `redeliveryCount` | `redelivery_count` | `int` | Derived from x-death header |
| `receivedAt` | `received_at` | `timestamptz` | `defaultRaw: 'now()'` |

Unique: `(consumer_name, original_message_id)`. Index: `dead_letter_received_at_idx ON (received_at DESC)`.

---

## pg_notify channel contract

- **Channel name**: `outbox_new_message`
- **Payload**: `NEW.id::text` (the bigserial primary key as a string)
- **Fired**: `AFTER INSERT ON outbox FOR EACH ROW`
- **Consumer**: P2.04 `OutboxListenerService` will hold a dedicated `pg` client running `LISTEN outbox_new_message` to wake the polling publisher without sleeping the full poll interval

The TRIGGER function is created as `CREATE OR REPLACE FUNCTION outbox_notify_fn() RETURNS trigger`; the trigger itself is guarded by `DROP TRIGGER IF EXISTS outbox_notify_trigger ON outbox` immediately preceding `CREATE TRIGGER`, since Postgres 18 still lacks `CREATE TRIGGER IF NOT EXISTS` for stable releases.

---

## SQL fragment consumption convention

The three `.sql` files are read at migration-generation time by P2.08 service migration files using:

```ts
const sql = readFileSync(
  join(import.meta.dir, '../../../node_modules/@crash/messaging-spine/src/migrations/shared/001-outbox.sql'),
  'utf8',
);
this.execute(sql);
```

This guarantees both `games` and `wallets` databases receive byte-identical DDL — no copy-paste drift.

---

## Deviations from Plan

### [Rule 4 — Architectural] EntitySchema API substitution (approved at checkpoint)

- **Found during**: Task 2 (entity authoring)
- **Issue**: Plan prescribed `@Entity`, `@PrimaryKey`, `@Property`, `@Unique` decorator imports from `@mikro-orm/core`. Verified by inspecting `node_modules/.bun/@mikro-orm+core@7.1.1/node_modules/@mikro-orm/core/index.d.ts` — MikroORM 7.1.1 dropped those decorator exports. Only `EntitySchema` and `defineEntity` are available for class-based entity definitions.
- **Resolution**: Checkpoint surfaced to user; **Option 1 approved** — use `EntitySchema`. Preserves the plan's public-API contract (same class names, same exports, same field shapes); switches the underlying registration mechanism from decorators to a paired `*Schema` constant per entity file.
- **Why not the alternatives**:
  - `defineEntity` — adds an extra `*Schema` symbol per entity that pollutes the barrel without giving us anything `EntitySchema` doesn't already.
  - Downgrade MikroORM — violates STACK.md lock; hard no.
- **Impact on downstream plans**: P2.04 (publisher) and P2.05 (consumer) repositories will use the entity class as the type parameter to `EntityManager.getRepository(OutboxMessage)` — identical ergonomics to the decorator-based plan. P2.08 (migration registration) must register the `*Schema` instances (`OutboxMessageSchema`, `InboxMessageSchema`, `DeadLetterMessageSchema`) in `mikro-orm.config.entities`, not the bare classes; this is a one-line plan diff for P2.08.
- **Files affected**: All three entity files now export `{ ClassName, ClassNameSchema }` instead of a decorator-annotated class.
- **Commits**: `55be603` (entities), `716ef63` (barrel updated to export both class and schema).

### Adjusted verify checks

Plan verify for Task 2 ran `grep -q "@PrimaryKey"` which would fail under EntitySchema. Substituted with:

- `grep -q "new EntitySchema"` (instead of `@Entity`)
- `grep -q "primary: true"` (instead of `@PrimaryKey`)
- `grep -c "primary: true" src/inbox/inbox-message.entity.ts` returns `2` (composite PK)
- `grep -q "fieldName: 'consumer_name'"` (unchanged — EntitySchema uses the same key)
- `bunx tsc --noEmit` exits 0

All adjusted checks pass.

---

## Authentication gates

None. Plan was offline-only (file authoring + tsc).

---

## Verification results

| Check | Result |
|-------|--------|
| `bun run typecheck` in messaging-spine | exits 0 |
| `grep -c "primary: true" src/inbox/inbox-message.entity.ts` | 2 (composite key confirmed) |
| `grep "pg_notify" src/migrations/shared/001-outbox.sql` | trigger function body present |
| `grep "PRIMARY KEY (consumer_name, message_id)" src/migrations/shared/002-inbox.sql` | confirmed |
| `grep "UNIQUE (consumer_name, original_message_id)" src/migrations/shared/003-dead-letter-messages.sql` | confirmed |
| Barrel runtime import resolves `OutboxMessage`, `OutboxMessageSchema`, `InboxMessage`, `InboxMessageSchema`, `DeadLetterMessage`, `DeadLetterMessageSchema`, `OUTBOX_STATUSES` | all present |

---

## Commits

| Commit | Task | Description |
|--------|------|-------------|
| `5ae2f56` | Task 1 | Canonical SQL fragments for outbox/inbox/dead-letter |
| `55be603` | Task 2 | EntitySchema definitions + OutboxStatus literal union |
| `716ef63` | Task 3 | Barrel re-exports of entities and schemas |

---

## Self-Check: PASSED

All listed files exist on disk; all three commits exist in git log under `feat(02-02): ...`.
