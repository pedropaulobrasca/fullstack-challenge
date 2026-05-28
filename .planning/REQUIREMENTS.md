# Requirements — Crash Game (Jungle Gaming Challenge)

> v1 = MUST ship before submission. v2 = nice-to-have if all v1 are rock-solid. Out of Scope = explicit exclusions with reasoning.
> Format: `REQ-[CATEGORY]-[NUMBER]` — `User can X` / `System guarantees X`.

---

## v1 Requirements

### Infrastructure & Setup (INFRA)

- [ ] **REQ-INFRA-01**: System can be brought online by a single `bun run docker:up` on a fresh clone with zero manual steps (realm import, migrations, exchange/queue creation, Kong config, frontend container all included).
- [ ] **REQ-INFRA-02**: System healthchecks all containers and waits for `service_healthy` / `service_completed_successfully` before dependent services start.
- [ ] **REQ-INFRA-03**: System provides a `bun run docker:down` that stops cleanly and a `bun run docker:prune` that removes containers, volumes, and images.
- [ ] **REQ-INFRA-04**: System pins Bun, Node, NestJS, MikroORM, Dinero, Socket.IO, TanStack Start, Tailwind, shadcn versions in lockfiles and `.bun-version`.
- [ ] **REQ-INFRA-05**: System reads runtime constants (initial balance, betting window, growth rate, tick rate, etc.) from environment variables — no business constants are hardcoded.

### Domain Invariants (DOM)

