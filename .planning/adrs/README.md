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

## Phase 4 — Game Core

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-014](./ADR-014-bet-as-own-aggregate.md) | Bet is its own aggregate — not nested inside Round | 4 | Accepted | Bet is a sibling-of-Round aggregate referencing `RoundId`; the `Round.bets[]` collection is absent by construction; cross-aggregate consistency for round-crash → all-ACTIVE-bets → LOST flows through per-bet micro-TX in `CrashRoundUseCase`; partial unique index `bets_one_active_per_player` enforces REQ-DOM-02 at the DB before any aggregate code runs. |
| [ADR-015](./ADR-015-crash-point-formula-and-client-seed-derivation.md) | Crash-point formula (Bustabit canon) and per-round client-seed derivation | 4 | Accepted | `HMAC-SHA-256(serverSeed, ${clientSeed}:${nonce})` with `floor((100 * 2^52 - H) / (2^52 - H)) / 100` + 1-in-101 instant-crash bucket; client seed for round N derives via `SHA256(prevRound.id + ":" + prevRound.crashedAt.toISOString())` — public, deterministic, derivable from prior-round CRASHED-time data; genesis uses `SHA256(GENESIS_CLIENT_SEED)`; deliberate variant from Bustabit's fixed-public-salt canon documented. |
| [ADR-016](./ADR-016-hash-chain-pre-generation-depth.md) | Hash chain pre-generation at bootstrap (1M rounds) over lazy generation | 4 | Accepted | `SeedChainBootstrap implements OnApplicationBootstrap` generates `HASH_CHAIN_LENGTH=1000000` entries at first boot via `randomBytes(32)` terminal seed + `SHA256(seed[i+1])` walked in reverse; idempotent on restart via `countEntries() > 0n`; ~80MB transient heap + ~80MB DB storage; one-time commitment story over lazy-refill's head-pointer-mutation attack. |
| [ADR-017](./ADR-017-round-loop-recursive-settimeout-and-on-application-bootstrap.md) | Round loop — recursive `setTimeout` + `OnApplicationBootstrap` over `setInterval` / worker thread | 4 | Accepted | `RoundLoopService implements OnApplicationBootstrap, OnApplicationShutdown` drives the autonomous `BETTING → RUNNING → CRASHED → SETTLED → BETTING` loop; recursive `setTimeout` scheduled once per transition with `crashAt = roundStartedAt + crashTimeMs(crashPoint)`; five-branch `recoverInFlightRound` survives `kill -9` (live SIGKILL drill PASSED at P4.11); single-process scope with documented `pg_try_advisory_lock` scale-out path. |
| [ADR-018](./ADR-018-money-multiply-rounded-bankers-extension.md) | `Money.multiplyRounded` shared-kernel extension for banker's rounding cashout | 4 | Accepted | Dinero v2's `multiply` is precision-preserving (never rounds to currency exponent); `Money.multiplyRounded(factor, mode = "bankers")` composes `multiply` + `transformScale(product, currencyExponent, halfEven)` for banker's rounding at the aggregate boundary; `Bet.cashOut` is the canonical consumer; REQ-DOM-07 satisfied in Phase 4. |

## Phase 5 — Saga Integration

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-019](./ADR-019-orchestration-over-choreography.md) | Orchestration over choreography — Game service owns the bet saga FSM | 5 | Accepted | Game owns `bet_saga_state` (`DEBIT_PENDING → CONFIRMED \| REJECTED \| TIMED_OUT → COMPENSATED`); Wallet is a passive participant; orchestration justified by ≥3-step + branching + timeout + compensation (microservices.io); `@Global()` `MessagingSpineModule` discovery locked as DI contract from P5.10 fix; `SagaTimeoutSweeper` reuses ADR-017 recursive `setTimeout` + `OnApplicationBootstrap`; restart recovery via `FOR UPDATE SKIP LOCKED` over expired `DEBIT_PENDING` rows. |
| [ADR-020](./ADR-020-bet-202-cashout-200-asymmetry.md) | Bet placement asymmetry — `202 Accepted` for bet, synchronous `200 OK` for cashout | 5 | Accepted | `POST /games/bet` returns `202 Accepted` (cross-service AMQP round-trip; saga confirms via WS `bet:active` in Phase 6); `POST /games/bet/cashout` returns synchronous `200 OK` with `{multiplier, payoutCents}` (single-service, single-TX, `cashoutAcceptedAt` stamped before any await per REQ-WS-05); DLX alignment lesson (cross-service queues use source-exchange DLX) from P5.10 fix locked as topology rule for all future cross-service consumers. |

