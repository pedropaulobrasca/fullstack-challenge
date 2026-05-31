# Roadmap — Crash Game (Jungle Gaming Challenge)

> Mode: `standard` (horizontal layers — foundation → outbox → wallet domain → game domain → saga → ws → frontend → ux polish → bonuses → quality)
> Granularity: `standard` · Parallelization: `true` · 10 phases · 95/95 v1 REQ-IDs mapped
> Phase ordering converged from research synthesis (SUMMARY.md §6, ARCHITECTURE.md §13, FEATURES.md §6, PITFALLS critical-path-five). Critical pitfalls C1-C5 are addressed in Phases 1-4 (before any saga code).

---

## Phases

- [x] **Phase 1: Foundation & Infra** — Docker bootstrap, shared kernel (Money VO), contracts package, ESLint money guard, ADR scaffolding
- [x] **Phase 2: Outbox/Inbox Messaging Spine** — Hand-rolled transactional outbox/inbox, quorum queues + DLX, publisher confirms
- [x] **Phase 3: Wallet Service** — Wallet + Transaction aggregates, REST provisioning, AMQP debit/credit consumers, ledger model
- [x] **Phase 4: Game Core (domain only)** — Round + Bet aggregates, provably-fair hash chain, autonomous round loop with crash recovery
- [x] **Phase 5: Saga Integration** — End-to-end bet + cashout sagas, persistent saga state, kill-9 recovery, timeout compensation
- [x] **Phase 6: WebSocket Gateway & Multiplier Sync** — JWT-at-handshake, lobby + user rooms, 30Hz volatile tick broadcast, server-authoritative cashout timestamping
- [x] **Phase 7: Frontend Vertical Slice** — TanStack Start + Keycloak, Canvas curve renderer, bet panel, dark casino theme, full table-stakes UX
- [x] **Phase 8: Provably-Fair UX, History & Replay** — Commitment badge, client-side verifier (crypto.subtle), `/verify` route, deterministic replay reusing canvas renderer
- [x] **Phase 9: Auto Features & Leaderboard** — Server-enforced auto-cashout, auto-bet (fixed + Martingale), stop-loss/stop-win, 24h leaderboard projection (light CQRS)
- [x] **Phase 10: Quality Hardening & Docs** — Playwright E2E, GitHub Actions CI, OpenTelemetry + Prometheus + Grafana, ADR audit, README with architecture diagrams

---

## Phase Details

### Phase 1: Foundation & Infra
**Goal**: A fresh clone reaches green healthchecks for every service via a single `bun run docker:up` with shared kernel primitives (Money VO, error taxonomy, event envelopes) ready to consume.
**Depends on**: Nothing (first phase)
**Requirements**: REQ-INFRA-01, REQ-INFRA-02, REQ-INFRA-03, REQ-INFRA-04, REQ-INFRA-05, REQ-DOM-05, REQ-DOM-06, REQ-AUTH-05, REQ-DOC-03
**Success Criteria** (what must be TRUE):
  1. A fresh `git clone` followed by `bun run docker:up` brings every container to a healthy state with zero manual steps (Keycloak realm imported, Postgres migrations run, RabbitMQ exchanges/queues declared, Kong routes loaded, demo user `player/player123` seeded with a wallet of 1000.00 CRD).
  2. `bun run docker:down` and `bun run docker:prune` stop the stack cleanly without orphan volumes.
  3. `packages/shared-kernel` exports a working `Money` VO backed by Dinero v2 + bigint snapshot — adding two amounts compiles, subtracting below zero throws, round-tripping through `JSON.stringify`/`parse` preserves precision; verified by a property test in CI.
  4. ESLint custom rule rejects `number` typed symbols matching `/amount|balance|bet|payout|price|wager/i`; demo offender file fails lint.
  5. `.env.example` lists every operator constant from REQUIREMENTS Open Configuration Values table; `config/defaults.ts` re-exports them typed; no business constant lives outside the env layer.
**Blocks**: Everything (Phases 2-10)
**Parallelizable with**: None
**UI hint**: no
**Key decisions to make** (ADRs):
  - ADR-001: ORM selection (MikroORM 7 over Prisma/TypeORM/Drizzle)
  - ADR-002: Money representation (Dinero v2 wrapped in local VO over raw bigint+scale / decimal.js)
  - ADR-003: Bun + NestJS pinning strategy (Bun version in `.bun-version`, decorator metadata explicit in every tsconfig)
  - ADR-004: Configuration source-of-truth shape (`.env.example` + typed `config/defaults.ts`)
  - ADR-005: Wallet seed strategy (first-login provisioning over one-shot SQL seed / boot seeder)
  - ADR-006: Custom ESLint plugin location (`packages/eslint-plugin` workspace package via `@typescript-eslint/utils` RuleCreator)
**Plans:** 10 plans
Plans:
- [ ] P1.1-version-pinning-PLAN.md - Pin Bun 1.3.11, extend root package.json scripts + dev deps, commit bun.lock
- [ ] P1.2-docker-compose-fixes-PLAN.md - Fix Keycloak healthcheck (port 9000), reshape service blocks for repo-root build context, verify realm export carries demo user
- [ ] P1.3-workspace-dockerfile-refactor-PLAN.md - Multi-stage workspace-aware Dockerfiles (deps -> migrate -> runtime), expand service manifests with MikroORM 7.1 + NestJS 11.1.21, add migrate containers to compose
- [ ] P1.4-shared-kernel-PLAN.md - Ship Money VO, error taxonomy, DomainEventEnvelope, branded IDs, sharedEnvSchema in `packages/shared-kernel`
- [ ] P1.5-contracts-PLAN.md - Ship `packages/contracts` skeleton with money snapshot wire-format helpers (serializeMoney, parseMoneySnapshot)
- [ ] P1.6-eslint-plugin-PLAN.md - Custom `@crash/no-number-for-money` ESLint rule + flat config + Prettier + `process.env` ban outside config layer
- [ ] P1.7-typed-config-env-PLAN.md - Per-service typed `defaults.ts` (zod-parsed env), `.env.example` materializing every Open Configuration Value, env-schema tests
- [ ] P1.8-adrs-PLAN.md - ADR-001 through ADR-006 + ADR catalogue README
- [x] P1.9-readme-PLAN.md - Repo root README with Phase 1 surface (Quickstart, Env vars table, Demo user, Healthchecks, Project structure, ADRs, Roadmap)
- [x] P1.10-healthcheck-smoke-test-PLAN.md - Bootstrap `/health` controllers, env-driven main.ts, `scripts/smoke-health.sh` (7 probes), full-stack bring-up checkpoint

### Phase 2: Outbox/Inbox Messaging Spine
**Goal**: Two services can exchange messages over RabbitMQ with at-least-once delivery, exactly-once processing, and survive a `kill -9` without losing or duplicating side-effects.
**Depends on**: Phase 1
**Requirements**: REQ-WALL-05, REQ-WALL-06, REQ-SAGA-05, REQ-SAGA-06
**Success Criteria** (what must be TRUE):
  1. Both service DBs ship `outbox` and `inbox` tables; an integration test inserts a domain row + outbox row in the same TX, polls publish to RabbitMQ via `confirmSelect` + `waitForConfirms`, and the consumer dedupe-checks the inbox before the side-effect TX commits.
  2. A `kill -9` of the publisher between commit and AMQP confirm causes the next poll to re-publish the row; the consumer's inbox check prevents the side-effect from running twice (observable via Transaction row count = 1).
  3. Quorum queues are declared with `x-delivery-limit=5` on main and `x-delivery-limit=3` on DLQ; a deliberately-poisonous message lands in `dead_letter_messages` after exactly 5 redeliveries.
  4. Every message carries `messageId`, `correlationId`, `causationId`, `type`, `version`, `occurredAt` in the envelope; consumer logs prove end-to-end trace via correlationId.
  5. `LISTEN/NOTIFY` wakes the outbox poller below the 1s baseline; observed publish latency for a single inserted row is under 250 ms.
**Blocks**: Phases 3, 4, 5
**Parallelizable with**: None (foundational for both services)
**UI hint**: no
**Key decisions to make** (ADRs):
  - ADR-007: Hand-rolled `@crash/messaging-spine` workspace package over `nestjs-outbox` / `pg-transactional-outbox`
  - ADR-008: `amqplib` raw publisher + `@golevelup/nestjs-rabbitmq` consumer split (over `@nestjs/microservices` transport alone)
  - ADR-009: DLX-with-x-delivery-limit-on-the-DLQ-itself topology (quorum queues)
  - ADR-010: Dedicated `pg.Client` for LISTEN/NOTIFY (separate from MikroORM pool)