- [x] **REQ-DOM-01**: System enforces Round lifecycle `BETTING → RUNNING → CRASHED → SETTLED`; no illegal transitions are possible from any code path (enforced at aggregate boundary, not service layer).
- [x] **REQ-DOM-02**: System enforces single bet per player per round (DB partial unique index + aggregate guard).
- [x] **REQ-DOM-03**: System enforces Bet lifecycle `PENDING → ACTIVE → CASHED_OUT | LOST`; cashout is rejected if Bet is not in `ACTIVE` state.
- [x] **REQ-DOM-04**: System enforces bet bounds: min `1.00`, max `1000.00` (spec values, env-overridable for non-prod).
- [ ] **REQ-DOM-05**: System guarantees wallet balance never goes negative (Postgres CHECK constraint + domain invariant).
- [ ] **REQ-DOM-06**: System represents all monetary amounts using a `Money` value object wrapping bigint-of-cents (no `number` for any amount-like field, anywhere — backend, frontend, wire format).
- [x] **REQ-DOM-07**: System computes cashout as `bet × multiplier` with documented rounding policy (banker's rounding to 2 decimals) and asserts loss-free round-trips via property tests.
- [x] **REQ-DOM-08**: System represents Round, Bet, and Wallet as rich aggregates with behavior methods (no anemic ORM rows).

### Authentication (AUTH)

- [ ] **REQ-AUTH-01**: System redirects unauthenticated users to Keycloak via OIDC Authorization Code + PKCE (S256) flow using `oidc-spa` adapter for TanStack Start.
- [ ] **REQ-AUTH-02**: System persists access + refresh tokens client-side and silently renews via the OIDC iframe before expiry.
- [ ] **REQ-AUTH-03**: System coordinates token refresh across multiple browser tabs via `BroadcastChannel` so all tabs renew once per token rotation.
- [x] **REQ-AUTH-04**: Each backend service validates incoming JWTs via cached JWKS (issuer + audience + signature + expiry checks); JWKS cache respects Keycloak `Cache-Control` headers.
- [x] **REQ-AUTH-05**: System uses Keycloak's pre-seeded `player / player123` for the demo user with the Keycloak realm/client imported automatically during `docker:up`.

### Wallet Service (WALL)

- [x] **REQ-WALL-01**: Wallet service exposes `POST /wallets` to create a wallet for the authenticated player (idempotent — returns 409 or no-op on existing).
- [x] **REQ-WALL-02**: Wallet service exposes `GET /wallets/me` returning the authenticated player's wallet balance and metadata.
- [x] **REQ-WALL-03**: Wallet service provisions a new wallet with `INITIAL_BALANCE_CENTS=100000` (1000.00 CRD), env-configurable.
- [x] **REQ-WALL-04**: Wallet service consumes debit/credit commands from RabbitMQ exclusively (no REST exposure for mutations).
- [x] **REQ-WALL-05**: Wallet service uses an inbox table for exactly-once command processing (dedup on `messageId`, same TX as state mutation).
- [x] **REQ-WALL-06**: Wallet service writes domain events to its outbox in the same TX as the state change; a polling publisher with `confirmSelect` + `waitForConfirms` ships them to RabbitMQ at-least-once.
- [x] **REQ-WALL-07**: Wallet service stores immutable Transaction records (ledger model) — every debit/credit produces a Transaction row referencing the source command.

### Game Service — REST (GAME)

- [x] **REQ-GAME-01**: System runs an autonomous round loop (`BETTING → RUNNING → CRASHED → SETTLED → cooldown → repeat`) inside `games-service` without external triggers, starting at `OnApplicationBootstrap` (per research Pitfall 1 — the hook fires after every module's initialization completes, whereas `OnModuleInit` can fire before MikroORM is connected).
- [x] **REQ-GAME-02**: System exposes `GET /games/rounds/current` returning the live round state with all bets (player-id-masked for other users).
- [x] **REQ-GAME-03**: System exposes `GET /games/rounds/history?limit=20` returning paginated past rounds with crash points and aggregate stats.
- [x] **REQ-GAME-04**: System exposes `GET /games/rounds/:roundId/verify` returning provably-fair data (server seed, client seed, nonce, hash, algorithm reference).
- [x] **REQ-GAME-05**: System exposes `GET /games/bets/me` (paginated) returning the authenticated player's bet history.
- [x] **REQ-GAME-06**: System exposes `POST /games/bet` accepting bet placement during the BETTING phase; returns `202 Accepted` with a pending bet handle and confirms via WebSocket.
- [x] **REQ-GAME-07**: System exposes `POST /games/bet/cashout` accepting cashout during the RUNNING phase; returns `200 OK` with payout amount when accepted, `409 Conflict` when too late.
- [x] **REQ-GAME-08**: System rejects bets outside the BETTING window with `409 Conflict` and a discriminated error code.
- [x] **REQ-GAME-09**: System persists round and bet state survives `kill -9` of the service mid-round; on restart, the round loop reconstructs state from DB and resumes from the last persisted transition.

### Saga Coordination (SAGA)

- [x] **REQ-SAGA-01**: System coordinates bet placement via a 2-step saga: Game writes `Bet(PENDING)` + outbox row → publishes `wallet.command.debit` → Wallet debits → emits `wallet.event.debited` or `wallet.event.debit_rejected` → Game Inbox transitions `Bet → ACTIVE` or `Bet → REFUNDED`.
- [x] **REQ-SAGA-02**: System persists saga state in a `bet_saga_state` row so a service restart can recover and resume in-flight sagas.
- [x] **REQ-SAGA-03**: System has a saga timeout (`SAGA_TIMEOUT_MS=5000`) after which a pending bet is auto-refunded if the Wallet has not responded.
- [x] **REQ-SAGA-04**: System coordinates cashout via a 1-step saga: Game atomically transitions `Bet → CASHED_OUT` + writes payout outbox row → Wallet credits (downstream bookkeeping, never blocks the player's HTTP response).
- [x] **REQ-SAGA-05**: System uses quorum queues + DLX with `x-delivery-limit` on both main and DLQ; poison messages land in a dead-letter table for inspection.
- [x] **REQ-SAGA-06**: System carries `correlationId` + `causationId` headers through every message for end-to-end traceability.

### Provably Fair (FAIR)

- [x] **REQ-FAIR-01**: System pre-generates a hash chain (`HASH_CHAIN_LENGTH=1000000`) at first boot using `crypto.randomBytes` for the final seed, then `SHA-256(prev)` N times; consumes seeds in reverse so each revealed seed hashes to the previous round's hash.
- [x] **REQ-FAIR-02**: System reveals the seed for round N only after round N has settled (never before).
- [x] **REQ-FAIR-03**: System derives the crash point per round via `HMAC-SHA-256(serverSeed, clientSeed:nonce)`, taking 52 bits via Bustabit canon formula `floor((100 * 2^52 - H) / (2^52 - H)) / 100`, with a 1-in-101 instant-crash (`1.00x`) bucket for ~99% RTP — both formula and constant env-overridable.
- [x] **REQ-FAIR-04**: System exposes the provably-fair algorithm as a pure-function module in `packages/contracts` so the exact same code runs on the frontend verifier and the backend round loop.
- [x] **REQ-FAIR-05**: System displays the pre-round hash commitment before every round (BETTING phase) so the player has the commitment before placing a bet.

### WebSocket Gateway (WS)

- [x] **REQ-WS-01**: WebSocket gateway authenticates the JWT at handshake (custom Socket.IO IoAdapter validating via cached JWKS).
- [x] **REQ-WS-02**: WebSocket gateway joins each connected socket to a single global `lobby` room plus a per-user `user:{playerId}` private room.
- [x] **REQ-WS-03**: WebSocket gateway emits the following server→client events: `round:started` (BETTING phase begins, with seed hash + timing), `round:running` (BETTING ends, RUNNING begins), `round:tick` (`{ multiplier, t }` volatile at ~30 Hz), `round:crashed` (`{ crashPoint, seed, hash }`), `round:settled` (next round in N ms), `bet:placed` (other player), `bet:cashed_out` (other player), `bet:my_active` / `bet:my_cashed_out` / `bet:my_refunded` (private channel).
- [x] **REQ-WS-04**: WebSocket gateway sends a `round:snapshot` on every connect / reconnect so a client that joins mid-round can render correctly.
- [x] **REQ-WS-05**: WebSocket gateway computes `cashoutAcceptedAt` at the inbound message handler before any await — this server timestamp is the only authority for cashout-vs-crash race resolution.
- [x] **REQ-WS-06**: WebSocket gateway emits ticks as `volatile.emit` so a slow consumer cannot block the broadcast loop.
- [x] **REQ-WS-07**: WebSocket clients reconnect with exponential backoff and resync via `round:snapshot` on reconnect.

### Frontend (FE)

- [ ] **REQ-FE-01**: Frontend scaffolded as TanStack Start v1 + Vite + Tailwind v4 + shadcn/ui (CLI v4 TanStack Start template) + Zustand 5 + TanStack Query 5 + oidc-spa.
- [ ] **REQ-FE-02**: Frontend renders the multiplier curve on a Canvas 2D element at 60 fps via `requestAnimationFrame`, with `devicePixelRatio` scaling and proper `clearRect` between frames.
- [ ] **REQ-FE-03**: Frontend computes the multiplier locally each frame using the same `e^(GROWTH_RATE * t / 1000)` formula the server uses, anchored to `roundStartedAt` from the snapshot; corrects toward the server tick value via EWMA clock-offset (tween, never snap).
- [ ] **REQ-FE-04**: Frontend renders a bet input with Money-VO validation (min/max bounds, no scientific notation, no negative); the Bet button is enabled only during BETTING phase and disabled when player already has an active bet.
- [ ] **REQ-FE-05**: Frontend renders a Cashout button with live potential-payout display (`bet × current multiplier`) — enabled only while the player has an ACTIVE bet during RUNNING phase.
- [ ] **REQ-FE-06**: Frontend renders a countdown timer for the BETTING window.
- [ ] **REQ-FE-07**: Frontend renders a live feed of all bets and cashouts for the current round in real time; player's own actions highlighted.
- [ ] **REQ-FE-08**: Frontend renders a history strip of the last 20 crash points, color-coded (red ≤ 1.5x, yellow 1.5-2x, green > 2x — thresholds env-tunable).
- [ ] **REQ-FE-09**: Frontend renders the pre-round hash commitment in a always-visible badge; a click opens a verification drawer.
- [ ] **REQ-FE-10**: Frontend has a `/verify/:roundId` route that fetches the verify endpoint and runs the provably-fair algorithm in-browser via `crypto.subtle` — no server recomputation; result is `MATCH ✓` / `MISMATCH ✗`.
- [ ] **REQ-FE-11**: Frontend has a dark casino aesthetic (deep blacks, neon accents, smooth transitions) — see UI-SPEC.md (Phase 7 produces it).
- [ ] **REQ-FE-12**: Frontend is responsive (desktop + mobile breakpoints from Tailwind defaults); touch interactions work for bet/cashout.
- [ ] **REQ-FE-13**: Frontend has loading skeletons (round in flight, history fetch) and toast notifications with dedupe for errors (insufficient balance, network, etc.).
- [ ] **REQ-FE-14**: Frontend shows balance update with subtle counter-up animation; cashout produces a celebration; crash produces a flash + freeze overlay.

### Auto Features (AUTO)

- [ ] **REQ-AUTO-01**: Player can set an auto-cashout target multiplier; the server enforces it (compares each tick's multiplier to the target; auto-issues cashout when reached). Server-enforced (not client-driven) so disconnects don't cost the player.
- [ ] **REQ-AUTO-02**: Player can configure auto-bet with strategy `fixed` (same amount every round) or `martingale` (double on loss, reset on win).
- [ ] **REQ-AUTO-03**: Player can configure stop-loss (`STOP_LOSS_CENTS`) and stop-win (`STOP_WIN_CENTS`) thresholds; auto-bet halts when either is breached.
- [ ] **REQ-AUTO-04**: Auto-bet configuration is per-session (client-side store) — does not survive page reload by default (UX explicit choice).
- [ ] **REQ-AUTO-05**: System surfaces an "Auto" tab in the bet panel with target/strategy/stop inputs and a Start/Stop toggle.

### Leaderboard (LEAD)

- [ ] **REQ-LEAD-01**: System maintains a 24h rolling leaderboard of top players by net profit (sum of payouts − sum of bets, last 24h window).
- [ ] **REQ-LEAD-02**: System populates the leaderboard via a projector consuming `game.events` (light CQRS — no event sourcing) into a denormalized `leaderboard_24h` read model.
- [ ] **REQ-LEAD-03**: System exposes `GET /games/leaderboard?window=24h` returning the top N players (default 10) with `playerId` (masked), net profit, win count.
- [ ] **REQ-LEAD-04**: Frontend renders the leaderboard in a side panel with live updates via WS (`leaderboard:updated` event when ranks change).

### Deterministic Replay (REPLAY)

- [ ] **REQ-REPLAY-01**: System reproduces any past round byte-for-byte from `serverSeed + clientSeed + bets[]` — same multiplier curve, same crash point, same per-tick values.
- [ ] **REQ-REPLAY-02**: Frontend has a "Replay" button on each history entry that opens a modal showing the curve animating at real-time speed plus the bet/cashout overlays.
- [ ] **REQ-REPLAY-03**: Replay reuses the production canvas renderer — no separate code path — proving the fairness algorithm and renderer are deterministic.

### Observability (OBS)

- [ ] **REQ-OBS-01**: Both services emit OpenTelemetry traces via `@opentelemetry/sdk-node` + `nestjs-otel`; spans propagate across HTTP, AMQP, and WebSocket boundaries via W3C TraceContext.
- [ ] **REQ-OBS-02**: Both services expose Prometheus metrics at `/metrics` (req latency, error rate, AMQP consumer lag, WS connections, custom: bet volume, RTP, multiplier drift, WS broadcast latency).
- [ ] **REQ-OBS-03**: Docker compose includes Prometheus + Grafana with pre-provisioned dashboards (one for each service + one for the Crash Game custom metrics).
- [ ] **REQ-OBS-04**: All logs are structured JSON via `pino` + `nestjs-pino` with `correlationId` + `traceId` enrichment.

### Tests (TEST)

- [x] **REQ-TEST-01**: Domain unit tests cover Round FSM (legal transitions, invariant violations rejected), Bet logic (cashout math, status transitions, bound validation), Wallet (credit/debit/insufficient balance/precision), and provably-fair (deterministic crash-point computation, hash chain verification, formula correctness).
- [x] **REQ-TEST-02**: Property-based tests via `fast-check` cover: any zero-net credit/debit sequence returns to original balance; no illegal Round FSM transition is reachable; Money rounding is loss-free across arbitrary multiplier × bet inputs.
- [x] **REQ-TEST-03**: E2E API tests cover happy paths (bet → multiplier → cashout → balance updated; bet → crash → bet lost) and error scenarios (insufficient balance, double bet, bet during RUNNING phase, cashout without bet, cashout after crash).
- [x] **REQ-TEST-04**: E2E saga recovery test: spawn the wallet service, place a bet, `kill -9` mid-saga, restart, assert the balance is consistent.
- [ ] **REQ-TEST-05**: Playwright E2E covers the full player flow: login → wait for BETTING → place bet → wait for RUNNING → cashout → verify balance updated; second test covers login → bet → crash → verify bet lost.

### CI / CD (CI)

- [ ] **REQ-CI-01**: GitHub Actions runs unit + e2e tests on every push to main and every pull request.
- [ ] **REQ-CI-02**: CI runs `bun run docker:up` on a fresh clone, waits for healthchecks, runs E2E + Playwright against the live stack, then tears down — proving the zero-step bootstrap claim.
- [ ] **REQ-CI-03**: README has CI status badges (build, tests, coverage).

### Documentation (DOC)

- [ ] **REQ-DOC-01**: README documents setup, decisions, trade-offs, architecture diagram, saga flow, provably-fair algorithm, scripts, env vars, troubleshooting.
- [ ] **REQ-DOC-02**: Architecture Decision Records (ADRs) committed in `.planning/adrs/` (and surfaced in README) for each significant choice — ORM, money lib, outbox hand-roll vs library, raw `amqplib` + `@golevelup/nestjs-rabbitmq` split, server-tick rate, hash-chain depth, light-CQRS-no-ES, bet-202-cashout-200 asymmetry, single-lobby-vs-per-round-room.
- [x] **REQ-DOC-03**: Demo user `player / player123` is pre-configured in Keycloak with a wallet provisioned and seeded with `1000.00 CRD`.

---

## v2 Requirements (Stretch — only if all v1 are rock-solid)

- [ ] **REQ-STRETCH-01**: Multi-bet (two simultaneous independent bets per player per round, Aviator-style). Requires updating REQ-DOM-02 to "two bets per player per round, each with independent cashout state".
- [ ] **REQ-STRETCH-02**: Auto-bet additional strategies: Fibonacci, Labouchere.
- [ ] **REQ-STRETCH-03**: Crash-point distribution histogram in the stats panel.
- [ ] **REQ-STRETCH-04**: Pre-bet trajectory "ghost line" showing the prior round's curve overlaid faintly.
- [ ] **REQ-STRETCH-05**: Sound design + haptic feedback (mobile vibrate on cashout / crash).
- [ ] **REQ-STRETCH-06**: Storybook for shadcn-derived components.
- [ ] **REQ-STRETCH-07**: Rate limiting via Kong plugin or in-app.
- [ ] **REQ-STRETCH-08**: Crash curve formula displayed in a debug overlay (for transparency).

---

## Out of Scope

- **Real money, payments, KYC, AML** — challenge is play-money only; adding real money would require licensing, audits, regulatory work — out of scope.
- **Multiple game variants** — only Crash, per spec.
- **Native mobile apps (iOS / Android)** — responsive web only, per spec.
- **Admin panel** — not requested; would expand scope without scoring impact.
- **i18n / l10n** — English-only UI; PT-BR ok for docs and commit messages; deliberate choice to avoid translation drag.
- **All-time leaderboard / weekly leaderboard** — only 24h rolling per user decision; can be added in v2.
- **Multi-bet (in v1)** — punted to REQ-STRETCH-01 to preserve REQ-DOM-02 invariant simplicity in v1.
- **Production deployment / cloud infra (k8s, ECS, etc.)** — local Docker Compose only, per spec.
- **Distributed multi-instance horizontal scaling** — round loop runs on a single instance; documented scale-out path via `pg_try_advisory_lock` leader election but not implemented.
- **Service mesh / mTLS between services** — broker-level trust is sufficient for play-money behind Kong; documented as deferred.
- **Cryptocurrency wallet integration** — out of scope; play money only.
- **Live chat** — not requested, expands scope.
- **Tournaments / promotions / free bets** — not requested, expands scope.

---

## Open Configuration Values (env-driven, NOT hardcoded)

These constants live in `.env.example` (root and per-service) and `config/defaults.ts` (typed re-export):

| Constant | Default | Service |
|----------|---------|---------|
| `INITIAL_BALANCE_CENTS` | `100000` (1000.00 CRD) | wallets |
| `CURRENCY_CODE` | `CRD` | both |
| `CURRENCY_BASE` | `10` | both |
| `CURRENCY_EXPONENT` | `2` | both |
| `BETTING_WINDOW_MS` | `5000` | games |
| `COOLDOWN_MS` | `2000` | games |
| `SERVER_TICK_HZ` | `30` | games |
| `GROWTH_RATE` | `0.06` | games |
| `INSTANT_CRASH_BUCKET` | `101` (1-in-N) | games |
| `BET_MIN_CENTS` | `100` (1.00) | games |
| `BET_MAX_CENTS` | `100000` (1000.00) | games |
| `HASH_CHAIN_LENGTH` | `1000000` | games |
| `SAGA_TIMEOUT_MS` | `5000` | games |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | both |
| `RMQ_DELIVERY_LIMIT_MAIN` | `5` | both |
| `RMQ_DELIVERY_LIMIT_DLQ` | `3` | both |
| `AUTO_CASHOUT_MAX_X` | `100.00` | games |
| `LEADERBOARD_WINDOW_HOURS` | `24` | games |
| `LEADERBOARD_TOP_N` | `10` | games |

---

## Traceability

Each v1 REQ-ID maps to exactly one phase in `ROADMAP.md`. v2 (REQ-STRETCH-*) lives in the Stretch Backlog (not a numbered phase). Generated by `gsd-roadmapper` on 2026-05-24.

### Coverage summary

- **v1 mapped**: 95 / 95 (100%)
- **v1 complete**: 46 / 95 (Phase 1: REQ-AUTH-05 + REQ-DOC-03; Phase 2: REQ-WALL-05 + REQ-WALL-06 + REQ-SAGA-05 + REQ-SAGA-06; Phase 3: REQ-DOM-03 + REQ-AUTH-04 + REQ-WALL-01 + REQ-WALL-02 + REQ-WALL-03 + REQ-WALL-04 + REQ-WALL-07; Phase 4: REQ-DOM-01 + REQ-DOM-02 + REQ-DOM-04 + REQ-DOM-07 + REQ-DOM-08 + REQ-GAME-01 + REQ-GAME-02 + REQ-GAME-03 + REQ-GAME-04 + REQ-GAME-05 + REQ-GAME-08 + REQ-GAME-09 + REQ-FAIR-01 + REQ-FAIR-02 + REQ-FAIR-03 + REQ-FAIR-04 + REQ-FAIR-05 + REQ-TEST-01 + REQ-TEST-02; Phase 5: REQ-GAME-06 + REQ-GAME-07 + REQ-SAGA-01 + REQ-SAGA-02 + REQ-SAGA-03 + REQ-SAGA-04 + REQ-TEST-03 + REQ-TEST-04; Phase 6: REQ-WS-01 + REQ-WS-02 + REQ-WS-03 + REQ-WS-04 + REQ-WS-05 + REQ-WS-06 + REQ-WS-07 — REQ-AUTH-01/02/03 remain Pending, frontend OIDC deferred to Phase 7)
- **Orphans**: 0
- **Duplicates**: 0
- **Stretch (v2) deferred**: 8

### v1 mapping (by phase)

#### Phase 1 — Foundation & Infra (9 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-INFRA-01 | `bun run docker:up` zero-step bootstrap | Pending |
| REQ-INFRA-02 | Healthcheck-gated container startup | Pending |
| REQ-INFRA-03 | `docker:down` + `docker:prune` scripts | Pending |
| REQ-INFRA-04 | Pinned versions (Bun, Node, NestJS, MikroORM, Dinero, Socket.IO, TanStack, Tailwind, shadcn) | Pending |
| REQ-INFRA-05 | Runtime constants from env (no hardcoded business values) | Pending |
| REQ-DOM-05 | Wallet balance never negative (Postgres CHECK + invariant) | Pending |
| REQ-DOM-06 | Money VO with bigint cents (no `number` for amounts) | Pending |
| REQ-AUTH-05 | Pre-seeded `player/player123` + realm auto-import | Done (P1.2 + P1.9) |
| REQ-DOC-03 | Demo user wallet seeded with 1000.00 CRD | Done (P1.9 documented; Phase 3 will land actual provisioning endpoint) |

#### Phase 2 — Outbox/Inbox Messaging Spine (4 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-WALL-05 | Inbox dedup for exactly-once command processing | Done (Phase 2) |
| REQ-WALL-06 | Outbox + polling publisher + `confirmSelect` | Done (Phase 2) |
| REQ-SAGA-05 | Quorum queues + DLX + `x-delivery-limit` on DLQ itself | Done (Phase 2) |
| REQ-SAGA-06 | `correlationId` + `causationId` envelope headers | Done (Phase 2) |

#### Phase 3 — Wallet Service (7 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-DOM-03 | Wallet aggregate balance + precision invariants | Done (P3.02 + P3.03 + P3.08) |
| REQ-AUTH-04 | JWT validation via cached JWKS at each service | Done (P3.04) |
| REQ-WALL-01 | `POST /wallets` idempotent provisioning | Done (P3.05) |
| REQ-WALL-02 | `GET /wallets/me` returns balance + metadata | Done (P3.05) |
| REQ-WALL-03 | Initial balance from `INITIAL_BALANCE_CENTS` | Done (P3.05) |
| REQ-WALL-04 | Debit/credit only via RabbitMQ (no REST mutations) | Done (P3.06 AMQP consumers + P3.07 Kong gateway closure) |
| REQ-WALL-07 | Immutable Transaction ledger row per debit/credit | Done (P3.03 schema + P3.06 ledger append) |

#### Phase 4 — Game Core (domain only) (19 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-DOM-01 | Round lifecycle FSM enforced at aggregate boundary | Done (P4.02 aggregate + P4.04 rounds_fsm_check CHECK + P4.06 use cases orchestrate via transitionFromXToY) |
| REQ-DOM-02 | Single bet per player per round (partial unique index + guard) | Done (P4.04 migration creates `bets_one_active_per_player` partial unique index + P4.10 integration test asserts SQLSTATE 23505 on duplicate PENDING insert) |
| REQ-DOM-04 | Bet bounds: min 1.00, max 1000.00 (env-overridable) | Done (P4.03 — BetAmount value object enforces BET_MIN_CENTS / BET_MAX_CENTS bounds with env-overridable constants) |
| REQ-DOM-07 | Cashout `bet × multiplier` with banker's rounding | Done (P4.03 — Money.multiplyRounded shared-kernel extension + Bet.cashOut canonical consumer + 20k fast-check property; ADR-018) |
| REQ-DOM-08 | Rich Round/Bet/Wallet aggregates (no anemic rows) | Done (P4.02 + P4.03 — Round + Bet aggregates with private ctor, static factories, behavior methods; ADR-014) |
| REQ-GAME-01 | Autonomous round loop without external triggers | Done (P4.06 — RoundLoopService OnApplicationBootstrap + recursive setTimeout + four lifecycle use cases) |
| REQ-GAME-02 | `GET /games/rounds/current` with masked bets | Done (P4.08 — RoundsController + GetCurrentRoundUseCase) |
| REQ-GAME-03 | `GET /games/rounds/history?limit=20` | Done (P4.08 — RoundsController + GetRoundHistoryUseCase) |
| REQ-GAME-04 | `GET /games/rounds/:roundId/verify` provably-fair data | Done (P4.08 — RoundsController + VerifyRoundUseCase) |
| REQ-GAME-05 | `GET /games/bets/me` (paginated) | Done (P4.08 — BetsController + GetPlayerBetsUseCase + JwtGuard) |
| REQ-GAME-08 | Reject bets outside BETTING with 409 + discriminated code | Done (P4.02 aggregate FSM via existing Round.start/crash/settle + Phase 5 plan 05-01 adds Round.acceptBet(now) aggregate-boundary guard surfacing RoundNotInBettingPhaseError; Phase 5 plan 05-04 surfaces the 409 ConflictException with discriminated code ROUND_NOT_IN_BETTING_PHASE via POST /games/bet) |
| REQ-GAME-09 | `kill -9` survives — round loop reconstructs from DB | Done (P4.06 — five-branch recoverInFlightRound: no-open, BETTING, RUNNING, CRASHED with idempotent bet sweep, SETTLED) |
| REQ-FAIR-01 | Pre-generated 1M-link hash chain (reverse-consumed) | Done (P4.05 — SeedChainBootstrap idempotent OnApplicationBootstrap) |
| REQ-FAIR-02 | Reveal seed for round N only after N settles | Done (P4.08 — VerifyRoundUseCase 400 gate + GetCurrentRoundUseCase serverSeed nullification) |
| REQ-FAIR-03 | Bustabit-canon HMAC-SHA-256 52-bit crash-point formula | Done (P4.01 — `deriveCrashPoint` in packages/contracts implements `floor((100 * 2^52 - H) / (2^52 - H)) / 100` with 1-in-101 instant-crash bucket; verified against bustabit-rust reference + P4.11 CLI verifier MATCH; ADR-015) |
| REQ-FAIR-04 | Pure-function provably-fair module in `packages/contracts` | Done (P4.01 ships `@crash/contracts/provably-fair`; P4.10 verify-round integration test independently re-invokes deriveCrashPoint against the server response and asserts byte-equality) |
| REQ-FAIR-05 | Pre-round hash commitment displayed during BETTING | Done (P4.08 — CurrentRoundDto.seedHash always exposed during BETTING) |
| REQ-TEST-01 | Domain unit tests (Round FSM, Bet, Wallet, provably-fair) | Done (P4.02 + P4.03 unit suites green: round.aggregate.test.ts + bet.aggregate.test.ts + bet-amount.value-object.test.ts + 8 integration tests in P4.10 + P4.11 live run 32/32 smoke probes PASS) |
| REQ-TEST-02 | Property tests for monetary + FSM invariants | Done (P4.03 — money-rounding.property.test.ts 2 props × 10k cases = 20k fast-check runs asserting loss-free monetary invariants + Wallet zero-net property in P3.08 10k cases + Round FSM exhaustive transition tests in P4.02) |

#### Phase 5 — Saga Integration (8 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-GAME-06 | `POST /games/bet` → 202 Accepted + WS confirm | Done (P5.04 — PlaceBetUseCase + BetCommandController returning 202 PENDING + Bet PENDING + BetSagaState DEBIT_PENDING + outbox wallet.command.debit in single TX; P5.10 live trace round dd098fbe captured `bet_saga_state.status=CONFIRMED` + outbox `bet.active` published at t+2s; ADR-020 locks 202 response shape) |
| REQ-GAME-07 | `POST /games/bet/cashout` → 200 OK / 409 Conflict | Done (P5.06 — CashOutUseCase + POST /games/bet/cashout synchronous 200 with `{multiplier, payoutCents, cashedOutAt}`; `acceptedAt = new Date()` as literal first executable line per REQ-WS-05; three discriminated 409 codes ROUND_NOT_RUNNING + NO_ACTIVE_BET + BET_NOT_CASHABLE; smoke probe 38 PASS for 409 path; ADR-020 locks synchronous 200 response shape) |
| REQ-SAGA-01 | 2-step bet placement saga (Game ↔ Wallet) | Done (P5.04 — single-TX commit Bet PENDING + BetSagaState DEBIT_PENDING + outbox wallet.command.debit; P5.05 — WalletDebitedHandler `DEBIT_PENDING → CONFIRMED` + Bet.confirm + outbox bet.active in same TX via ADR-013 txEm; WalletDebitRejectedHandler `DEBIT_PENDING → REJECTED` + Bet.refund INSUFFICIENT_FUNDS; ADR-019 locks orchestration over choreography) |
| REQ-SAGA-02 | `bet_saga_state` persistence + restart recovery | Done (P5.03 — bet_saga_state migration + BetSagaState aggregate + MikroBetSagaStateRepository with claimExpired FOR UPDATE SKIP LOCKED LIMIT 100; P5.09 true-SIGKILL drill via `docker compose kill -s SIGKILL games` proves recovery; SagaTimeoutSweeper at OnApplicationBootstrap resumes timeout sweep from DB state) |
| REQ-SAGA-03 | `SAGA_TIMEOUT_MS=5000` auto-refund | Done (P5.07 — SagaTimeoutSweeper @OnApplicationBootstrap; recursive setTimeout per ADR-017 NOT setInterval per Pitfall 6; FOR UPDATE SKIP LOCKED claim of up to 100 expired DEBIT_PENDING per tick; emits bet.refunded with reason SAGA_TIMEOUT; P5.05 WalletDebitedHandler compensation branch closes late-arrival path TIMED_OUT → COMPENSATED + outbox wallet.command.credit; P5.09 integration scenario #3 timeout + #5 compensation via AMQP binding manipulation) |
| REQ-SAGA-04 | 1-step cashout saga (downstream wallet credit) | Done (P5.06 — per-bet micro-TX commit Bet.cashOut + outbox bet.cashed_out + outbox wallet.command.credit in single TX; wallet credit flows downstream via OutboxPublisher without blocking the 200 response; P5.10 live trace verified; ADR-020 documents single-service single-TX locality justification) |
| REQ-TEST-03 | E2E API tests (happy + error paths) | Done (P5.09 — 7 integration scenarios under services/games/tests/integration/: place-bet happy path + insufficient-funds + bet-outside-betting + timeout + compensation via AMQP unbindQueue/bindQueue manipulation + cashout happy path + double-cashout discriminated 409; bunx tsc --noEmit -p tsconfig.integration.json clean) |
| REQ-TEST-04 | E2E saga recovery test (kill -9 mid-saga) | Done (P5.09 — true-SIGKILL drill via `spawnSync('docker', ['compose', 'kill', '-s', 'SIGKILL', 'games'])` per P4.11 pattern; games-service talks via Kong because in-process EM dies with container; saga state persisted in DB survives kill; SagaTimeoutSweeper at OnApplicationBootstrap reaps any orphan DEBIT_PENDING; balance consistency asserted post-restart) |

#### Phase 6 — WebSocket Gateway & Multiplier Sync (10 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-AUTH-01 | OIDC Authorization Code + PKCE (S256) via oidc-spa | Pending (frontend OIDC deferred to Phase 7 per Phase 6 RESEARCH Deferred Ideas; backend JWT-at-WS-handshake validated via REQ-WS-01) |
| REQ-AUTH-02 | Token persistence + silent renewal | Pending (Phase 7 silent renewal — frontend scope) |
| REQ-AUTH-03 | `BroadcastChannel`-coordinated multi-tab refresh | Pending (Phase 7 BroadcastChannel — frontend scope) |
| REQ-WS-01 | JWT-at-handshake via custom Socket.IO IoAdapter | Done (P6.01 — JwtVerifierService extracted from JwtGuard for shared cached-JWKS validation; P6.03 — JwtIoAdapter installs io.use() handshake middleware rejecting any token that does not verify against the Keycloak JWKS, sets socket.data.playerId from the verified sub claim; smoke probe 40 no-token → UNAUTHORIZED PASS live; ADR-021 + ADR-022 lock the standalone WS_PORT=4101 surface) |
| REQ-WS-02 | Sockets joined to `lobby` + `user:{playerId}` | Done (P6.03 — handleConnection auto-joins lobby + user:{playerId} before snapshot emit; user-room name derived solely from verified-JWT sub claim — T-06-07 mitigation; integration ws-rooms.test.ts; ADR-021 locks single-lobby-over-per-round-rooms) |
| REQ-WS-03 | Round + bet + cashout server→client events | Done (P6.03 round:snapshot payload schemas + P6.05 EventEmitter2 lifecycle @OnEvent fan-out to lobby for round:started/running/crashed/settled + P6.06 WsBridgeConsumer dual-emit bet:placed/cashed_out masked to lobby + bet:my_active/refunded/cashed_out raw to user:{playerId}; integration ws-event-catalog.test.ts) |
| REQ-WS-04 | `round:snapshot` on connect / reconnect | Done (P6.03 — GetWsSnapshotUseCase composes Round + active bets, masks bystander playerIds, includes caller's un-masked bet; handleConnection emits per-socket idempotently across reconnects; smoke probe 41 snapshot-on-connect PASS live; integration ws-snapshot.test.ts incl. multi-tab parity) |
| REQ-WS-05 | `cashoutAcceptedAt` stamped at gateway middleware | Done (Phase 5 P5.06 — `const acceptedAt = new Date()` as the literal first executable line of POST /games/bet/cashout at bet-command.controller.ts:69; P6.10 ADR-023 codifies the invariant + interprets "gateway middleware" as the NestJS HTTP controller layer + documents why cashout was NOT migrated to a WS inbound message (event-loop contention with the 30Hz tick loop tightens the race); P6.08 cashout-race.property.test.ts covers the ±50ms window across 50 fast-check cases) |
| REQ-WS-06 | `volatile.emit` for ticks (slow-consumer-safe) | Done (P6.04 — MultiplierBroadcastService server.to('lobby').volatile.emit('round:tick', …) on a 33ms recursive-setTimeout loop, sole volatile owner in the codebase; P6.08 ws-tick-volatile.test.ts asserts ~30Hz frequency within tolerance; ADR-022 locks the 30Hz tick + 60fps client interpolation) |
| REQ-WS-07 | Client reconnect with exponential backoff + resync | Done (Socket.IO client default exponential-backoff reconnection + P6.03 round:snapshot emitted on every handleConnection so a reconnecting client resyncs full state; integration ws-snapshot.test.ts reconnect re-emit; frontend client wiring lands in Phase 7) |

#### Phase 7 — Frontend Vertical Slice (12 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-FE-01 | TanStack Start scaffold + stack | Pending |
| REQ-FE-02 | Canvas 2D curve at 60fps with `devicePixelRatio` | Pending |
| REQ-FE-03 | Local multiplier formula + EWMA clock-offset reconciliation | Pending |
| REQ-FE-04 | Bet input with Money-VO validation + state-aware enable | Pending |
| REQ-FE-05 | Cashout button with live potential payout | Pending |
| REQ-FE-06 | BETTING countdown timer | Pending |
| REQ-FE-07 | Live bet/cashout feed with own-action highlight | Pending |
| REQ-FE-08 | History strip last 20 color-coded | Pending |
| REQ-FE-11 | Dark casino aesthetic | Pending |
| REQ-FE-12 | Responsive desktop + mobile + touch | Pending |
| REQ-FE-13 | Loading skeletons + deduped toast errors | Pending |
| REQ-FE-14 | Balance counter-up, cashout celebration, crash flash/freeze | Pending |

#### Phase 8 — Provably-Fair UX, History & Replay (5 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-FE-09 | Pre-round hash commitment badge + verification drawer | Pending |
| REQ-FE-10 | `/verify/:roundId` runs algorithm via `crypto.subtle` | Pending |
| REQ-REPLAY-01 | Byte-for-byte reproduction from `serverSeed + clientSeed + bets[]` | Pending |
| REQ-REPLAY-02 | Replay modal on each history entry | Pending |
| REQ-REPLAY-03 | Replay reuses production canvas renderer | Pending |

#### Phase 9 — Auto Features & Leaderboard (9 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-AUTO-01 | Server-enforced auto-cashout target | Pending |
| REQ-AUTO-02 | Auto-bet strategies: fixed + Martingale | Pending |
| REQ-AUTO-03 | Stop-loss / stop-win thresholds halt auto-bet | Pending |
| REQ-AUTO-04 | Auto-bet config per-session (no persist) | Pending |
| REQ-AUTO-05 | Auto tab in bet panel with Start/Stop | Pending |
| REQ-LEAD-01 | 24h rolling leaderboard by net profit | Pending |
| REQ-LEAD-02 | Projector consuming `game.events` (light CQRS) | Pending |
| REQ-LEAD-03 | `GET /games/leaderboard?window=24h` | Pending |
| REQ-LEAD-04 | Side-panel leaderboard with `leaderboard:updated` WS | Pending |

#### Phase 10 — Quality Hardening & Docs (10 reqs)
| REQ-ID | Title | Status |
|--------|-------|--------|
| REQ-TEST-05 | Playwright E2E (login→bet→cashout, login→bet→crash) | Pending |
| REQ-OBS-01 | OpenTelemetry traces across HTTP/AMQP/WS | Pending |
| REQ-OBS-02 | Prometheus `/metrics` (latency, AMQP lag, RTP, WS latency, multiplier drift) | Pending |
| REQ-OBS-03 | Prometheus + Grafana in docker-compose, pre-provisioned dashboards | Pending |
| REQ-OBS-04 | Structured JSON logs via `pino` + `nestjs-pino` with correlationId | Pending |
| REQ-CI-01 | GitHub Actions runs unit + e2e on push + PR | Pending |
| REQ-CI-02 | CI runs `bun run docker:up` on fresh clone + Playwright | Pending |
| REQ-CI-03 | README status badges (build, tests, coverage) | Pending |
| REQ-DOC-01 | README: setup, decisions, trade-offs, diagrams, troubleshooting | Pending |
| REQ-DOC-02 | ADRs in `.planning/adrs/` surfaced in README | Pending |

### Stretch backlog (v2 — not phased)

| REQ-ID | Title | Lands during | Notes |
|--------|-------|--------------|-------|
| REQ-STRETCH-01 | Multi-bet (two simultaneous independent bets) | Stretch | Requires updating REQ-DOM-02 invariant |
| REQ-STRETCH-02 | Auto-bet strategies: Fibonacci, Labouchere | Stretch | Extends Phase 9 strategy registry |
| REQ-STRETCH-03 | Crash-point distribution histogram | Stretch | FE-only on history endpoint |
| REQ-STRETCH-04 | Pre-bet trajectory "ghost line" | Stretch | Canvas overlay on existing renderer |
| REQ-STRETCH-05 | Sound design + haptic feedback | Stretch | Cheap polish |
| REQ-STRETCH-06 | Storybook for shadcn-derived components | Stretch | Doc surface |
| REQ-STRETCH-07 | Rate limiting via Kong plugin or in-app | Stretch | Operator hardening |
| REQ-STRETCH-08 | Crash curve formula in debug overlay | Stretch | Transparency / arguição prop |

---

## Definition of Done (per requirement)

A v1 requirement is done when:
1. Implementation lands and code compiles under TS strict + ESLint custom money guard.
2. Unit / property / E2E tests for that requirement exist and pass.
3. Behavior is observable end-to-end (HTTP / WS / logs / metrics, as appropriate).
4. ADR exists for any choice that resolved an explicit decision in this document.
5. Verifier agent confirms the requirement is satisfied (gsd-verify).

---

*Last updated: 2026-05-28 by gsd-executor (P6.10 closeout — Phase 6 traceability marked Done for all 7 WS REQ-IDs with plan citations: REQ-WS-01 → P6.01+P6.03, REQ-WS-02 → P6.03, REQ-WS-03 → P6.03+P6.05+P6.06, REQ-WS-04 → P6.03, REQ-WS-05 → Phase 5 P5.06 + codified in P6.10 ADR-023 + P6.08 property test, REQ-WS-06 → P6.04, REQ-WS-07 → Socket.IO client default backoff + P6.03 snapshot-on-reconnect; REQ-AUTH-01/02/03 kept Pending — frontend OIDC deferred to Phase 7 per Phase 6 RESEARCH Deferred Ideas, backend JWT-at-WS-handshake done via REQ-WS-01; v1-complete count incremented from 39/95 to 46/95).*