## Phase 6 — WebSocket Gateway & Multiplier Sync

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-021](./ADR-021-single-global-lobby-room.md) | Single global `lobby` room over per-round rooms | 6 | Accepted | Every socket joins exactly `lobby` (public broadcast: round lifecycle + 30Hz tick + masked bet feed) + `user:{playerId}` (private `bet:my_*`), set once at `handleConnection` and never changed; per-round rooms rejected because only one round runs at a time (ADR-017) so they would force a full membership reshuffle every ~7-15s for zero scoping benefit and race the snapshot-on-connect logic. |
| [ADR-022](./ADR-022-30hz-server-tick-60fps-client-interpolation.md) | 30 Hz server tick + 60 fps client interpolation | 6 | Accepted | Server emits authoritative `round:tick` every 33ms via `volatile.emit` on a recursive `setTimeout` loop (`SERVER_TICK_HZ=30`); client (Phase 7) renders at 60fps via rAF computing the multiplier locally from `e^(GROWTH_RATE*t/1000)` anchored to `roundStartedAt` and reconciling toward each tick via EWMA clock-offset; ~50% of 60Hz bandwidth with no smoothness loss. Consequence: standalone Socket.IO server on `WS_PORT=4101` + websocket-only transport (Bun `@nestjs/platform-express` lacks `server.listeners()` for engine.io `attach()` — P6.09 fix). |
| [ADR-023](./ADR-023-server-authoritative-cashout-accepted-at.md) | Server-authoritative `cashoutAcceptedAt` at the HTTP controller's first executable line | 6 | Accepted | `cashoutAcceptedAt = new Date()` is the literal first executable line of `POST /games/bet/cashout` (`bet-command.controller.ts:69`, locked in Phase 5) — the sole authority for cashout-vs-crash race resolution; REQ-WS-05's "gateway middleware" interpreted as the NestJS HTTP controller layer; cashout NOT migrated to a WS inbound message because a WS handler shares the event loop with the 30Hz tick broadcast, delaying the stamp under load and tightening the race; ±50ms race property test (P6.08) covers 50 cases. |

## Phase 7 — Frontend Vertical Slice

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-024](./ADR-024-tanstack-start-oidc-spa-pkce.md) | TanStack Start + `oidc-spa` for OIDC Authorization Code + PKCE (S256) | 7 | Accepted | One `oidc-spa@10.2.3` `createUtils()` instance over raw `oidc-client-ts` / hand-rolled PKCE; PKCE-S256, silent renewal, and multi-tab `BroadcastChannel` are library-internal (zero hand-rolled token code); `enforceLogin` guards the game route; the socket auth function reads a fresh `getAccessToken()` per reconnect; token in memory not `localStorage`; rolling these by hand is the multi-day, storm-prone surface PITFALLS Pitfall 5 warns against. |
| [ADR-025](./ADR-025-canvas-2d-crash-curve.md) | Canvas 2D (rAF + `devicePixelRatio` + `clearRect`) for the crash curve | 7 | Accepted | Canvas 2D over SVG / WebGL (CLAUDE.md §Frontend lock, D-05): SVG mutates a DOM path at 60fps (jank + re-introduces the per-frame layout cost ADR-026 removes), WebGL is over-engineering for one 2D line; immediate-mode clear-then-stroke with dpr backing-store scaling is the lowest-complexity fit; freezes on the server `crashValue` not the last frame (T-07-16); draws off the React render path; renderer reused by Phase 8 replay. |
| [ADR-026](./ADR-026-zustand-isolated-multiplier-store.md) | Zustand slice-per-concern, rAF multiplier loop isolated to its own store | 7 | Accepted | Slice-per-concern stores with the 60fps rendered multiplier in its OWN `multiplier.store` (only the curve + cashout-payout selector subscribe) over one shared store (D-06): isolation is structural, not selector-discipline — a tick write has no subscriber outside the pixel pipeline, so the bet panel / feed / history cannot re-render at 60fps; `round:tick` → multiplier store only (EWMA reconcile, never snaps), asserted by the 07-04 dispatch test. |
| [ADR-027](./ADR-027-oidc-spa-broadcastchannel-multi-tab-refresh.md) | Multi-tab token refresh via `oidc-spa`'s built-in `BroadcastChannel` | 7 | Accepted | The library's internal `BroadcastChannel` election coordinates one-refresh-per-rotation across tabs over hand-rolled cross-tab coordination (REQ-AUTH-03): a second coordinator IS the storm (Pitfall 5 — two mechanisms racing to refresh produce duplicate grants + re-login loop); app adds zero coordination (grep-clean `auth/oidc.ts`), verified by the 07-02 two-tab single-refresh spike. The standing guard against a future plan adding a `BroadcastChannel`/timer. (FE realization of the multi-tab intent the ROADMAP labeled "ADR-022", renumbered to next-free.) |

## Conventions

- **Filename**: `ADR-NNN-<kebab-slug>.md` where NNN is a zero-padded three-digit sequence number. ADRs are numbered globally across the project (not per phase).
- **Status values**: `Accepted` (current), `Superseded by ADR-XXX` (the new ADR replaces this one and records the supersession in its own Context), `Deprecated` (no replacement, decision no longer applies).
- **Date**: ISO-8601 date of the decision (the planning or execution session when the choice was made), not the implementation date.
- **Phase**: the phase number that owns the decision; cross-phase decisions are recorded in the phase that resolves them.
- **Sections**: Context (problem and constraints), Considered (options with brief pros/cons), Decision (chosen option with rationale and citations), Consequences (what is locked in, what is foreclosed), Alternatives Rejected (one line per rejected option).

## Future ADRs

Subsequent phases append ADR-028+ as decisions land. The anticipated catalogue is enumerated in `.planning/ROADMAP.md` under each phase's "Key decisions to make" list. Note: the ROADMAP's per-phase anticipated-ADR numbers are *planning placeholders* — they routinely collide with already-shipped ADRs (Phase 7's anticipated "ADR-019..022" were consumed by Phases 5/6, so the four Phase 7 ADRs took the next-free range ADR-024..027). Shipped ADRs are never renumbered; later phases' anticipated labels likewise resolve to the next-free numbers when those phases ship. Examples still pending:

- Phase 8: replay UI scope and storage shape; client-seed derivation surfacing.
- Phase 9: leaderboard projection store and window granularity; server-enforced auto-cashout; per-session auto-bet config.
- Phase 10: CI gating strategy and observability dashboard ownership; OpenTelemetry SDK choice.