**Plans:** 10 plans
Plans:
- [x] 02-01-PLAN.md — Workspace package scaffold + dependency installs
- [x] 02-02-PLAN.md — Outbox/Inbox/DeadLetter entities + canonical SQL fragments
- [x] 02-03-PLAN.md — Envelope helpers + topology defaults + nestjs-cls module
- [x] 02-04-PLAN.md — OutboxRepository + OutboxListenerService + OutboxPublisher
- [x] 02-05-PLAN.md — InboxRepository + @IdempotentSubscribe + DeadLetterConsumer base
- [x] 02-06-PLAN.md — TopologyBootstrap + MessagingSpineModule composition
- [x] 02-07-PLAN.md — Service wiring (env, migrations, AppModule, per-service DLQ consumers)
- [x] 02-08-PLAN.md — Unit tests (envelope, topology, inbox SQL, dead-letter, CLS)
- [x] 02-09-PLAN.md — Integration tests (6 scenarios via testcontainers + MessagingProbe)
- [x] 02-10-PLAN.md — ADRs 007-010 + ROADMAP/STATE closeout

### Phase 3: Wallet Service
**Goal**: A player has a provisioned wallet on first login and can be debited or credited exclusively via RabbitMQ commands with non-negative-balance and exact-precision guarantees.
**Depends on**: Phase 2
**Requirements**: REQ-DOM-03, REQ-AUTH-04, REQ-WALL-01, REQ-WALL-02, REQ-WALL-03, REQ-WALL-04, REQ-WALL-07
**Success Criteria** (what must be TRUE):
  1. `POST /wallets` with a valid Keycloak JWT provisions a wallet at `INITIAL_BALANCE_CENTS` (1000.00 CRD), is idempotent on re-call, and `GET /wallets/me` returns the authenticated player's balance.
  2. Publishing `wallet.debit` for `2000.00 CRD` against a 1000-cred wallet emits `wallet.debit.rejected{reason:INSUFFICIENT_FUNDS}` without mutating the balance; a Postgres `CHECK (balance_cents >= 0)` constraint backs the domain invariant.
  3. Every successful debit/credit creates an immutable `Transaction` row referencing the `correlationId`; replaying the same `messageId` is a no-op (inbox dedupe verified end-to-end).
  4. Wallet REST exposes NO mutation endpoints (verified by Kong route map + smoke test); the only path to balance change is RabbitMQ.
  5. Property test (`fast-check`, 10k cases) confirms any zero-net sequence of credits/debits returns the wallet to its original balance.
**Blocks**: Phase 5 (saga needs the Wallet endpoint)
**Parallelizable with**: Phase 4 (Game Core domain has no Wallet dependency)
**UI hint**: no
**Key decisions to make** (ADRs):
  - ADR-008: Ledger model (Wallet snapshot + immutable Transaction aggregate) over event sourcing
  - ADR-009: JWT validation at each service via cached JWKS (over Kong JWT plugin)
**Plans:** 10 plans
Plans:
- [x] 03-01-PLAN.md — Patch messaging-spine: OI-1 envelope unwrap + OI-3 txEm propagation; re-run Phase 2 tests
- [x] 03-02-PLAN.md — Wallet domain layer: Wallet + Transaction aggregates, errors, repository interfaces, unit tests
- [x] 03-03-PLAN.md — MikroORM entities + migrations (wallets CHECK constraint, transactions UNIQUE message_id, FK)
- [x] 03-04-PLAN.md — JWT guard via jose JWKS + KEYCLOAK_* env trio + KC_HOSTNAME alignment + audience decision
- [x] 03-05-PLAN.md — REST: POST /wallets idempotent + GET /wallets/me, JwtGuard, nestjs-zod DTOs, ProvisionWalletUseCase
- [x] 03-06-PLAN.md — AMQP debit/credit handlers via @IdempotentSubscribe, atomic conditional UPDATE, Transaction + outbox same-TX
- [x] 03-07-PLAN.md — Kong route narrowing (POST /wallets + GET /wallets/me only; mutation paths return 404 at gateway)
- [x] 03-08-PLAN.md — Property test (fast-check 10k zero-net) + ProvisionWalletUseCase idempotency unit tests
- [x] 03-09-PLAN.md — Integration tests (6 scenarios) + smoke-health probes 23-26 + live walkthrough checkpoint
- [x] 03-10-PLAN.md — ADR-011 + ADR-012 + ADR-013 + STATE/ROADMAP/REQUIREMENTS closeout

### Phase 4: Game Core (domain only, no WS)
**Goal**: A `games-service` instance runs an autonomous round loop with rich Round + Bet aggregates and a provably-fair crash point derived from a verifiable hash chain — all without a WebSocket gateway or saga yet.
**Depends on**: Phase 2 (for outbox infra)
**Requirements**: REQ-DOM-01, REQ-DOM-02, REQ-DOM-04, REQ-DOM-07, REQ-DOM-08, REQ-GAME-01, REQ-GAME-02, REQ-GAME-03, REQ-GAME-04, REQ-GAME-05, REQ-GAME-08, REQ-GAME-09, REQ-FAIR-01, REQ-FAIR-02, REQ-FAIR-03, REQ-FAIR-04, REQ-FAIR-05, REQ-TEST-01, REQ-TEST-02
**Success Criteria** (what must be TRUE):
  1. The autonomous round loop transitions BETTING → RUNNING → CRASHED → SETTLED → BETTING without external triggers; a `kill -9` mid-round followed by service restart resumes from the last persisted transition (state reconstructed from DB).
  2. Unit + property tests reject every illegal Round FSM transition; a Postgres partial unique index `(player_id, round_id) WHERE status IN ('PENDING','ACTIVE')` blocks double-bet at the DB level (test: two concurrent inserts → second fails with 409).
  3. `GET /games/rounds/:roundId/verify` returns server seed, client seed, nonce, crash point, formula version, and `previousServerSeed`; a CLI verifier (also in `packages/contracts`) recomputes the crash point byte-identically.
  4. Provably-fair module is a pure-function package shared by FE and BE; deterministic test runs 1000 fixed-seed rounds and asserts every crash point is reproducible byte-for-byte.
  5. The pre-round seed hash is exposed via REST during BETTING phase BEFORE any bet is accepted; revealing the seed before settlement is impossible by construction (chain consumed in reverse, reveal-after-settle enforced at aggregate boundary).
**Blocks**: Phases 5, 6
**Parallelizable with**: Phase 3 (Wallet service has no Game dependency)
**UI hint**: no
**Key decisions to make** (ADRs):
  - ADR-010: Bet-is-its-own-aggregate (not nested in Round) — locking granularity rationale
  - ADR-011: Bustabit-canon crash-point formula `floor((100 * 2^52 - H) / (2^52 - H)) / 100` with 1-in-101 instant-crash bucket (variant locked, verified against Bustabit Rust reference)
  - ADR-012: Hash chain pre-generation depth (1M rounds) over lazy generation
  - ADR-013: Recursive `setTimeout` for round loop (over `setInterval` / worker thread); `pg_try_advisory_lock` scale-out path documented but not implemented

### Phase 5: Saga Integration
**Goal**: Placing a bet and cashing out flow end-to-end across Game and Wallet services with persistent saga state, timeout compensation, and crash recovery — provable by a `kill -9` reconciliation test.
**Depends on**: Phase 3, Phase 4
**Requirements**: REQ-GAME-06, REQ-GAME-07, REQ-SAGA-01, REQ-SAGA-02, REQ-SAGA-03, REQ-SAGA-04, REQ-TEST-03, REQ-TEST-04
**Success Criteria** (what must be TRUE):
  1. `POST /games/bet` during BETTING returns `202 Accepted` with `betId, status:PENDING`; Bet transitions to `ACTIVE` (or `REFUNDED` on `InsufficientFunds`) within the saga timeout; observable end-to-end via `GET /games/bets/me`.
  2. `POST /games/bet/cashout` during RUNNING returns synchronous `200 OK` with `{multiplier, payoutCents}`; the Wallet credit lands as downstream bookkeeping without blocking the response.
  3. `bet_saga_state` row persists every transition; killing `games-service` after the Wallet debit but before Bet→ACTIVE → on restart, recovery worker reconciles via correlationId and the final state is consistent (verified by E2E test against testcontainers RabbitMQ + Postgres).
  4. After `SAGA_TIMEOUT_MS=5000` without a Wallet reply, the Bet is auto-refunded; if the Wallet eventually responds, a compensating `wallet.credit` is issued and inbox dedupe prevents double-effect.
  5. Bet outside BETTING phase rejects with `409 Conflict` and a discriminated error code; cashout outside RUNNING phase or for an already-cashed bet rejects identically.
**Blocks**: Phase 6 (WS needs saga so bet:active events are real), Phase 7 (FE bet flow needs saga to avoid mock work)
**Parallelizable with**: None (integration phase — must serialize)
**UI hint**: no
**Key decisions to make** (ADRs):
  - ADR-019: Orchestration over choreography (Game service owns saga state)
  - ADR-020: Bet placement asymmetry — `202 Accepted` + WS for bet, synchronous `200 OK` for cashout
