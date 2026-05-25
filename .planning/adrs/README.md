# Architecture Decision Records — Crash Game

Every significant architectural decision is captured as an ADR following the template in `CLAUDE.md`. ADRs are append-only — supersession is recorded in the new ADR's Status field, never by editing or deleting an existing record. Phase 10 audits the full catalogue against REQ-DOC-02.

Each ADR records the constraints that drove the decision, the alternatives that were considered, the chosen option with rationale linked to source-of-truth research files (STACK.md, SUMMARY.md, PITFALLS.md, phase-N RESEARCH.md), the consequences that the decision locks in, and the alternatives explicitly rejected with one-line "why not" reasons.

## Phase 1 — Foundation & Infra

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-001](./ADR-001-orm-mikroorm.md) | ORM selection — MikroORM 7 | 1 | Accepted | MikroORM 7 chosen over Prisma, TypeORM, and Drizzle for DDD-native Identity Map + Unit of Work + Data Mapper. |
| [ADR-002](./ADR-002-money-dinero-vo.md) | Money representation — Dinero.js v2 wrapped in local VO | 1 | Accepted | Dinero.js v2 (stable, March 2026) wrapped in a project-local `Money` VO; snapshot shape `{ amount: string, currency, scale }` locked for JSON safety. |
| [ADR-003](./ADR-003-bun-pinning.md) | Bun + NestJS pinning strategy | 1 | Accepted | Exact pin `Bun 1.3.11` across `.bun-version`, `packageManager`, and every `oven/bun:1.3.11-alpine` Dockerfile; explicit decorator flags in every tsconfig. |
| [ADR-004](./ADR-004-config-source-of-truth.md) | Configuration source-of-truth shape | 1 | Accepted | Per-service `.env.example` + typed `config/defaults.ts` parsed by zod; ESLint `no-restricted-properties` bans `process.env` outside the config module. |
| [ADR-005](./ADR-005-wallet-seed-strategy.md) | Wallet seed strategy — first-login provisioning | 1 | Accepted | Option C (first-login `POST /wallets` via REQ-WALL-01 idempotency) over one-shot SQL seed (Option A) or boot seeder (Option B); recruiter sees the wallet after one login click. |
| [ADR-006](./ADR-006-eslint-plugin-location.md) | ESLint money-guard plugin location and authoring approach | 1 | Accepted | Workspace package `packages/eslint-plugin` consumed from root flat config; rules authored with `@typescript-eslint/utils` `ESLintUtils.RuleCreator` and fixture-driven tests. |

## Phase 2 — Outbox/Inbox Messaging Spine

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-007](./ADR-007-hand-rolled-outbox-inbox-package.md) | Hand-rolled `@crash/messaging-spine` workspace package | 2 | Accepted | Hand-roll the outbox / inbox / DLQ persister / topology helpers in `packages/messaging-spine/` over `nestjs-outbox` or `pg-transactional-outbox`; auditable in arguição and matches the 25% architecture scoring band. |
| [ADR-008](./ADR-008-amqplib-publisher-golevelup-consumer-split.md) | `amqplib` raw publisher + `@golevelup/nestjs-rabbitmq` consumer split | 2 | Accepted | Raw `amqplib` confirm channel inside `OutboxPublisher` for full `confirmSelect` + `waitForConfirms` lifecycle ownership; `@golevelup/nestjs-rabbitmq` `@RabbitSubscribe` for consumer ergonomics with `@IdempotentSubscribe` stacked on top. |
| [ADR-009](./ADR-009-dlx-with-delivery-limit-on-dlq.md) | DLX with `x-delivery-limit` on the DLQ itself (quorum queues) | 2 | Accepted | Every main queue is quorum with `x-delivery-limit=RMQ_DELIVERY_LIMIT_MAIN` (5) + `x-dead-letter-exchange=<dlx>`; every DLQ is quorum with `x-delivery-limit=RMQ_DELIVERY_LIMIT_DLQ` (3) — bounded poison absorption, no cluster-degradation loops. |
| [ADR-010](./ADR-010-listen-notify-dedicated-pg-client.md) | Dedicated `pg.Client` for LISTEN/NOTIFY outside MikroORM pool | 2 | Accepted | `OutboxListenerService` owns a `new pg.Client(...)` separate from MikroORM's pool with reconnect + 30s `SELECT 1` watchdog; avoids pool starvation that LISTEN's connection-pinning would cause. |

## Phase 3 — Wallet Service

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-011](./ADR-011-ledger-model-wallet-snapshot.md) | Ledger model — Wallet snapshot + immutable Transaction aggregate over event sourcing | 3 | Accepted | `wallets.balance_cents` carries the mutable snapshot (with `CHECK (balance_cents >= 0)` defence-in-depth); every debit/credit appends an immutable `transactions` row referencing `correlationId` + `message_id` (UNIQUE) in the same Postgres TX; O(1) reads, audit trail intact, no event-sourcing rebuild cost. |
| [ADR-012](./ADR-012-jwt-validation-via-cached-jwks.md) | JWT validation via `jose` + cached JWKS at each service over passport-jwt + Kong JWT plugin | 3 | Accepted | Per-service `JwtGuard implements CanActivate` using `jose@^6.2.3` `createRemoteJWKSet` (10-minute `cacheMaxAge`, 30-second `cooldownDuration`) + `jwtVerify`; single dependency, no Passport-decorator + Bun-SWC friction; `KEYCLOAK_AUDIENCE=account` (Option B — accept Keycloak's default for public PKCE clients without a realm mapper). |
| [ADR-013](./ADR-013-idempotent-subscribe-propagates-tx-em.md) | `@IdempotentSubscribe` propagates `txEm` to the handler signature | 3 | Accepted | Decorator passes the transactional `EntityManager` as the third positional argument to wrapped handlers; `OutboxRepository.add(env, route, em?)` accepts an optional EM — handlers thread `txEm` through all four writes (inbox claim, wallet UPDATE, transaction append, outbox row) so they commit in one Postgres TX. Spine public API change (minor). |

## Conventions

- **Filename**: `ADR-NNN-<kebab-slug>.md` where NNN is a zero-padded three-digit sequence number. ADRs are numbered globally across the project (not per phase).
- **Status values**: `Accepted` (current), `Superseded by ADR-XXX` (the new ADR replaces this one and records the supersession in its own Context), `Deprecated` (no replacement, decision no longer applies).
- **Date**: ISO-8601 date of the decision (the planning or execution session when the choice was made), not the implementation date.
- **Phase**: the phase number that owns the decision; cross-phase decisions are recorded in the phase that resolves them.
- **Sections**: Context (problem and constraints), Considered (options with brief pros/cons), Decision (chosen option with rationale and citations), Consequences (what is locked in, what is foreclosed), Alternatives Rejected (one line per rejected option).

## Future ADRs

Subsequent phases append ADR-014+ as decisions land. The anticipated catalogue is enumerated in `.planning/ROADMAP.md` under each phase's "Key decisions to make" list. Examples:

- Phase 4: round FSM transition policy; provably-fair hash chain length; `multiply` rounding mode for cashout payouts; bet-is-its-own-aggregate vs nested-in-Round; recursive `setTimeout` round loop vs `setInterval` / worker thread.
- Phase 5: saga state-machine persistence; compensation policy for insufficient-funds and timeout cases.
- Phase 6: WebSocket room granularity; tick-rate and reconciliation policy.
- Phase 7: frontend routing and auth-loader pattern; canvas renderer life-cycle.
- Phase 8: replay UI scope and storage shape.
- Phase 9: leaderboard projection store and window granularity.
- Phase 10: CI gating strategy and observability dashboard ownership.
