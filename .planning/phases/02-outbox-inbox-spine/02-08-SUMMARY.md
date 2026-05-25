---
phase: 02-outbox-inbox-spine
plan: 08
completed: 2026-05-25T00:35:00Z
status: complete
tests: 56 pass / 0 fail / 102 expect()
---

# 02-08 — Unit Tests (messaging-spine)

## Result

`bun test packages/messaging-spine/tests/unit/` → **56 pass / 0 fail** across 5 suites in ~145 ms.

## Files

| Path | Purpose |
|------|---------|
| `packages/messaging-spine/tests/unit/envelope.test.ts` | round-trip `buildEnvelope`/`parseEnvelope` + AMQP header bridge bidirectional |
| `packages/messaging-spine/tests/unit/topology.test.ts` | `buildQuorumArgs` shape; `EXCHANGES`/`QUEUES` constants consistency |
| `packages/messaging-spine/tests/unit/inbox-repository-sql.test.ts` | asserts SQL contains `INSERT INTO inbox` + `ON CONFLICT (message_id, consumer_name) DO NOTHING` |
| `packages/messaging-spine/tests/unit/dead-letter-consumer.test.ts` | x-death parsing, retry count, original-queue fallback |
| `packages/messaging-spine/tests/unit/cls.test.ts` | `withMessagingContext` — correlationId set, causationId conditional, nested inheritance, scope isolation, error propagation |

## Commits

- `d7c9048` — `test(02-08): add envelope and topology unit suites` (prior session)
- (this commit) — `test(02-08): add inbox, dead-letter, and cls unit suites + fix empty-string fallback`

## Fix surfaced during test runs

`DeadLetterConsumer.handleDeadLetter` used `??` chaining for `originalQueue` and `originalExchange`. With `msg?.fields?.routingKey === ""`, the empty string is non-null so `??` did not fall through to `"unknown"`. Replaced with `String(... ?? ... ?? "") || "unknown"` so empty strings also trigger the fallback. Behavioral change is correct per CLAUDE.md no-anemic semantics — empty-string fields are missing-by-intent, not legitimate identifiers.

## Deviations

None. Plan executed as specified. CLS test imports from sub-paths (`../../src/context/correlation-tokens` and `../../src/context/messaging-cls`) because the `src/context/` directory has no barrel `index.ts` — the package barrel re-exports them but the test file pins exact origin to keep failures localized.

## Coverage

| Phase 2 REQ-ID | Covered by |
|----------------|------------|
| REQ-WALL-05 | `inbox-repository-sql.test.ts` (ON CONFLICT semantics) |
| REQ-WALL-06 | `envelope.test.ts` (header bridge), `topology.test.ts` (quorum args) |
| REQ-SAGA-05 | `dead-letter-consumer.test.ts` (x-death + retry count + fallback) |
| REQ-SAGA-06 | `envelope.test.ts` (correlation/causation headers), `cls.test.ts` (context propagation) |

## Next

`/gsd:execute-phase 2` Wave 7 — `02-09` (integration tests via testcontainers + MessagingProbe) and `02-10` (ADR-007..010 + closeout) in parallel.