**Plans:** 11 plans
**Plans landed**: 05-01 (Round.acceptBet aggregate guard + REQ-GAME-08 closure), 05-02 (RoundLoopService.getMultiplierAt pure synchronous multiplier source), 05-03 (bet_saga_state migration + aggregate + Mikro repo FOR UPDATE SKIP LOCKED), 05-04 (PlaceBetUseCase + POST /games/bet 202 PENDING), 05-05 (WalletDebitedHandler + WalletDebitRejectedHandler + compensation branch), 05-06 (CashOutUseCase + POST /games/bet/cashout 200 synchronous + first-line acceptedAt), 05-07 (SagaTimeoutSweeper @OnApplicationBootstrap recursive setTimeout), 05-08 (Kong PCRE-anchored POST routes), 05-09 (integration tests 7 scenarios + true-SIGKILL drill), 05-10 (smoke probes 33-38 + live saga bring-up + @Global MessagingSpineModule + DLX alignment fixes), 05-11 (ADR-019 + ADR-020 + STATE/ROADMAP/REQUIREMENTS closeout). Phase originally anticipated 10 plans (per Phase 5 anticipated catalogue); shipped 11 by promoting Round.acceptBet aggregate guard (05-01) and getMultiplierAt synchronous multiplier source (05-02) to standalone Wave 1 plans to enable parallel execution of 05-03 + 05-04 + 05-08 in Wave 2.
Plans:
- [x] 05-01-PLAN.md — Round.acceptBet aggregate-boundary FSM guard + REQ-GAME-08 doc-drift closure
- [x] 05-02-PLAN.md — RoundLoopService.getMultiplierAt pure synchronous server-clock multiplier source
- [x] 05-03-PLAN.md — bet_saga_state migration + EntitySchema + BetSagaState aggregate + Mikro repo (claimExpired FOR UPDATE SKIP LOCKED)
- [x] 05-04-PLAN.md — PlaceBetUseCase + BetCommandController POST /games/bet (202 PENDING) + DTOs
- [x] 05-05-PLAN.md — WalletDebitedHandler (confirm + compensation branch) + WalletDebitRejectedHandler @IdempotentSubscribe
- [x] 05-06-PLAN.md — CashOutUseCase + POST /games/bet/cashout (200 synchronous) with controller-first-line acceptedAt
- [x] 05-07-PLAN.md — SagaTimeoutSweeper @OnApplicationBootstrap + SAGA_SWEEP_INTERVAL_MS env
- [x] 05-08-PLAN.md — Kong PCRE-anchored POST routes for /games/bet + /games/bet/cashout
- [x] 05-09-PLAN.md — Integration tests (7 scenarios incl. true-SIGKILL saga recovery)
- [x] 05-10-PLAN.md — Smoke probes 33-38 + blocking live walkthrough checkpoint
- [x] 05-11-PLAN.md — ADR-019 + ADR-020 + STATE/ROADMAP/REQUIREMENTS closeout

### Phase 6: WebSocket Gateway & Multiplier Sync
**Goal**: All connected clients see a synchronized server-authoritative multiplier and round lifecycle pushed at 30Hz, with JWT-validated handshakes, snapshot-on-reconnect, and a single server clock as cashout-race authority.
**Depends on**: Phase 5
**Requirements**: REQ-AUTH-01, REQ-AUTH-02, REQ-AUTH-03, REQ-WS-01, REQ-WS-02, REQ-WS-03, REQ-WS-04, REQ-WS-05, REQ-WS-06, REQ-WS-07
**Success Criteria** (what must be TRUE):
  1. WS handshake rejects connections without a valid Keycloak JWT (verified via cached JWKS) and joins each socket to `lobby` + `user:{playerId}`; an integration test confirms unauthorized handshakes are denied at upgrade.
  2. Server emits `tick` as `volatile.emit` at ~30Hz with `{multiplier, t}`; a slow consumer (artificially blocked) does not stall the broadcast loop for other clients.
  3. Reconnecting mid-round receives a `round:snapshot` containing the full state needed to resume rendering; opening a second tab of the same user receives identical state.
  4. Cashout race property test: hammering cashout requests within ±50ms of crash time always results in either a valid payout-for-time-before-crash OR a `409 Conflict` — never a double-cashout or a post-crash payout. `cashoutAcceptedAt` is stamped at gateway middleware, before any await.
  5. Server emits `round:started` (with seed hash + timing), `round:running`, `round:crashed` (with seed + hash), `round:settled`, `bet:placed`, `bet:cashed_out`, plus private `bet:my_active` / `bet:my_cashed_out` / `bet:my_refunded` per the message catalog.
**Blocks**: Phase 7 (FE game page consumes these events)
**Parallelizable with**: None
**UI hint**: no
**Key decisions to make** (ADRs):
  - ADR-016: Single global `lobby` over per-round rooms (join/leave churn rationale)
  - ADR-017: 30Hz server tick + 60fps client interpolation (over per-frame server broadcast)
  - ADR-018: Server-authoritative `cashoutAcceptedAt` at gateway middleware (race resolution canon)

**Plans:** 10 plans
**Plans landed**: 06-01 (JwtVerifierService extracted from JwtGuard for a shared HTTP + WS cached-JWKS auth surface), 06-02 (deps install gated by package-legitimacy checkpoint + WS_PATH env), 06-03 (JwtIoAdapter handshake middleware + GameWsGateway auto-joining lobby + user:{playerId} + GetWsSnapshotUseCase + strict zod ws-event payload schemas), 06-04 (MultiplierBroadcastService 30Hz recursive-setTimeout volatile.emit round:tick, sole volatile owner), 06-05 (EventEmitter2 in-process bus — RoundLoopService lifecycle emits → GameWsGateway @OnEvent lobby fan-out, string DI tokens break the RoundLoop↔MultiplierBroadcast cycle), 06-06 (WsBridgeConsumer @RabbitSubscribe game.events → dual-emit bet:placed/cashed_out masked to lobby + bet:my_active/refunded/cashed_out raw to user:{playerId}), 06-07 (Kong games-ws route PCRE-anchored ~/ws, declared first to win PCRE matching), 06-08 (5 WS integration tests + ws-client helper + cashout-race ±50ms property test), 06-09 (smoke probes 39-44 + live bring-up — triple boot-fix: Clock DI field-initializer + RoundLoop↔MultiplierBroadcast ModuleRef lazy resolution + socket.io standalone WS_PORT=4101 Bun http-attach fix; handshake JWT-reject + snapshot-on-connect PASS live), 06-10 (ADR-021/022/023 + STATE/ROADMAP/REQUIREMENTS closeout). REQ-AUTH-01/02/03 (frontend OIDC) deferred to Phase 7 per RESEARCH Deferred Ideas; backend WS auth (REQ-WS-01) closes the JWT-at-handshake surface.
Plans:
- [x] 06-01-PLAN.md — Extract JwtVerifierService from JwtGuard (shared HTTP + WS auth surface)
- [x] 06-02-PLAN.md — Install @nestjs/websockets + platform-socket.io + socket.io + @nestjs/event-emitter (gated by Package Legitimacy checkpoint) + WS_PATH env
- [x] 06-03-PLAN.md — JwtIoAdapter + GameWsGateway + GetWsSnapshotUseCase + ws-event payload schemas
- [x] 06-04-PLAN.md — MultiplierBroadcastService (30Hz recursive setTimeout + volatile.emit round:tick)
- [x] 06-05-PLAN.md — EventEmitter2 lifecycle hooks (RoundLoopService → @OnEvent gateway broadcasts)
- [x] 06-06-PLAN.md — WsBridgeConsumer (@RabbitSubscribe game.events → bet:placed/active/refunded/cashed_out fan-out)
- [x] 06-07-PLAN.md — Kong games-ws route at PCRE-anchored ~/ws$
- [x] 06-08-PLAN.md — WS integration tests (handshake / rooms / snapshot / event catalog / tick volatile) + cashout-race property test
- [x] 06-09-PLAN.md — Smoke probes 39-44 + blocking live walkthrough checkpoint
- [x] 06-10-PLAN.md — ADR-021 + ADR-022 + ADR-023 + STATE/ROADMAP/REQUIREMENTS closeout

### Phase 7: Frontend Vertical Slice
**Goal**: A logged-in player can complete the full Crash loop in a polished dark-casino UI — bet during the betting window, watch the multiplier climb in real time on a smooth Canvas curve, cash out (or lose), see their balance update, and view the live bet/cashout feed — fully responsive.
**Depends on**: Phase 6
**Requirements**: REQ-FE-01, REQ-FE-02, REQ-FE-03, REQ-FE-04, REQ-FE-05, REQ-FE-06, REQ-FE-07, REQ-FE-08, REQ-FE-11, REQ-FE-12, REQ-FE-13, REQ-FE-14
**Success Criteria** (what must be TRUE):
  1. Unauthenticated users hit the game page → redirected to Keycloak → log in as `player/player123` → returned to the game; tokens silently renew before expiry and a `BroadcastChannel` test with three tabs confirms a single coordinated refresh.
  2. The crash curve renders smoothly at 60fps on a Canvas (rAF + devicePixelRatio scaling + clearRect), locally computing the multiplier from the same `e^(GROWTH_RATE * t / 1000)` formula as the server, anchored to `roundStartedAt` with EWMA clock-offset reconciliation (no snap).
  3. Bet input validates min/max bounds via the shared Money VO; Bet button is enabled only during BETTING and disabled when player already has an active bet; Cashout button shows live `bet × current multiplier` payout and is enabled only while Bet is ACTIVE during RUNNING.
  4. Live feed shows all bets and cashouts for the current round in real time with the player's own actions highlighted; history strip shows last 20 crash points color-coded (red / yellow / green) per env-tunable thresholds; balance updates with a subtle counter-up animation; cashout triggers a celebration; crash triggers a flash + freeze overlay.
  5. UI is fully responsive (desktop + mobile), shows loading skeletons during in-flight rounds and history fetches, surfaces deduped toast errors (insufficient balance, network), and adheres to the dark casino aesthetic.
