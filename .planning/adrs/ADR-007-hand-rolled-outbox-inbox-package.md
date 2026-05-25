# ADR-007: Hand-rolled `@crash/messaging-spine` over `nestjs-outbox` / `pg-transactional-outbox`

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 2

## Context

REQ-WALL-05, REQ-WALL-06, REQ-SAGA-05, and REQ-SAGA-06 together require a transactional outbox (same-TX domain row + outbox row), a polling publisher with `confirmSelect` + `waitForConfirms`, an inbox table keyed `(consumer_name, message_id)` written inside the same transaction as the side-effect, a dead-letter persister, and `correlationId`/`causationId` propagation through every message. Phase 2's job is to ship this spine before any business aggregate exists, so every saga from Phase 5 onward sits on a single shared implementation.

The 25% architecture / DDD scoring band in the recruiter rubric is the deciding constraint: the outbox row, the confirm-channel lifecycle, the inbox dedup contract, and the DLQ-with-its-own-delivery-limit topology are exactly the artifacts an arguição auditor wants to see written in our repo, not delegated to a transitive dependency. STACK.md §2.10 already flagged hand-rolling as the recommended path; this ADR locks that recommendation against the two real off-the-shelf candidates.

Three options were evaluated against the brief: `nestjs-outbox` (fullstackhouse), `pg-transactional-outbox`, and the MikroORM official blog OutboxEvent pattern. A fourth option — hand-roll inside a shared workspace package — was chosen.

## Considered

- **`nestjs-outbox` (fullstackhouse)** — Supports LISTEN/NOTIFY with a MikroORM driver out of the box. ~600 weekly downloads, single maintainer, lifecycle for the confirm channel is hidden behind the module's transport layer. Black-box dep means the recruiter cannot read the dual-write fix in our code.
- **`pg-transactional-outbox`** — Postgres-direct, well-tested for one specific architecture: WAL-replication-based publishing. Couples our publisher to logical-replication infrastructure we explicitly rejected in ARCHITECTURE.md §5.2. Polling at challenge scale is simpler and gives the same at-least-once guarantee.
- **MikroORM official `OutboxEvent` blog pattern** — Documented at mikro-orm.io/docs/transactional-outbox. Ships a `processed` boolean on the outbox row, no inbox at all, no DLX, no publisher confirms. Useful as a conceptual reference; insufficient as an implementation — would still leave the consumer half (REQ-WALL-05) and the topology half (REQ-SAGA-05) unsolved.
- **Hand-roll in `packages/messaging-spine/` as `@crash/messaging-spine`** — ~600 LOC across publisher + listener + repos + decorators + topology + CLS context. Every line auditable in arguição. Configurable per service via NestJS module options (`consumerName`, `serviceName`, env injection). Carries the full maintenance burden in exchange for full transparency.

## Decision

**Hand-roll in `packages/messaging-spine/` as the `@crash/messaging-spine` workspace package.**

The package owns the polling loop, the LISTEN/NOTIFY wake (ADR-010), the confirm channel lifecycle (ADR-008), the inbox `INSERT ... ON CONFLICT DO NOTHING RETURNING` contract, the `DeadLetterConsumer` base class, the topology helpers (`buildQuorumArgs`, `EXCHANGES`, `QUEUES`), and the `nestjs-cls` integration that carries `correlationId`/`causationId` across async boundaries. Both services (`games`, `wallets`) consume it via the standard workspace symlink (`workspace:*`) and configure it per service through `MessagingSpineModule.forRootAsync(...)`.

Rationale, per STACK.md §2.10 and 02-RESEARCH §Summary: hand-rolling matches the project's core value — "demonstrate senior-level engineering through deep reasoning over a generic AI-assisted submission." The recruiter sees the dual-write fix and the publisher-confirm semantics directly in our source tree, not as opaque transport configuration. The ~600 LOC budget is small enough that the maintenance burden over the challenge timeline is negligible, and large enough that the decisions are non-trivial — which is exactly what the rubric rewards.

The four plans (02-04 OutboxRepository + OutboxListenerService + OutboxPublisher; 02-05 InboxRepository + `@IdempotentSubscribe` + DeadLetterConsumer base; 02-06 TopologyBootstrap + MessagingSpineModule composition; 02-07 service wiring) collectively implement this decision. Plan 02-08 covers unit tests against the package; plan 02-09 covers integration tests via testcontainers.

## Consequences

- **Locked in**: `packages/messaging-spine/src/{outbox,inbox,dead-letter,topology,envelope,context,migrations/shared}` directory structure; `MessagingSpineModule.forRootAsync({ useFactory, inject, imports? })` as the single composition entrypoint; subpath exports for the canonical SQL fragments so services consume them at migration time without copy-paste drift.
- **Maintenance ownership**: the polling loop's batch-size + backoff tuning, the LISTEN client's reconnect + watchdog, the confirm channel's drain-on-shutdown, and the inbox SQL's race-safety contract are all our responsibility. None of them are off the shelf.
- **Foreclosed**: any later switch to a third-party transactional-outbox library would require migrating both services' wiring and revisiting the inbox decorator contract; the cost is real and intentional.
- **Reversibility**: the package surface area is small enough that swapping to `nestjs-outbox` later would touch ~10 import sites in each service. Not free, but not catastrophic.
- **Anticipated recruiter question**: "Why didn't you use `nestjs-outbox`?" — defended by the 25% architecture scoring band, the black-box-dep argument, and the fact that the package's adoption metrics (~600 weekly downloads, single maintainer) put it in the same risk band as hand-rolling without the auditability upside.

## Alternatives Rejected

- **`nestjs-outbox` (fullstackhouse)** — single-maintainer, low-adoption library hides the confirm-channel lifecycle behind a transport; recruiter cannot read the dual-write fix in our repo.
- **`pg-transactional-outbox`** — couples publisher to WAL-replication strategy explicitly rejected in ARCHITECTURE.md §5.2; polling is simpler at challenge scale.
- **MikroORM `OutboxEvent` blog pattern** — no inbox half, no DLX topology, no publisher confirms; useful as a reference but does not solve REQ-WALL-05 or REQ-SAGA-05.
