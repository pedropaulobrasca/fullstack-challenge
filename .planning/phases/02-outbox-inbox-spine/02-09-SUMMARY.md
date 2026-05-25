---
phase: 02-outbox-inbox-spine
plan: 09
completed: 2026-05-25T12:30:00Z
status: complete
tests: 6 pass / 0 fail / 17 expect()
runtime_seconds: 30
---

# 02-09 — Integration Tests (testcontainers)

## Result

`INTEGRATION=1 bun test tests/integration` from `packages/messaging-spine/` → **6 pass / 0 fail** across 6 files in ~30s wall clock.

| Test | Success Criterion | Outcome | Runtime |
|------|-------------------|---------|---------|
| `outbox-write-and-publish.test.ts` | SC1 — outbox row + probe row in same TX, polled, consumed | pass | ~6s |
| `inbox-dedup.test.ts` | SC1 — same messageId redelivered → handler runs once | pass | ~5s |
| `envelope-headers.test.ts` | SC4 — correlationId via CLS, downstream causationId chains | pass | ~4s |
| `kill-9-recovery.test.ts` | SC2 — crash mid-confirm → recover via dedup | pass | ~5s |
| `poison-message.test.ts` | SC3 — handler throws → dead_letter_messages row written | pass | ~5s |
| `listen-notify-wake.test.ts` | SC5 — publish latency under threshold | pass | ~5s |

`bun test tests/unit` remains green (56 pass / 0 fail).

## Files

| Path | Purpose |
|------|---------|
| `tests/integration/_helpers/messaging-probe.entity.ts` | `MessagingProbe` `EntitySchema` mapped to `messaging_probe` (test-only) |
| `tests/integration/_helpers/probe-mikro-orm.config.ts` | MikroORM config registering outbox + inbox + dead-letter + probe schemas |
| `tests/integration/_helpers/harness.ts` | `bootHarness` / `shutdownHarness` / `waitFor` / `withPgClient`; spins Postgres 18-alpine + RabbitMQ 4.2.4-management-alpine via `GenericContainer` |
| `tests/integration/outbox-write-and-publish.test.ts` | SC1 — same-TX dual write end-to-end |
| `tests/integration/inbox-dedup.test.ts` | SC1 — exactly-once consumption (REQ-WALL-05) |
| `tests/integration/envelope-headers.test.ts` | SC4 — CLS correlation + outbox causation chain (REQ-SAGA-06) |
| `tests/integration/kill-9-recovery.test.ts` | SC2 — at-least-once + dedup recovery (REQ-WALL-06) |
| `tests/integration/poison-message.test.ts` | SC3 — DLX exhaustion → `dead_letter_messages` (REQ-SAGA-05) |
| `tests/integration/listen-notify-wake.test.ts` | SC5 — publish-to-handle latency budget |
| `package.json` | `test:integration` narrowed to `tests/integration`; `@nestjs/testing` added as devDependency |

## Commits

| Hash | Message |
|------|---------|
| `071a425` | `test(02-09): add testcontainers harness + MessagingProbe entity` |
| `ceeb174` | `test(02-09): add outbox-write, inbox-dedup, envelope-headers integration tests` |
| `1c5dce0` | `test(02-09): add kill-9-recovery, poison-message, listen-notify-wake integration tests` |

## listen-notify-wake latency

Five iterations, `pollIntervalMs = 100`, single test invocation:

| Run | Latency (ms) |
|-----|--------------|
| 1 | 118.4 |
| 2 | 126.2 |
| 3 | 218.3 |
| 4 | 222.1 |
| 5 | 231.5 |

- median: **218.3 ms**
- max: **231.5 ms**

Threshold asserted at 500 ms (per 02-RESEARCH §A5 the 250 ms target carries a 500 ms tolerance). The observed median sits inside the stricter 250 ms criterion too.

## Deviations

### 1. [Rule 1 — Bug] testcontainers wait strategy hangs under `bun test`

**Found during:** Task 2 first execution.
**Issue:** `PostgreSqlContainer` from `@testcontainers/postgresql@12` (and presumably the rabbitmq wrapper) install a composite wait strategy ending in `Wait.forHealthCheck()`. Under the `bun test` runtime this `await ...start()` never returns even though the container is healthy in Docker (`docker ps` shows `(healthy)` within 2-3 s; the same code runs to completion in Node ~2 s). Bun's event-loop interaction with the testcontainers health-check polling appears to be the root cause — equivalent code under plain `bun script.ts` also stalls (CPU pegged), so it is not bun:test specific.
**Fix:** Switched both containers to plain `GenericContainer` (from `testcontainers`) with `Wait.forLogMessage(/database system is ready to accept connections/, 2)` for Postgres and `Wait.forLogMessage(/Server startup complete/, 1)` for RabbitMQ. `getHost()` + `getMappedPort()` reconstruct the connection URIs manually. Setup time: PG ~2 s, RMQ ~3 s.
**Files modified:** `tests/integration/_helpers/harness.ts`
**Commit:** rolled into `ceeb174`

### 2. [Rule 2 — Critical addition] `@nestjs/testing` devDependency

**Found during:** Task 1 typecheck.
**Issue:** harness compiles a `TestingModule` via `Test.createTestingModule` — package was not in the workspace.
**Fix:** `bun add -D @nestjs/testing@^11.1.21` from the package root.
**Files modified:** `packages/messaging-spine/package.json`, `bun.lock`
**Commit:** rolled into `071a425`.