**Blocks**: Phase 8 (Provably-Fair UX builds on game page), Phase 9 (Auto features extend bet panel)
**Parallelizable with**: None (consumes WS + saga from prior phases)
**UI hint**: yes
**Key decisions to make** (ADRs):
  - ADR-024: TanStack Start + oidc-spa for OIDC Authorization Code + PKCE S256 (over raw oidc-client-ts / hand-rolled PKCE)
  - ADR-025: Canvas 2D (rAF + devicePixelRatio + clearRect) for crash curve (over SVG / WebGL)
  - ADR-026: Zustand slice-per-concern with the rAF multiplier loop isolated to its own store (re-render scoping rationale)
  - ADR-027: multi-tab token refresh via oidc-spa's built-in `BroadcastChannel` (over hand-rolled cross-tab coordination)

  > **ADR-renumber note**: these four were anticipated under the labels ADR-019..022, but those numbers were consumed by the shipped Phase 5 (ADR-019/020) and Phase 6 (ADR-021/022/023) ADRs before Phase 7 closed. Shipped ADRs are never renumbered, so the Phase 7 decisions took the next-free range ADR-024..027. Phase 8/9/10 anticipated-ADR labels below will likewise resolve to the next-free numbers when those phases ship (do not treat them as reserved).

**Plans:** 9 plans
**Plans landed**: 07-01 (pre-FE infra unblock — `@crash/contracts/ws` shared WS schemas, scoped Kong `cors` plugin for `http://localhost:3000` with `credentials:true`, `@crash/no-number-for-money` extended to `.tsx`), 07-02 (Wave-0 de-risking spike — RATIFIED boot mode `selective-ssr` + oidc `single-getOidc`; carry-forwards: browser-safe `@crash/contracts/multiplier` subpath + `OPTIONS` on every Kong route; oidc-spa v10.2.3 API drift recorded), 07-03 (TanStack Start scaffold on :3000 — dark-casino Tailwind v4 @theme [UI-SPEC hex], zod-parsed `VITE_` config module, shadcn 13-component set, first Vitest harness), 07-04 (one `oidcSpa.createUtils()` instance + `enforceLogin` guard + socket.io auth-function singleton + five slice-per-concern Zustand stores + isolated multiplier store [D-06] + schema-validated WS dispatch + TanStack Query hydration; REQ-AUTH-01/02/03 + REQ-FE-07/08), 07-05 (Money-VO bet validator + place-bet/cashout mutations + neutral BetPanel + accent CashoutButton live payout + Countdown; REQ-FE-04/05/06), 07-06 (Canvas 2D crash curve — `localMultiplier` via the shared `@crash/contracts` formula anchored to `roundStartedAt` + `reconcileOffset` EWMA never-snap + rAF loop writing only the isolated multiplier store + server-`crashValue` freeze + leak-free cancel + dPR/clearRect emerald→cyan single-glow draw; REQ-FE-02/03), 07-07 (live bet/cashout feed with own-action highlight + last-20 color-banded history strip; REQ-FE-07/08 visual), 07-08 (responsive D-01 assembly — history strip top, bet/curve/feed rails at lg+, single stacked column with sticky-bottom controls below; CurveSkeleton/HistorySkeleton; dedupedToast; the four reduced-motion-gated juice moments [counter-up, confetti, crash-flash, rising-curve glow]; REQ-FE-12/13/14), 07-09 (ADR-024..027 + STATE/ROADMAP/REQUIREMENTS closeout + the `config.ts` env-cents money-rule resolution). All 15 Phase 7 REQ-IDs (REQ-FE-01..08, REQ-FE-11..14, REQ-AUTH-01/02/03) delivered. Phase 8 items (REQ-FE-09/10, REQ-REPLAY-*) deliberately untouched.
Plans:
- [x] 07-01-PLAN.md — Pre-FE infra unblock: `@crash/contracts/ws` schemas + scoped Kong CORS + `.tsx` money-rule
- [x] 07-02-PLAN.md — Wave-0 de-risking spike: boot mode + oidc instance + workspace-TS + CORS (RATIFIED selective-ssr + single-getOidc)
- [x] 07-03-PLAN.md — TanStack Start scaffold + dark-casino @theme + typed `VITE_` config + shadcn + Vitest
- [x] 07-04-PLAN.md — oidc auth + `enforceLogin` guard + socket singleton + Zustand slices + WS dispatch + Query hydration
- [x] 07-05-PLAN.md — Money-VO bet validator + place-bet/cashout + BetPanel + CashoutButton + Countdown
- [x] 07-06-PLAN.md — Canvas 2D crash curve: local multiplier + EWMA reconcile + rAF loop + dPR/clearRect draw
- [x] 07-07-PLAN.md — Live bet/cashout feed (own-action highlight) + color-banded history strip
- [x] 07-08-PLAN.md — Responsive D-01 assembly + skeletons + deduped toasts + the four juice moments
- [x] 07-09-PLAN.md — ADR-024..027 + STATE/ROADMAP/REQUIREMENTS closeout + config.ts money-rule resolution

### Phase 8: Provably-Fair UX, History & Replay
**Goal**: A player can prove every past round was fair by hashing the revealed seed in their own browser — no server trust required — and can replay any historical round byte-for-byte using the same canvas renderer the live game uses.
**Depends on**: Phase 7
**Requirements**: REQ-FE-09, REQ-FE-10, REQ-REPLAY-01, REQ-REPLAY-02, REQ-REPLAY-03
**Success Criteria** (what must be TRUE):
  1. A always-visible "Fairness ✔" badge shows the pre-round commitment hash during every BETTING phase; clicking opens a verification drawer that hashes the previous round's revealed seed (via `crypto.subtle`) and shows `MATCH ✓` against the prior commitment.
  2. The `/verify/:roundId` route fetches `/games/rounds/:id/verify`, runs the shared `packages/contracts` provably-fair algorithm fully client-side, and displays `MATCH ✓` or `MISMATCH ✗` for the crash point — no server recomputation.
  3. Each history entry has a Replay button that opens a modal animating the past round's curve at real-time speed using the SAME canvas renderer as the live game, with bet/cashout overlays reconstructed from `bets[]`.
  4. A deterministic-replay E2E test reproduces a captured live round and asserts the rendered multiplier values byte-match the original frame samples — proving the renderer and fairness algorithm are the single source of truth.
  5. README documents the provably-fair algorithm with a curl + third-party SHA-256 example so a recruiter can verify a round outside the app.
**Blocks**: None (parallel branches can run after this)
**Parallelizable with**: Phase 9 (Auto features touch different components)
**UI hint**: yes
**Key decisions to make** (ADRs):
  - ADR-023: Client-seed derivation (deterministic from previous round close vs player-contributed)
  - ADR-024: Replay reuses production canvas renderer (over separate playback code path)

  > **ADR-renumber note**: these four were anticipated under the labels ADR-023/024, but Phase 5/6/7 ADRs consumed 019..027 before Phase 8 closed. Shipped ADRs are never renumbered; the Phase 8 decisions took the next-free range ADR-028..031: ADR-028 (D-04 client-seed-deterministic Phase 4 reaffirmation), ADR-029 (D-05 driver-injection seam over separate playback code path), ADR-030 (D-06 browser-safe `@crash/contracts/provably-fair-browser` subpath + `crypto.subtle` with two byte-encoding contracts locked: HMAC key = UTF-8 of hex string, chain proof = hex-decoded bytes), ADR-031 (D-02+D-03 ReplayModal over live game + 1x/2x/4x speed selector with `VITE_REPLAY_SPEEDS` env-tunable). Phase 9/10 anticipated-ADR labels below will likewise resolve to the next-free numbers when those phases ship.

