# Roadmap — Crash Game (Jungle Gaming Challenge)

> Mode: `standard` (horizontal layers — foundation → outbox → wallet domain → game domain → saga → ws → frontend → ux polish → bonuses → quality)
> Granularity: `standard` · Parallelization: `true` · 10 phases · 95/95 v1 REQ-IDs mapped
> Phase ordering converged from research synthesis (SUMMARY.md §6, ARCHITECTURE.md §13, FEATURES.md §6, PITFALLS critical-path-five). Critical pitfalls C1-C5 are addressed in Phases 1-4 (before any saga code).

---

## Phases

- [ ] **Phase 1: Foundation & Infra** — Docker bootstrap, shared kernel (Money VO), contracts package, ESLint money guard, ADR scaffolding
- [x] **Phase 2: Outbox/Inbox Messaging Spine** — Hand-rolled transactional outbox/inbox, quorum queues + DLX, publisher confirms
- [x] **Phase 3: Wallet Service** — Wallet + Transaction aggregates, REST provisioning, AMQP debit/credit consumers, ledger model
- [x] **Phase 4: Game Core (domain only)** — Round + Bet aggregates, provably-fair hash chain, autonomous round loop with crash recovery
- [ ] **Phase 5: Saga Integration** — End-to-end bet + cashout sagas, persistent saga state, kill-9 recovery, timeout compensation
- [ ] **Phase 6: WebSocket Gateway & Multiplier Sync** — JWT-at-handshake, lobby + user rooms, 30Hz volatile tick broadcast, server-authoritative cashout timestamping
- [ ] **Phase 7: Frontend Vertical Slice** — TanStack Start + Keycloak, Canvas curve renderer, bet panel, dark casino theme, full table-stakes UX
- [ ] **Phase 8: Provably-Fair UX, History & Replay** — Commitment badge, client-side verifier (crypto.subtle), `/verify` route, deterministic replay reusing canvas renderer
- [ ] **Phase 9: Auto Features & Leaderboard** — Server-enforced auto-cashout, auto-bet (fixed + Martingale), stop-loss/stop-win, 24h leaderboard projection (light CQRS)
- [ ] **Phase 10: Quality Hardening & Docs** — Playwright E2E, GitHub Actions CI, OpenTelemetry + Prometheus + Grafana, ADR audit, README with architecture diagrams

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
  - ADR-014: Orchestration over choreography (Game service owns saga state)
  - ADR-015: Bet placement asymmetry — `202 Accepted` + WS for bet, synchronous `200 OK` for cashout

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
  - ADR-019: TanStack Start + oidc-spa for OIDC PKCE (over raw oidc-client-ts)
  - ADR-020: Canvas 2D for crash curve (over SVG / WebGL)
  - ADR-021: Zustand slice-per-concern with the multiplier rAF loop isolated to its own store (re-render scoping rationale)
  - ADR-022: `BroadcastChannel`-coordinated token refresh across tabs

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
  - ADR-025: Light CQRS with denormalized read models (over full event sourcing)
  - ADR-026: Server-enforced auto-cashout (over client-driven; disconnect safety rationale)
  - ADR-027: Per-session auto-bet config (over persisted; safety/UX rationale)

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
  - ADR-028: OpenTelemetry SDK + `nestjs-otel` bridge + Prometheus exporter (full stack chosen over commercial APM)
  - ADR-029: ADR catalogue index lives in README (over `.planning/adrs/INDEX.md` only)
  - ADR-030: CI runs the full `docker:up` stack on every push (over mocked-deps unit-only pipeline) to enforce the zero-step bootstrap claim

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
| 4. Game Core (domain only) | 0/0 | Not started | - |
| 5. Saga Integration | 0/0 | Not started | - |
| 6. WebSocket Gateway & Multiplier Sync | 0/0 | Not started | - |
| 7. Frontend Vertical Slice | 0/0 | Not started | - |
| 8. Provably-Fair UX, History & Replay | 0/0 | Not started | - |
| 9. Auto Features & Leaderboard | 0/0 | Not started | - |
| 10. Quality Hardening & Docs | 0/0 | Not started | - |

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

*Last updated: 2026-05-25 by gsd-executor (P3.10 closeout — Phase 3 complete, 3/10 phases done).*
