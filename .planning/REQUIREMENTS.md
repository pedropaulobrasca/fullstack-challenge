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

- [ ] **REQ-DOM-01**: System enforces Round lifecycle `BETTING → RUNNING → CRASHED → SETTLED`; no illegal transitions are possible from any code path (enforced at aggregate boundary, not service layer).
- [ ] **REQ-DOM-02**: System enforces single bet per player per round (DB partial unique index + aggregate guard).
- [ ] **REQ-DOM-03**: System enforces Bet lifecycle `PENDING → ACTIVE → CASHED_OUT | LOST`; cashout is rejected if Bet is not in `ACTIVE` state.
- [ ] **REQ-DOM-04**: System enforces bet bounds: min `1.00`, max `1000.00` (spec values, env-overridable for non-prod).
- [ ] **REQ-DOM-05**: System guarantees wallet balance never goes negative (Postgres CHECK constraint + domain invariant).
- [ ] **REQ-DOM-06**: System represents all monetary amounts using a `Money` value object wrapping bigint-of-cents (no `number` for any amount-like field, anywhere — backend, frontend, wire format).
- [ ] **REQ-DOM-07**: System computes cashout as `bet × multiplier` with documented rounding policy (banker's rounding to 2 decimals) and asserts loss-free round-trips via property tests.
- [ ] **REQ-DOM-08**: System represents Round, Bet, and Wallet as rich aggregates with behavior methods (no anemic ORM rows).

### Authentication (AUTH)

- [ ] **REQ-AUTH-01**: System redirects unauthenticated users to Keycloak via OIDC Authorization Code + PKCE (S256) flow using `oidc-spa` adapter for TanStack Start.
- [ ] **REQ-AUTH-02**: System persists access + refresh tokens client-side and silently renews via the OIDC iframe before expiry.
- [ ] **REQ-AUTH-03**: System coordinates token refresh across multiple browser tabs via `BroadcastChannel` so all tabs renew once per token rotation.
- [ ] **REQ-AUTH-04**: Each backend service validates incoming JWTs via cached JWKS (issuer + audience + signature + expiry checks); JWKS cache respects Keycloak `Cache-Control` headers.
- [ ] **REQ-AUTH-05**: System uses Keycloak's pre-seeded `player / player123` for the demo user with the Keycloak realm/client imported automatically during `docker:up`.

### Wallet Service (WALL)

- [ ] **REQ-WALL-01**: Wallet service exposes `POST /wallets` to create a wallet for the authenticated player (idempotent — returns 409 or no-op on existing).
- [ ] **REQ-WALL-02**: Wallet service exposes `GET /wallets/me` returning the authenticated player's wallet balance and metadata.
- [ ] **REQ-WALL-03**: Wallet service provisions a new wallet with `INITIAL_BALANCE_CENTS=100000` (1000.00 CRD), env-configurable.
- [ ] **REQ-WALL-04**: Wallet service consumes debit/credit commands from RabbitMQ exclusively (no REST exposure for mutations).
- [ ] **REQ-WALL-05**: Wallet service uses an inbox table for exactly-once command processing (dedup on `messageId`, same TX as state mutation).
- [ ] **REQ-WALL-06**: Wallet service writes domain events to its outbox in the same TX as the state change; a polling publisher with `confirmSelect` + `waitForConfirms` ships them to RabbitMQ at-least-once.
- [ ] **REQ-WALL-07**: Wallet service stores immutable Transaction records (ledger model) — every debit/credit produces a Transaction row referencing the source command.

### Game Service — REST (GAME)

- [ ] **REQ-GAME-01**: System runs an autonomous round loop (`BETTING → RUNNING → CRASHED → SETTLED → cooldown → repeat`) inside `games-service` without external triggers, starting at `OnModuleInit`.
- [ ] **REQ-GAME-02**: System exposes `GET /games/rounds/current` returning the live round state with all bets (player-id-masked for other users).
- [ ] **REQ-GAME-03**: System exposes `GET /games/rounds/history?limit=20` returning paginated past rounds with crash points and aggregate stats.
- [ ] **REQ-GAME-04**: System exposes `GET /games/rounds/:roundId/verify` returning provably-fair data (server seed, client seed, nonce, hash, algorithm reference).
- [ ] **REQ-GAME-05**: System exposes `GET /games/bets/me` (paginated) returning the authenticated player's bet history.
- [ ] **REQ-GAME-06**: System exposes `POST /games/bet` accepting bet placement during the BETTING phase; returns `202 Accepted` with a pending bet handle and confirms via WebSocket.
- [ ] **REQ-GAME-07**: System exposes `POST /games/bet/cashout` accepting cashout during the RUNNING phase; returns `200 OK` with payout amount when accepted, `409 Conflict` when too late.
- [ ] **REQ-GAME-08**: System rejects bets outside the BETTING window with `409 Conflict` and a discriminated error code.
- [ ] **REQ-GAME-09**: System persists round and bet state survives `kill -9` of the service mid-round; on restart, the round loop reconstructs state from DB and resumes from the last persisted transition.

### Saga Coordination (SAGA)

- [ ] **REQ-SAGA-01**: System coordinates bet placement via a 2-step saga: Game writes `Bet(PENDING)` + outbox row → publishes `wallet.command.debit` → Wallet debits → emits `wallet.event.debited` or `wallet.event.debit_rejected` → Game Inbox transitions `Bet → ACTIVE` or `Bet → REFUNDED`.
- [ ] **REQ-SAGA-02**: System persists saga state in a `bet_saga_state` row so a service restart can recover and resume in-flight sagas.
- [ ] **REQ-SAGA-03**: System has a saga timeout (`SAGA_TIMEOUT_MS=5000`) after which a pending bet is auto-refunded if the Wallet has not responded.
- [ ] **REQ-SAGA-04**: System coordinates cashout via a 1-step saga: Game atomically transitions `Bet → CASHED_OUT` + writes payout outbox row → Wallet credits (downstream bookkeeping, never blocks the player's HTTP response).
- [ ] **REQ-SAGA-05**: System uses quorum queues + DLX with `x-delivery-limit` on both main and DLQ; poison messages land in a dead-letter table for inspection.
- [ ] **REQ-SAGA-06**: System carries `correlationId` + `causationId` headers through every message for end-to-end traceability.

### Provably Fair (FAIR)

- [ ] **REQ-FAIR-01**: System pre-generates a hash chain (`HASH_CHAIN_LENGTH=1000000`) at first boot using `crypto.randomBytes` for the final seed, then `SHA-256(prev)` N times; consumes seeds in reverse so each revealed seed hashes to the previous round's hash.
- [ ] **REQ-FAIR-02**: System reveals the seed for round N only after round N has settled (never before).
- [ ] **REQ-FAIR-03**: System derives the crash point per round via `HMAC-SHA-256(serverSeed, clientSeed:nonce)`, taking 52 bits via Bustabit canon formula `floor((100 * 2^52 - H) / (2^52 - H)) / 100`, with a 1-in-101 instant-crash (`1.00x`) bucket for ~99% RTP — both formula and constant env-overridable.
- [ ] **REQ-FAIR-04**: System exposes the provably-fair algorithm as a pure-function module in `packages/contracts` so the exact same code runs on the frontend verifier and the backend round loop.
- [ ] **REQ-FAIR-05**: System displays the pre-round hash commitment before every round (BETTING phase) so the player has the commitment before placing a bet.

### WebSocket Gateway (WS)

- [ ] **REQ-WS-01**: WebSocket gateway authenticates the JWT at handshake (custom Socket.IO IoAdapter validating via cached JWKS).
- [ ] **REQ-WS-02**: WebSocket gateway joins each connected socket to a single global `lobby` room plus a per-user `user:{playerId}` private room.
- [ ] **REQ-WS-03**: WebSocket gateway emits the following server→client events: `round:started` (BETTING phase begins, with seed hash + timing), `round:running` (BETTING ends, RUNNING begins), `round:tick` (`{ multiplier, t }` volatile at ~30 Hz), `round:crashed` (`{ crashPoint, seed, hash }`), `round:settled` (next round in N ms), `bet:placed` (other player), `bet:cashed_out` (other player), `bet:my_active` / `bet:my_cashed_out` / `bet:my_refunded` (private channel).
- [ ] **REQ-WS-04**: WebSocket gateway sends a `round:snapshot` on every connect / reconnect so a client that joins mid-round can render correctly.
- [ ] **REQ-WS-05**: WebSocket gateway computes `cashoutAcceptedAt` at the inbound message handler before any await — this server timestamp is the only authority for cashout-vs-crash race resolution.
- [ ] **REQ-WS-06**: WebSocket gateway emits ticks as `volatile.emit` so a slow consumer cannot block the broadcast loop.
- [ ] **REQ-WS-07**: WebSocket clients reconnect with exponential backoff and resync via `round:snapshot` on reconnect.

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

- [ ] **REQ-TEST-01**: Domain unit tests cover Round FSM (legal transitions, invariant violations rejected), Bet logic (cashout math, status transitions, bound validation), Wallet (credit/debit/insufficient balance/precision), and provably-fair (deterministic crash-point computation, hash chain verification, formula correctness).
- [ ] **REQ-TEST-02**: Property-based tests via `fast-check` cover: any zero-net credit/debit sequence returns to original balance; no illegal Round FSM transition is reachable; Money rounding is loss-free across arbitrary multiplier × bet inputs.
- [ ] **REQ-TEST-03**: E2E API tests cover happy paths (bet → multiplier → cashout → balance updated; bet → crash → bet lost) and error scenarios (insufficient balance, double bet, bet during RUNNING phase, cashout without bet, cashout after crash).
- [ ] **REQ-TEST-04**: E2E saga recovery test: spawn the wallet service, place a bet, `kill -9` mid-saga, restart, assert the balance is consistent.
- [ ] **REQ-TEST-05**: Playwright E2E covers the full player flow: login → wait for BETTING → place bet → wait for RUNNING → cashout → verify balance updated; second test covers login → bet → crash → verify bet lost.

### CI / CD (CI)

- [ ] **REQ-CI-01**: GitHub Actions runs unit + e2e tests on every push to main and every pull request.
- [ ] **REQ-CI-02**: CI runs `bun run docker:up` on a fresh clone, waits for healthchecks, runs E2E + Playwright against the live stack, then tears down — proving the zero-step bootstrap claim.
- [ ] **REQ-CI-03**: README has CI status badges (build, tests, coverage).

### Documentation (DOC)

- [ ] **REQ-DOC-01**: README documents setup, decisions, trade-offs, architecture diagram, saga flow, provably-fair algorithm, scripts, env vars, troubleshooting.
- [ ] **REQ-DOC-02**: Architecture Decision Records (ADRs) committed in `.planning/adrs/` (and surfaced in README) for each significant choice — ORM, money lib, outbox hand-roll vs library, raw `amqplib` + `@golevelup/nestjs-rabbitmq` split, server-tick rate, hash-chain depth, light-CQRS-no-ES, bet-202-cashout-200 asymmetry, single-lobby-vs-per-round-room.
- [ ] **REQ-DOC-03**: Demo user `player / player123` is pre-configured in Keycloak with a wallet provisioned and seeded with `1000.00 CRD`.

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

## Traceability (filled by roadmap)

Each REQ-ID maps to exactly one phase in `ROADMAP.md`. Updated by the roadmapper agent.

---

## Definition of Done (per requirement)

A v1 requirement is done when:
1. Implementation lands and code compiles under TS strict + ESLint custom money guard.
2. Unit / property / E2E tests for that requirement exist and pass.
3. Behavior is observable end-to-end (HTTP / WS / logs / metrics, as appropriate).
4. ADR exists for any choice that resolved an explicit decision in this document.
5. Verifier agent confirms the requirement is satisfied (gsd-verify).

---

*Last updated: 2026-05-24 after research synthesis + user input on multi-bet / leaderboard / replay / initial-balance.*