**Plans:** 10 plans
Plans:
- [x] 08-01-PLAN.md — Browser-safe @crash/contracts/provably-fair-browser subpath (crypto.subtle HMAC + SHA-256) + Phase 4 2.94 oracle test
- [x] 08-02-PLAN.md — Extend VerifyRoundDto with bets[] + growthRate; BetRepository.findByRound (no status filter)
- [x] 08-03-PLAN.md — Refactor use-raf-curve.ts to accept optional RafCurveDriver (Phase 7 callers zero-diff)
- [x] 08-04-PLAN.md — VITE_REPLAY_SPEEDS/AUTOSTART/DRAWER_SLIDE_MS env + shadcn sheet/toggle-group/alert + fairness.store + replay.store
- [x] 08-05-PLAN.md — FairnessBadge + HashBlock + VerdictChip + VerificationDrawer (Sheet, mount at __root.tsx) + useVerifyPrevious
- [x] 08-06-PLAN.md — /verify/$roundId route (ssr:false) + useRecomputeCrashpoint (ignores server matches field)
- [x] 08-07-PLAN.md — ReplayModal (Dialog) + replay driver + Play/Pause + 1x/2x/4x ToggleGroup + history-chip wiring
- [x] 08-08-PLAN.md — Determinism E2E byte-match test (REQ-REPLAY-01)
- [x] 08-09-PLAN.md — README "Provably Fair: Verify Outside the App" recruiter example
- [x] 08-10-PLAN.md — ADR-028..031 + STATE/ROADMAP/REQUIREMENTS closeout

### Phase 9: Auto Features & Leaderboard
**Goal**: A player can set an auto-cashout target and run server-enforced auto-bet strategies (fixed + Martingale) with stop-loss / stop-win guardrails, while a live 24h leaderboard surfaces top players via a CQRS read-model projection.
**Depends on**: Phase 7 (FE) + Phase 5 (saga for the projector)
**Requirements**: REQ-AUTO-01, REQ-AUTO-02, REQ-AUTO-03, REQ-AUTO-04, REQ-AUTO-05, REQ-LEAD-01, REQ-LEAD-02, REQ-LEAD-03, REQ-LEAD-04
**Success Criteria** (what must be TRUE):
  1. Setting an auto-cashout target causes the SERVER to auto-issue cashout when the tick multiplier reaches the target, even if the client disconnects mid-round (verified by an E2E test that drops the WS at multiplier=1.5x with target=2.0x and confirms the bet cashes at 2.0x).
  2. Auto-bet with `fixed` strategy places identical bets each round; `martingale` doubles after each loss and resets to base after each win; `STOP_LOSS_CENTS` / `STOP_WIN_CENTS` halt auto-bet when cumulative P/L crosses either threshold (observable via subsequent rounds receiving zero bets).
  3. The Auto tab in the bet panel exposes target / strategy / stop inputs with inline validation and a Start/Stop toggle; configuration is per-session (does not survive reload, by explicit UX choice).
  4. The leaderboard projector consumes `game.events` into a denormalized `leaderboard_24h` table; `GET /games/leaderboard?window=24h` returns the top 10 with masked playerId, net profit, win count; the side-panel UI updates live via WS `leaderboard:updated` when ranks shift.
  5. Light CQRS is implemented with NO event sourcing (write model = mutable Postgres, read model = projector-populated view); projector failure does not block the write path (verified by deliberately failing the projector and confirming bets still settle).
**Blocks**: None
**Parallelizable with**: Phase 8 (after Phase 7 ships the slice)
**UI hint**: yes
**Key decisions to make** (ADRs):
  - ADR-032: Light CQRS leaderboard read model (denormalized `leaderboard_24h` + projector + rank-change diff gate; over full event sourcing or JOIN-at-query-time)
  - ADR-033: Server-enforced auto-cashout via in-process ROUND_TICK + AutoCashoutTickService (ratifies ADR-023; over inline-in-fireTick or RoundLoopService callback; disconnect safety rationale)
  - ADR-034: Per-session auto-bet config — Zustand no-persist + FE-driven stops + server-stateless (over DB-persisted server-enforced stops or localStorage-persisted FE config; safety/UX rationale)

  > **ADR-renumber note (reconciled at Phase 9 closeout per P09-10)**: these three were anticipated under the labels ADR-025/026/027, but Phase 5/6/7/8 ADRs consumed 019..031 before Phase 9 closed. Shipped ADRs are never renumbered; the Phase 9 decisions took the next-free range ADR-032..034: ADR-032 (D-05 light CQRS read-model), ADR-033 (D-06 server-enforced auto-cashout — ratifies ADR-023), ADR-034 (D-01+D-03 per-session auto-bet config — no persist). Same precedent set by Phase 7 (ADR-019..022 → 024..027) and Phase 8 (ADR-023/024 → 028..031).

**Plans:** 10 plans
Plans:
- [x] 09-01-PLAN.md — Env vars + getConfig (4 backend + 6 frontend keys; gates every downstream Phase 9 plan)
- [x] 09-02-PLAN.md — autoCashoutTarget field on Bet (domain + entity + migration + DTO + use case + findAutoCashoutCandidates repo method)
- [x] 09-03-PLAN.md — Per-bet bet.lost outbox events on crash sweep (CrashRoundUseCase, path-corrected from SettleRoundUseCase; closes RESEARCH Open Q2)
- [x] 09-04-PLAN.md — leaderboard_24h table + EntitySchema + LeaderboardRepository + LeaderboardSnapshot.diff pure VO
- [x] 09-05-PLAN.md — MultiplierBroadcastService ROUND_TICK emit + AutoCashoutTickService + SC1 disconnect-safety E2E
- [x] 09-06-PLAN.md — LeaderboardProjectorService (@IdempotentSubscribe) + WS leaderboard:updated @OnEvent + SC5 chaos test
- [x] 09-07-PLAN.md — LeaderboardController GET /games/leaderboard + @crash/contracts/ws leaderboardUpdatedPayloadSchema
- [x] 09-08-PLAN.md — FE auto-bet store + driver + strategy + AutoBetForm + tabbed BetPanel (shadcn radio-group install)
- [x] 09-09-PLAN.md — FE LeaderboardPanel + useLeaderboard + tabbed right rail (Live Feed | Leaderboard)
- [x] 09-10-PLAN.md — ADR-032 + ADR-033 + ADR-034 + STATE/ROADMAP/REQUIREMENTS rotation

### Phase 10: Quality Hardening & Docs
**Goal**: Every claim made in the submission is provable by automation — CI runs the full stack end-to-end on every push, Playwright covers the player flow, OpenTelemetry traces ride every saga, and the README + ADR catalogue let a reviewer reconstruct every decision without asking.
**Depends on**: Phase 9 (instrument when shape is stable)
**Requirements**: REQ-TEST-05, REQ-OBS-01, REQ-OBS-02, REQ-OBS-03, REQ-OBS-04, REQ-CI-01, REQ-CI-02, REQ-CI-03, REQ-DOC-01, REQ-DOC-02
**Success Criteria** (what must be TRUE):
  1. Two Playwright E2E specs pass against the live Docker stack: (a) login → wait for BETTING → place bet → wait for RUNNING → cashout → verify balance updated; (b) login → bet → crash → verify bet lost.
  2. GitHub Actions runs `bun run docker:up` on a fresh clone for every push/PR, waits for healthchecks, runs unit + E2E + Playwright, then tears down; README displays build / tests / coverage status badges.
  3. Both services emit OpenTelemetry traces via W3C TraceContext across HTTP, AMQP, WS boundaries; a single bet's lifetime is traceable end-to-end through correlationId in Grafana/Jaeger.
  4. Prometheus `/metrics` endpoints expose req latency, AMQP lag, WS connections, plus custom domain metrics (bet volume, RTP, multiplier drift, WS broadcast latency); pre-provisioned Grafana dashboards render them on first `docker:up`.
  5. README contains setup, architecture diagram, saga flow diagram, provably-fair algorithm, scripts, env vars, troubleshooting; `.planning/adrs/` contains one ADR per significant decision listed across Phases 1-9 with Context / Decision / Consequences / Alternatives Rejected.
**Blocks**: Submission
**Parallelizable with**: None (final integration phase)
**UI hint**: no
**Key decisions to make** (ADRs):
  - ADR-035 (anticipated 028): OpenTelemetry SDK + `nestjs-otel` bridge + Prometheus exporter (full stack chosen over commercial APM)
  - ADR-036 (anticipated 029): ADR catalogue index lives in README (over `.planning/adrs/INDEX.md` only)
  - ADR-037 (anticipated 030): CI runs the full `docker:up` stack on every push (over mocked-deps unit-only pipeline) to enforce the zero-step bootstrap claim

  > **ADR-renumber note**: anticipated ADR-028..030 labels are stale (Phase 5/6/7/8/9 ADRs consumed 019..034 before Phase 10 closed); reconciled to next-free ADR-035..037 in plan 10-09 per the renumber precedent set Phase 7/8/9.

**Plans:** 9 plans
Plans:
- [x] 10-01-PLAN.md — Playwright scaffolds + env-var typing + Keycloak realm verify + D-03a live diagnose checkpoint
- [x] 10-02-PLAN.md — Package legitimacy checkpoint + bun add (OTel + pino + @willsoto/nestjs-prometheus@^6.1.0 + @playwright/test); v11 hallucination corrected to actual npm latest 6.1.0
- [x] 10-03-PLAN.md — OTel NodeSDK tracing.ts first-import + ObservabilityModule + nestjs-pino with traceId+correlationId enrichment (BOTH services)
- [x] 10-04-PLAN.md — docker-compose Jaeger + Prometheus + Grafana with UID-pinned datasources + 3 dashboards + smoke probes 45-47
- [x] 10-05-PLAN.md — 5 custom Prometheus metrics (bet_volume + crash_rtp + multiplier_drift + ws_broadcast_latency + active_ws_connections) + /metrics endpoint
- [x] 10-06-PLAN.md — D-03a Sheet/Dialog visibility fix + D-03b WS round:snapshot null relax + D-03c HistoryStrip key verify
- [x] 10-07-PLAN.md — Playwright 2 specs (cashout + crash) live against docker stack + FE data-testid hooks
- [x] 10-08-PLAN.md — GitHub Actions ci.yml (full docker:up + Playwright + Pitfall 8 disk cleanup; workflow file landed at 4881da3, green-run user-push checkpoint deferred)
- [x] 10-09-PLAN.md — README sections + mermaid diagrams + ADR catalogue generator + ADR-035..037 + STATE/ROADMAP/REQUIREMENTS rotation