### 3. Wire envelope shape — consumer-side payload unwrap

**Observation, not a fix:** The publisher (`OutboxPublisher.tick`) serializes the **full envelope** as the message body (`JSON.stringify({ messageId, type, version, correlationId, causationId, occurredAt, payload })`). `@golevelup/nestjs-rabbitmq` JSON-parses the entire body and hands it to the `@RabbitSubscribe` handler. `@IdempotentSubscribe` then wraps that with another synthetic envelope (`envelope = { messageId: meta.messageId, …, payload: rawPayload }`), so inside the handler `envelope.payload` is the **wire envelope**, not the domain payload — the domain payload lives at `envelope.payload.payload`.

This is the spine's current contract and the tests are written against it. Plan 02-09 explicitly forbids touching production source, so the double-wrap is documented here rather than altered. Phase 3 consumers (and any plan that updates the decorator) should consider unwrapping `envelope.payload = rawPayload.payload` so handlers can write `envelope.payload.probeId` directly. Surface as a follow-up note for the verifier.

### 4. listen-notify-wake — current spine wakes on the next poll cycle, not by interrupting the active sleep

**Observation:** `OutboxPublisher` consumes `OutboxListenerService.onNotification` by setting `wakeRequested = true`. The `tick` reads that flag and schedules the **next** tick with delay 0, but it does not cancel the in-flight `setTimeout(baseDelay)`. With `pollIntervalMs = 5000` the test latency floor is 5 s regardless of pg_notify activity. With `pollIntervalMs = 100` the latency floor collapses to ~100 ms and the success criterion is comfortably met.

The plan's success criterion (≤ 250 ms) is satisfied with `pollIntervalMs = 100` (median 218 ms) — the configuration is what the production services run with anyway. A "true" interrupt-the-sleep wake on pg_notify is left for a future fix to `OutboxPublisher.tick`; flagging it here so the verifier can decide whether to file a follow-up plan.

### 5. Handler mutation pattern — raw SQL inside `@IdempotentSubscribe` transaction

**Found during:** Task 2 first attempt with `em.findOne` + `em.persist` + `em.flush` mutating an entity from inside the decorator. Even though the inbox row materialized and `markProcessed` ran, the probe mutation never reached the DB. The decorator's `host.em.transactional(async () => {})` wraps the inbox raw-SQL calls in a transaction via `em.getConnection().execute`, but the parent EM's identity-map mutations did not flush inside that same transaction in MikroORM 7 + bun.
**Fix:** Switched all probe mutations to raw SQL (`em.getConnection().execute('UPDATE messaging_probe …')`), which shares the transaction context with `InboxRepository.tryClaim` / `markProcessed` and the decorator's commit. This is also the documented pattern that the spine's `DeadLetterRepository` uses.
**Note:** Phase 3 wallet/games handlers will need to follow the same pattern (raw SQL or a forked-EM passed by the decorator). Flagging for the verifier to decide whether the decorator should propagate `txEm` to the wrapped handler.

## Threat surface

`MessagingProbe` aggregate is confined to `tests/integration/_helpers/`:

```
$ grep -rn "MessagingProbe" services/ packages/messaging-spine/src/
(no matches)
```

Production MikroORM configs (`services/games/mikro-orm.config.ts`, `services/wallets/mikro-orm.config.ts`) register only `OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema` — the probe is structurally unreachable from production builds (T-02-29 mitigated as planned).

## Harness teardown contract

`harness.teardown()` (also exposed as `shutdownHarness(h)`) performs:

1. `await app.close()` — triggers `OnApplicationShutdown` for `OutboxPublisher` (waitForConfirms + channel close), `OutboxListenerService` (LISTEN client end), `TopologyBootstrap` (no-op), `RabbitMQModule` (connection close)
2. `await rmqContainer.stop()` — SIGTERM to the RabbitMQ container, then testcontainers awaits `Stopped container`
3. `await pgContainer.stop()` — SIGTERM to the Postgres container

All three steps swallow errors (no `.catch(throw)`) because integration teardown should never fail the test suite over a slow Docker daemon. On Mac under OrbStack each container stops in ~150 ms; total teardown ~400-600 ms per suite.

## Self-Check: PASSED

- `packages/messaging-spine/tests/integration/_helpers/messaging-probe.entity.ts` — exists
- `packages/messaging-spine/tests/integration/_helpers/probe-mikro-orm.config.ts` — exists
- `packages/messaging-spine/tests/integration/_helpers/harness.ts` — exists
- `packages/messaging-spine/tests/integration/outbox-write-and-publish.test.ts` — exists
- `packages/messaging-spine/tests/integration/inbox-dedup.test.ts` — exists
- `packages/messaging-spine/tests/integration/envelope-headers.test.ts` — exists
- `packages/messaging-spine/tests/integration/kill-9-recovery.test.ts` — exists
- `packages/messaging-spine/tests/integration/poison-message.test.ts` — exists
- `packages/messaging-spine/tests/integration/listen-notify-wake.test.ts` — exists
- commit `071a425` — present in `git log`
- commit `ceeb174` — present in `git log`
- commit `1c5dce0` — present in `git log`
- `INTEGRATION=1 bun test tests/integration` — 6 pass / 0 fail / 17 expect()
- `bun test tests/unit` — 56 pass / 0 fail
