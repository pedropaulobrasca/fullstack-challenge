# ADR-010: Dedicated `pg.Client` for LISTEN/NOTIFY, separate from MikroORM pool

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 2

## Context

The outbox polling baseline is `OUTBOX_POLL_INTERVAL_MS=1000` per the env contract — the publisher claims a batch every second whether or not new rows have arrived. This is a safety net (guarantees forward progress) but a poor latency floor: a single inserted outbox row waits an average of 500 ms before being published. REQ-WALL-06 implicitly demands better — the integration tests (plan 02-09) target sub-250ms publish latency for a single row.

The standard solution, per 02-RESEARCH §Pattern 3 and every production outbox writeup (Jus DB, ThinhDA, axotion), is `LISTEN/NOTIFY`. Plan 02-02's `outbox_notify_trigger` fires `pg_notify('outbox_new_message', NEW.id::text)` AFTER INSERT, so the moment a transaction containing an outbox INSERT commits, every listener receives a notification. The publisher wakes immediately and processes the new row.

But LISTEN has a non-obvious operational property: it pins the Postgres connection. The session running `LISTEN outbox_new_message` cannot be returned to a pool, cannot serve other queries, cannot be reused. Until that session disconnects or runs `UNLISTEN`, it is dedicated to receiving asynchronous notifications. This is documented behavior in PostgreSQL's LISTEN/NOTIFY semantics.

If we LISTEN on a connection borrowed from MikroORM's pool, that connection is removed from circulation. The next application query that needs a connection blocks. Two listens, two missing connections. Under load, the pool starves entirely and all application queries hang. PITFALLS H4 (or equivalent — see 02-RESEARCH §Pitfall 1) documents this as the canonical mistake.

Three options were evaluated.

## Considered

- **Borrow a connection from MikroORM's pool for LISTEN** — Cheapest in code (no new dependency). Catastrophic operationally: the pool loses one connection per service per LISTEN; under any concurrent load, every other query blocks waiting for a pool slot. Fails the basic Phase-1 smoke test the moment a second concurrent request arrives.
- **Increase pool size by 1 and reserve one slot for LISTEN** — Workable in theory, fragile in practice. MikroORM's pool API does not expose "reserve this connection for me forever"; any borrow-then-LISTEN dance requires manual connection management that defeats the purpose of using the pool at all. Adds a configuration burden (pool size must always be N+1 of "real" need) that operators forget to maintain.
- **Dedicated `pg.Client` with reconnect + watchdog** — Add `pg` and `@types/pg` as direct dependencies of `@crash/messaging-spine`. Instantiate a `new pg.Client({ connectionString: opts.databaseUrl })` inside `OutboxListenerService` separately from MikroORM. Register `LISTEN outbox_new_message`. Subscribe to `client.on('notification', ...)`, `client.on('error', ...)`, `client.on('end', ...)`. Run a watchdog `SELECT 1` every 30 s as a keepalive. On any error or end event, dispose the client, sleep with exponential backoff, reconnect, re-LISTEN.

## Decision

**Dedicated `pg.Client` inside `OutboxListenerService`, completely outside MikroORM's pool.**

Plan 02-04's `OutboxListenerService` owns this. `onApplicationBootstrap` connects the client and issues `LISTEN outbox_new_message`. The `notification` event sets a `wakeRequested` flag on `OutboxPublisher` (via a callback registered through `listener.onNotification(...)`). The publisher's poll loop reads the flag at the end of each tick: if set, schedule the next tick at 0 ms; otherwise schedule at `OUTBOX_POLL_INTERVAL_MS`.

Reconnection lifecycle: `client.on('error', ...)` + `client.on('end', ...)` both trigger `dispose → backoff → reconnect → re-LISTEN`. A watchdog timer runs `SELECT 1` every 30 s as a keepalive (NAT / load-balancer idle timeouts can silently kill long-lived LISTEN sessions without raising an error event on some node-postgres minor versions, per 02-RESEARCH §Pitfall 1).

Each service that mounts `MessagingSpineModule` adds exactly one extra Postgres connection: the LISTEN client. This is a trivial cost relative to MikroORM's pool, which sizes itself to handle concurrent request load. The connection budget for both services combined is two extra connections — well below Postgres 18's default `max_connections` of 100.

Rationale, per 02-RESEARCH §Pattern 3 + §Pitfall 1 + PostgreSQL LISTEN docs (postgresql.org/docs/current/sql-listen.html): this is the canonical pattern in every production outbox writeup reviewed during research. The pool-starvation alternative is not just suboptimal — it actively fails under realistic concurrency. The pool-size-plus-one alternative is fragile in a way that survives initial code review but fails in production when someone forgets to bump the env variable. A dedicated client makes the requirement structural, not procedural.

## Consequences

- **Locked in**: `pg` and `@types/pg` as `@crash/messaging-spine` dependencies; `OutboxListenerService` owns the dedicated client and its reconnect lifecycle; `OutboxPublisher` consumes wake signals via `listener.onNotification(callback)`; each service runs exactly one LISTEN client per `MessagingSpineModule` instance.
- **Operational cost**: two extra Postgres connections across the stack (one per service). Within budget for any realistic deployment.
- **Failure mode mitigation**: silent LISTEN death (TCP idle timeout, NAT eviction) handled by the 30-second `SELECT 1` watchdog; broker / DB restarts handled by the `error` / `end` event reconnect path; the 1-second polling baseline remains as the absolute safety net (no missed outbox row regardless of LISTEN state).
- **Foreclosed**: borrowing a MikroORM pool connection for LISTEN (pool starvation); managing a "reserved" pool slot manually (fragile, configuration-burden-prone).
- **Anticipated recruiter question**: "Why a separate pg client instead of MikroORM?" — defended by the LISTEN-pins-connection argument and the documented pool-starvation pattern in PITFALLS / 02-RESEARCH §Pitfall 1.

## Alternatives Rejected

- **Borrow a MikroORM pool connection for LISTEN** — starves the pool; concurrent application queries block; documented anti-pattern.
- **Increase pool size by 1 and reserve a slot** — MikroORM's pool API does not support "reserve forever"; fragile manual connection management; configuration burden that operators forget to maintain.