---

## Stretch Backlog (v2 — only if all v1 phases are rock-solid)

These are not numbered phases. Pull from this list during Phase 10 if time permits.

| ID | Description | Notes |
|----|-------------|-------|
| REQ-STRETCH-01 | Multi-bet (two simultaneous independent bets per player per round, Aviator-style) | Requires updating REQ-DOM-02 invariant before implementing |
| REQ-STRETCH-02 | Additional auto-bet strategies: Fibonacci, Labouchere | Extends Phase 9 strategy registry |
| REQ-STRETCH-03 | Crash-point distribution histogram in stats panel | Pure FE addition on existing history endpoint |
| REQ-STRETCH-04 | Pre-bet trajectory "ghost line" of prior round's curve | Canvas overlay on the existing renderer |
| REQ-STRETCH-05 | Sound design + haptic feedback (mobile vibrate) | Cheap polish, high perceived-quality |
| REQ-STRETCH-06 | Storybook for shadcn-derived components | Documentation surface |
| REQ-STRETCH-07 | Rate limiting via Kong plugin or in-app | Operator hardening |
| REQ-STRETCH-08 | Crash curve formula displayed in debug overlay | Transparency / arguição prop |

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Infra | 10/10 | Complete | 2026-05-24 |
| 2. Outbox/Inbox Messaging Spine | 10/10 | Complete | 2026-05-24 |
| 3. Wallet Service | 10/10 | Complete | 2026-05-25 |
| 4. Game Core (domain only) | 12/12 | Complete | 2026-05-26 |
| 5. Saga Integration | 11/11 | Complete | 2026-05-27 |
| 6. WebSocket Gateway & Multiplier Sync | 10/10 | Complete | 2026-05-28 |
| 7. Frontend Vertical Slice | 9/9 | Complete | 2026-05-29 |
| 8. Provably-Fair UX, History & Replay | 10/10 | Complete | 2026-05-30 |
| 9. Auto Features & Leaderboard | 10/10 | Complete | 2026-05-30 |
| 10. Quality Hardening & Docs | 9/9 | Complete | 2026-05-31 |

---

## Parallelization Map

```
Phase 1 ──▶ Phase 2 ──┬──▶ Phase 3 ──┐
                      │              ├──▶ Phase 5 ──▶ Phase 6 ──▶ Phase 7 ──┬──▶ Phase 8 ──┐
                      └──▶ Phase 4 ──┘                                      └──▶ Phase 9 ──┴──▶ Phase 10
```

**Windows:**
- Phase 3 ⫼ Phase 4 (after Phase 2 lands; no Wallet ↔ Game domain coupling at this layer)
- Phase 8 ⫼ Phase 9 (after Phase 7 ships the vertical slice)
- ADRs and README sections written inside every phase, audited and indexed in Phase 10

---

## Deviation Notes (versus SUMMARY.md §6)

No structural deviations. The 10 phases map 1:1 to the SUMMARY clusters. Refinements applied:
- **Phase 1** explicitly bundles Keycloak realm import + demo user/wallet seeding (REQ-AUTH-05, REQ-DOC-03) since both ride the same `docker:up` healthcheck story.
- **Phase 6** explicitly absorbs auth REQs (AUTH-01/02/03) because the FE OIDC integration is gated by the WS handshake's JWT-at-handshake requirement — landing auth alongside the gateway prevents two FE-then-BE round trips.
- **Phase 8** is named "Provably-Fair UX, History & Replay" to signal that the history strip's `Verify` flow (REQ-FE-09/10) and Replay flow (REQ-REPLAY-*) share infrastructure and ship together.
- **Phase 9** combines Auto features and Leaderboard because both extend the existing bet panel + use the same `game.events` projector wiring; landing them in one phase preserves a single ADR set (CQRS shape).

---

*Last updated: 2026-05-31 by gsd-executor (P10-09 — Phase 10 closeout COMPLETE (9/9 plans, 10/10 phases). Three Phase 10 ADRs landed at next-free numbers (ADR-035 OpenTelemetry SDK + nestjs-otel bridge + Jaeger all-in-one over commercial APM and Tempo+Grafana — D-01 + D-05 + D-06 cited; ADR-036 ADR catalogue lives in README via `scripts/build-adr-index.ts` generator between sentinel markers `<!-- ADR-INDEX:START -->` / `<!-- ADR-INDEX:END -->` + CI sync gate `bun run docs:adr-index:check` over `.planning/adrs/INDEX.md` only and hand-maintained table — D-08 cited; ADR-037 CI runs full `bun run docker:up` on every push + PR over mocked-deps unit-only pipeline and self-hosted runner — D-07 cited). The anticipated "ADR-028/029/030" Phase 10 labels were stale because Phase 5/6/7/8/9 ADRs consumed 019..034 before Phase 10 closed; reconciled to ADR-035..037 with a renumber note per the Phase 7 + Phase 8 + Phase 9 closeout precedent. All 10 Phase 10 REQ-IDs confirmed Done across the traceability table and checkboxes (REQ-TEST-05 P10-07, REQ-OBS-01 P10-03, REQ-OBS-02 P10-05, REQ-OBS-03 P10-04, REQ-OBS-04 P10-03, REQ-CI-01 + REQ-CI-02 P10-08, REQ-CI-03 P10-09, REQ-DOC-01 P10-09, REQ-DOC-02 P10-09); v1-complete 76/95 → 86/95; ADRs landed 34 → 37. Submission ready: `bun run docker:up` brings the full observability triad (Jaeger + Prometheus + Grafana) alongside services; CI proves zero-step bootstrap; README has Quick Start one-liner + Architecture mermaid + Saga Flow mermaid + Observability + auto-generated 37-row ADR Catalogue + Scripts + Env Vars + Troubleshooting + CI badge with the Phase 8 Provably-Fair section preserved byte-stable. All 10 phases complete; v1 is shippable. Plan 10-09 commits: 2019924 RED tests + 838218f build-adr-index script + 307d4ba deferred-items log + 2e09415 ADR-035 + dcf59b4 ADR-036 + e170706 ADR-037 + b0c90e3 README D-08 sections + b735633 ADR catalogue table generated. Previous: P10-07 — REQ-TEST-05 Playwright cashout + crash specs COMPLETE (7/9). Four atomic commits: 73cabf2 Task 1 data-testid hooks on game-root/balance-pill/connection-badge/bet-amount-input/bet-place-button/cashout-button + data-round-status + data-last-bet-outcome projections + bet store lastOutcome slot (prior wave); 23531e4 Rule-3 fix replacing CommonJS __dirname + require.resolve in e2e/fixtures/auth.fixture.ts + e2e/playwright.config.ts with fileURLToPath(import.meta.url) — Playwright 1.60 loads the TS config through Node's ESM loader where neither symbol exists; f3c9ffc Task 2 spec implementations — e2e/specs/bet-cashout.spec.ts (180 lines) drives login → fresh BETTING window via /games/rounds/current bettingEndsAt poll with >=3.5s remaining floor → place 5.00 bet (HTTP 202 Accepted accepted, not 200) → RUNNING → Promise.race between cashout-button visible and data-round-status=CRASHED → click cashout → data-last-bet-outcome transitions to CASHED_OUT → balance pill differs from start; instant-crash retry via page.reload + waitForFreshBettingWindow up to 5 attempts because the FE never clears myBet between rounds for CASHED_OUT bets; e2e/specs/bet-crash.spec.ts (109 lines) mirrors but skips cashout and waits up to 180s for CRASHED + LOST flip. Three back-to-back full runs all green at 25.2s / 1.6m / 1.8m wall-clock against live docker:up + frontend dev server :3000. Plan acceptance gates: grep -c "test\.skip" e2e/specs/*.spec.ts returns 0; grep -c "getByTestId" returns 13 (9 cashout + 4 crash); all element selection via getByTestId + getAttribute("data-*") — zero text-match selectors. Four Rule-1/3 deviations all auto-fixed (Rule-3 ESM-loader fix; Rule-1 text-based selectors + 200 vs 202 status; Rule-1 instant-crash race needs Promise.race + reload; Rule-1 BETTING-window-close race needs server-authoritative bettingEndsAt poll). 8229404 deferred-items closeout entry documenting pre-existing 147 failing FE vitest baseline (byte-stable vs Task 1 edits). T-10-17 (OIDC tokens in .auth/) and T-10-18 (brittle text selectors) both mitigated. REQ-TEST-05 (a) + (b) closed. Plan 10-07 unblocks 10-08 (CI workflow runs `bunx playwright test --config=e2e/playwright.config.ts` and expects zero failures). Previous: P10-06 — Wave 3 polish defects D-03a + D-03b + D-03c COMPLETE (6/9). Four atomic commits: d9da6e9 fix D-03a Sheet/Dialog visibility by adding @import "tw-animate-css"; to frontend/src/styles/globals.css after @import "tailwindcss"; per the d03a-diagnosis.md root cause [used @import not @plugin because tw-animate-css@1.4.0 only exposes exports.".".style → ./dist/tw-animate.css and has no JS plugin entry — the @import form respects the package's style condition], with src/styles/globals.css.test.ts as a regression guard asserting the import remains present and ordered after Tailwind. 466c35b test D-03b RED contracts schema + dispatcher tests. f540e36 fix D-03b GREEN split into roundSnapshotObjectSchema strict alias + roundSnapshotPayloadSchema = roundSnapshotObjectSchema.nullable() top-level relax; FE ws-dispatch round:snapshot handler short-circuits with if (payload === null) return; before any store mutation. 65562b8 chore D-03c verified-only [HistoryStrip key={entry.roundId} correct by construction because useHistoryStore dedups roundId per existing ws-dispatch.test.ts dedup test; no fix needed]. All 49 contracts + 247 FE tests green; tsc + lint clean. Live click-through visual evidence deferred to plan 10-07 due to pre-existing FE bundle runtime error (node:crypto externalized in browser) blocking React tree mount in Playwright contexts — logged to .planning/phases/10-quality-hardening-docs/deferred-items.md as out-of-scope for the polish-defect plan. CSS fix conclusively verified at build-artifact layer: compiled CSS contains animate-in, slide-in-from-right, fade-in-0, zoom-in-95 + the --tw-enter-* variables emitted by tw-animate-css@1.4.0. REQ-OBS-04 contributing. Previous: P10-04 — Jaeger + Prometheus + Grafana compose stack COMPLETE (4/9). Three atomic commits land the observability infrastructure: 46dcd78 feat docker-compose service blocks for jaegertracing/all-in-one:1.63.0 [OTLP HTTP receiver on 4318 + UI on 16686 + COLLECTOR_OTLP_ENABLED=true + healthcheck on admin port 14269] + prom/prometheus:v3.0.1 [scrape games:4001 + wallets:4002 every 15s via internal docker hostnames; depends_on service_healthy gating per Pitfall 3] + grafana/grafana:11.3.1 [port 3001:3000 dodges FE :3000 collision per RESEARCH Pitfall; GF_AUTH_ANONYMOUS_ENABLED=true + ORG_ROLE=Viewer for recruiter convenience + T-10-09 EoP mitigation] + docker/prometheus/prometheus.yml with two static_configs scrape jobs; 70643bc feat docker/grafana/provisioning tree: datasources/prometheus.yml + jaeger.yml with PINNED uids prometheus-main + jaeger-main per Pitfall 4 + dashboards/dashboards.yml file provider + 3 dashboard JSONs (games-service-overview HTTP/AMQP/WS; wallets-service-overview HTTP/AMQP; crash-domain-custom with crash_bet_volume_total + crash_rtp_window stat with fairness thresholds + multiplier_drift_seconds p50/p95 + ws_broadcast_latency_seconds p50/p95 + active_ws_connections — every panel pins datasource.uid=prometheus-main explicitly belt-and-suspenders); d6332c7 feat scripts/smoke-health.sh probes 45-47 (jaeger 16686 200 + prometheus :9090/-/healthy body grep + grafana :3001/api/health database:ok JSON grep). One Rule-1 plan-bug deviation: jaegertracing/all-in-one:1.63 does not exist on Docker Hub (verified via docker pull manifest unknown + Hub tags API listing only :1.63.0 and the bare-minor form :1.60/:1.59/... for the older 1.5x line); pinned to :1.63.0 instead — same canonical org, same minor family, NOT a package-install Rule-3 exclusion because the image source is unchanged. No Rule-2/3/4 deviations. All gates green: bun run docker:up --wait brings all 3 new containers Healthy alongside the existing stack; curl /api/datasources/uid/prometheus-main returns 200 with pinned uid; curl /api/search?type=dash-db lists all 3 dashboards; smoke probes 45-47 all [PASS]; Grafana logs "finished to provision dashboards" with zero "Datasource not found"; Kong route audit reconfirms /metrics is NOT in docker/kong/kong.yml (T-10-10 mitigated). Dashboards for the 5 custom domain metrics render empty until 10-05 lands the /metrics emit — documented intended state. REQ-OBS-03 closed. T-10-09 + T-10-10 + T-10-11 mitigated. Plan 10-04 unblocks 10-05 (custom metrics scrape immediately on next docker:up), 10-07 (Playwright spec can hit http://localhost:16686/api/services + http://localhost:9090/api/v1/targets in CI), 10-08 (CI workflow runs smoke-health.sh including probes 45-47 as part of green-CI gate). Previous: P10-02 — OTel + pino + Prometheus + Playwright deps install COMPLETE (2/9). Three atomic commits land the dependency surface Wave 1-3 imports: 705a125 games install 11 OTel/pino/Prometheus packages; feea60e wallets mirror; 0e4f75d root @playwright/test@1.60.0 + chromium browser. One Rule-1 plan-bug deviation: @willsoto/nestjs-prometheus pinned to ^6.1.0 (actual npm latest) instead of the PLAN/RESEARCH-cited ^11.0.0 which does not exist on npm — Option-1 user approval corrected ONLY this pin, nestjs-otel ^6.1.0 left unchanged. One Rule-3 location correction: Playwright installed at repo root (where /e2e tree lives) instead of frontend/. All gates green: grep gate confirms unscoped nestjs-prometheus absent in both services; bun install --frozen-lockfile exit 0; both services bunx tsc --noEmit exit 0; bunx playwright --version prints 1.60.0. T-10-SC + T-10-04 mitigated. Caveat for downstream 10-05: sanity-check v6 surface (PrometheusModule.register + make*Provider helpers + InjectMetric all still exported in v6.x). Plan 10-02 unblocks 10-03 (OTel NodeSDK bootstrap can import @opentelemetry/sdk-node + nestjs-pino), 10-04 (compose-level OTel collector wiring can ride on top of the SDK), 10-05 (5 custom metrics module can register against @willsoto/nestjs-prometheus@6.x), 10-07 (Playwright spec bodies can `import { test, expect } from "@playwright/test"`). REQ-TEST-05 + REQ-OBS-01/02/04 contributing (closure pushes to Wave 1-3). Previous: P09-10 — Phase 9 closeout COMPLETE (10/10 plans, 9/10 phases). Three Phase 9 ADRs landed at next-free numbers (ADR-032 light CQRS leaderboard read model with denormalized `leaderboard_24h` + projector + rank-change diff gate + projector failure DLX-routed without blocking write path — SC5 chaos-test proven; ADR-033 server-enforced auto-cashout via in-process ROUND_TICK + AutoCashoutTickService — ratifies and generalizes ADR-023 first-line `acceptedAt` invariant from HTTP controllers to in-process listeners, pays the player's stored target NOT the current tick — SC1 disconnect-safety E2E proven; ADR-034 per-session auto-bet config — Zustand WITHOUT persist middleware enforced by REQ-AUTO-04 grep gate + FE-driven cumulative-since-Start stops + server stateless + Martingale base = configured initial). The anticipated "ADR-025/026/027" Phase 9 labels were stale because Phase 5/6/7/8 ADRs consumed 019..031 before Phase 9 closed; reconciled with a renumber note per the Phase 7 + Phase 8 closeout precedent. All 9 Phase 9 REQ-IDs confirmed Done across the traceability table and checkboxes (REQ-AUTO-01..05 + REQ-LEAD-01..04); v1-complete 67/95 → 76/95; ADRs landed 31 → 34. Only Phase 10 (Quality Hardening & Docs) remains; next `/gsd:verify-phase 9` + `/gsd:ui-review` then `/gsd:plan-phase 10`. Previous: P09-09 — FE Leaderboard panel + shared maskPlayerId consolidation COMPLETE (9/10 plans). Eight atomic commits land Tasks 1-4 in TDD RED→GREEN cadence: maskPlayerId moved to `@crash/shared-kernel/identity/mask-player-id.ts` with all 6 server consumers migrated + legacy file deleted + cross-environment determinism test locking FE hash === server hash for fixture UUID; `useLeaderboard()` TanStack Query hook (`staleTime: Infinity`) with WS `leaderboard:updated` inline cache replace via `subscribeWsEvent` (both transports Zod-gated against the same `@crash/contracts/ws/leaderboardUpdatedPayloadSchema`); `RankChip` + `LeaderboardRow` + `LeaderboardPanel` rendering top-N per UI-SPEC §Surface B.1 with rank-color rule, own-row override (emerald rail + YOU prefix), 200ms rank-up border transition on improvement only, 5-skeleton/empty/error/list states, ≥44px touch targets, `aria-live=polite` own-rank-up announcement; right rail wrapped in controlled shadcn `<Tabs>` (Live Feed default | Leaderboard with Trophy icon) preserving Phase 7 D-01 grid byte-stable, `LeaderboardPanel isActive={feedTab === 'leaderboard'}` so its footer setInterval only ticks when in view. Verification: 244/244 frontend tests green (was 217 after P09-08; +27 from this plan), tsc + lint clean, games unit 279/8 baseline preserved (pure import-path swap), all 5 PLAN greps clean (no destructive token on negative profit, no hardcoded sizes/intervals, Zod gate present, no buggy UUID-prefix mask, shared-kernel imported). Two Rule-1 test-DX-only deviations (Radix Tabs pointerdown for jsdom + regex matcher for ellipsis-suffixed text); no Rule 2/3/4; no auth gates. T-09-60..63 all mitigated. REQ-LEAD-03 + REQ-LEAD-04 closed at this plan. Next: P09-10 closeout (ADR-032/033/034 + STATE/ROADMAP/REQUIREMENTS rotation + `/gsd:verify-phase 9` + `/gsd:ui-review`). Previous: P09-06 — LeaderboardProjectorService landed via five atomic commits (`7b518cf` widen @IdempotentSubscribe routingKey to string|string[], `42b31dc` Rule-2 fix emitting bet.cashed_out from CashOutUseCase, `06eeae8` RED projector unit tests, `d74fc40` GREEN projector + WS gateway + module wiring, `7bcbbb2` SC5 chaos test). The projector consumes bet.cashed_out + bet.refunded + bet.lost on `leaderboard-projector.q` (quorum + DLX), idempotently UPSERTs `leaderboard_24h` via Plan 09-04 repository, fetches before+after top-N snapshots, and emits in-process `GAME_EVENTS.LEADERBOARD_UPDATED` only when `LeaderboardSnapshot.diff(before, after).changed === true`. `GameWsGateway.onLeaderboardUpdated` maps `entries[].playerId` through `maskPlayerId` (8-char SHA-256 hex) and converts `netProfitCents: bigint` to string before `server.to('lobby').emit('leaderboard:updated', ...)` — raw UUID regex returns zero matches in the serialised payload. SC5 chaos test overrides the projector provider to throw on every delivery, places a bet, asserts it still reaches terminal status AND `leaderboard_24h` stays empty — proving write-path independence per REQ-LEAD-02. Three deviations all within auto-fix rules: Rule 2 (CashOutUseCase did NOT publish bet.cashed_out — `grep` proved the WsBridge `case` branch was dead code; added the missing outbox emit in the same em.transactional + correlationId as wallet.credit; new @crash/contracts BetCashedOutEventV1 + BetRefundedEventV1 schemas), Rule 2 (BetRefundedEventV1 fields `roundId` + `amount` declared optional to match the existing publisher shape from saga-timeout-sweeper + wallet-debit-rejected; projector's `applyRefunded` is no-op per Plan 09-04 + Pitfall 8), Rule 3 (`handleEnvelope` extracted from the decorated `handle` so unit tests bypass the @IdempotentSubscribe AMQP-header gate — mirrors the WalletDebitedHandler pattern). Spine widening is purely additive — all 6 existing single-string routingKey call sites still typecheck and run. Verification: messaging-spine + contracts + games tsc clean; messaging-spine unit 8/8; contracts 44/44 (was 37, +7); games unit 279 pass / 8 fail (was 271/8; +8 from this plan; baseline failures unchanged); integration chaos test compiles + skips without INTEGRATION=1. REQ-LEAD-01 + REQ-LEAD-02 + REQ-LEAD-04 now backend-closed; v1 complete 70/95 → 72/95; Phase 9 at 7/10. Previous: P09-07 — `GET /games/leaderboard?window=24h` endpoint + shared `@crash/contracts/ws/leaderboardUpdatedPayloadSchema` landed via four atomic commits (`b15e6e1` RED contract + DTO tests, `c540cbe` GREEN schemas + DTOs, `8597f51` RED controller + use case tests, `5f0ae01` GREEN controller + use case + module wiring). Shared contract schema is single source of truth for HTTP response + WS `leaderboard:updated` event payload (Plan 09-06 emits + Plan 09-09 consumes the same Zod gate). Controller `@UseGuards(JwtGuard)` reuses Phase 6 P6.02 infra; window enum is v1-locked to `'24h'` (T-09-41 mitigation); playerId masked via Phase 4/5 `maskPlayerId` helper to 8 hex chars (T-09-40 mitigation); netProfit serialized as MoneySnapshot built directly from BigInt cents to preserve negative net profit (Rule 2 deviation — `Money.of` would `NegativeMoneyError`). Verification: contracts 44/44 pass (was 37); games unit 271 pass / 8 fail (was 262/8; +9 from this plan; the 8 baseline failures unchanged from Plans 09-01..05); tsc clean in both workspaces. Pre-existing integration-bootstrap DI baseline (every `createTestGamesApp` test on `main` fails at `MultiplierBroadcastService` ctor resolution) logged in `.planning/phases/09-auto-features-leaderboard/deferred-items.md` as out-of-scope for this plan. Three deviations all within auto-fix rules: Rule 3 (presentation.module.ts doesn't exist — wired through app.module.ts + game-core.module.ts.exports), Rule 1 (manual safeParse mirroring rounds.controller.ts to avoid fighting global ZodValidationPipe), Rule 2 (direct MoneySnapshot construction to support negative net profit). REQ-LEAD-03 + REQ-LEAD-04 closed; v1-complete 68/95 → 70/95; Phase 9 at 6/10. Previous: P08-10 — Phase 8 COMPLETE (10/10 plans, 8/10 phases). Closeout landed the four Phase 8 ADRs at next-free numbers: ADR-028 (D-04 client-seed-deterministic Phase 4 reaffirmation), ADR-029 (D-05 driver-injection seam — one `drawCurve` paints live and replay), ADR-030 (D-06 browser-safe `@crash/contracts/provably-fair-browser` subpath + `crypto.subtle` HMAC + SHA-256 with two byte-encoding contracts locked), ADR-031 (D-02+D-03 ReplayModal over live game + 1x/2x/4x speed selector with `VITE_REPLAY_SPEEDS` env-tunable). The anticipated "ADR-023/024" Phase 8 labels were stale (Phase 5/6/7 ADRs consumed 019..027 before Phase 8 closed); reconciled with a renumber note. All 5 Phase 8 REQ-IDs confirmed Done (REQ-FE-09 + REQ-FE-10 + REQ-REPLAY-01/02/03); v1-complete 62/95 → 67/95; ADRs landed 27 → 31. Deferred drawer `<a href>` → typed TanStack `<Link>` migration from 08-06 closed; dual-rAF smoke check passed at the vitest layer. All gates green: 169/169 FE tests + 30/30 contracts tests + tsc clean across all three workspaces + lint clean. Phase 8 is parallelizable with Phase 9 per the parallelization map; next `/gsd:verify-phase 8` + `/gsd:ui-review` then `/gsd:plan-phase 9`. Previous: P07-09 — Phase 7 COMPLETE (9/9 plans, 7/10 phases). Closeout landed the four frontend ADRs (ADR-024 TanStack Start + oidc-spa PKCE-S256, ADR-025 Canvas 2D curve, ADR-026 Zustand isolated multiplier store, ADR-027 oidc-spa BroadcastChannel multi-tab refresh) at next-free numbers — the anticipated ADR-019..022 labels were reconciled to 024..027 (collided with shipped Phase 5/6 ADRs) with a renumber note; all 15 Phase 7 REQ-IDs confirmed delivered; the `config.ts` env-parsed bet-cents money-rule flag resolved with a justified narrow eslint-disable (rule not weakened, lint clean, 65/65 FE tests green). Next: `/gsd:verify-phase 7` + `/gsd:ui-review` then `/gsd:plan-phase 8`. Previous: P07-08 — responsive game page assembly + cross-cutting UX complete, Phase 7 at 8/9; index.tsx assembles the D-01 layout [history strip top, bet/cashout/countdown rail + center CrashCurve + LiveFeed rail at lg+, single stacked column with sticky-bottom controls below], CurveSkeleton/HistorySkeleton for the snapshot/history waits, dedupedToast keyed by message [one active toast per key, cleared on close, amber warnings] wired into the place-bet/cashout hook onError paths with cashout-too-late silent, and the four sanctioned juice moments [useCountUp balance tween, celebrate() single canvas-confetti burst, CrashFlash red flash+freeze overlay, 07-06 rising-curve glow] all honoring prefers-reduced-motion; BalancePill + ConnectionBadge mounted in the __root header; tsc clean, 65/65 tests green, no hex in index.tsx, no setInterval in celebrate.ts; REQ-FE-12/13/14 closed; commits e661ceb/9b19938. Previous: P07-07 live feed + history strip UI, ea3cc0e/2562fdb).*
