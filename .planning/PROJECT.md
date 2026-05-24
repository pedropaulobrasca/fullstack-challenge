# Crash Game — Jungle Gaming Challenge

## What This Is

Multiplayer real-time Crash casino game built as a technical challenge submission for Jungle Gaming. Players bet during a betting window, watch a multiplier climb from 1.00x in real time, and must cash out before the round "crashes" at a deterministic-but-unpredictable point. Backend is two NestJS services (Game + Wallet) communicating via RabbitMQ; frontend is TanStack Start with WebSocket push for live multiplier and round state.

## Core Value

Demonstrate senior-level engineering through a Crash Game that is correct, fair, real-time, and deeply considered — not a generic AI-assisted submission. Every decision must be defensible during the recruiter's arguição.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **REQ-DOM-01**: Round aggregate enforces lifecycle invariants (BETTING → RUNNING → CRASHED) with no illegal transitions
- [ ] **REQ-DOM-02**: Bet aggregate enforces single-bet-per-round, min/max bounds, status transitions (PENDING → ACTIVE → CASHED_OUT | LOST)
- [ ] **REQ-DOM-03**: Wallet aggregate guarantees non-negative balance and exact monetary precision (no float arithmetic)
- [ ] **REQ-DOM-04**: Provably fair crash point derived from hash chain — each round's seed is verifiable against the previous round's hash
- [ ] **REQ-WALL-01**: Wallet service exposes `POST /wallets` and `GET /wallets/me` with Keycloak JWT auth
- [ ] **REQ-WALL-02**: Credit/debit operations consumed only from message broker, never via REST
- [ ] **REQ-WALL-03**: Outbox pattern guarantees at-least-once delivery of wallet events; inbox guarantees exactly-once processing (idempotency)
- [ ] **REQ-GAME-01**: Game service exposes REST: `GET /games/rounds/current`, `GET /games/rounds/history`, `GET /games/rounds/:id/verify`, `GET /games/bets/me`, `POST /games/bet`, `POST /games/bet/cashout`
- [ ] **REQ-GAME-02**: Game service runs an autonomous round loop (betting window → running → crash → settlement → repeat) without external triggers
- [ ] **REQ-GAME-03**: Saga coordinates bet placement: Game reserves bet → publishes BetPlaced → Wallet debits → emits BalanceDebited or InsufficientFunds → Game confirms or compensates
- [ ] **REQ-GAME-04**: Saga coordinates cashout: Game computes payout → publishes CashOutRequested → Wallet credits → emits BalanceCredited → Game confirms
- [ ] **REQ-WS-01**: WebSocket gateway pushes server-authoritative round state, multiplier ticks, bet feed, cashout feed, and round results to all connected clients
- [ ] **REQ-WS-02**: Multiplier synchronization uses interpolation with server reconciliation — clients render at 60fps without trusting client time
- [ ] **REQ-FE-01**: Login page redirects to Keycloak via OIDC Authorization Code + PKCE; tokens persisted and refreshed
- [ ] **REQ-FE-02**: Game page renders animated crash curve (Canvas), bet controls with validation, potential payout display, countdown timer
- [ ] **REQ-FE-03**: Live round feed shows all bets and cashouts in real time
- [ ] **REQ-FE-04**: History panel shows last ~20 crash points color-coded (red low, green high)
- [ ] **REQ-FE-05**: Pre-round seed hash displayed; verification UI lets users hash-check past rounds client-side
- [ ] **REQ-FE-06**: Dark casino aesthetic, fully responsive, animations, loading states, toast errors
- [ ] **REQ-BONUS-01**: Auto cashout — player sets target multiplier for automatic exit
- [ ] **REQ-BONUS-02**: Auto bet with strategies (fixed, Martingale) and configurable stop-loss / stop-win
- [ ] **REQ-BONUS-03**: Observability — OpenTelemetry traces, Prometheus metrics (RTP, bet volume, WS latency, multiplier drift), Grafana dashboards
- [ ] **REQ-BONUS-04**: Deterministic replay — any past round can be reproduced byte-for-byte from its seed
- [ ] **REQ-BONUS-05**: Leaderboard — top players by profit (24h, weekly) via real-time projection
- [ ] **REQ-BONUS-06**: Playwright E2E covers full player flow (login → bet → cashout, login → bet → crash)
- [ ] **REQ-BONUS-07**: GitHub Actions CI runs unit + e2e tests on push, with status badges in README
- [ ] **REQ-TEST-01**: Unit tests for domain layer (Round lifecycle, Bet logic, Wallet money math, provably fair determinism)
- [ ] **REQ-TEST-02**: Property-based tests (fast-check) for monetary invariants and state-machine transitions
- [ ] **REQ-TEST-03**: E2E API tests covering happy paths and error scenarios (insufficient balance, double bet, bet during round)
- [ ] **REQ-DOC-01**: README documents setup, architecture, decisions, trade-offs
- [ ] **REQ-DOC-02**: Architecture Decision Records (ADRs) committed for each significant choice (ORM, money lib, saga pattern, WS sync strategy, provably fair algorithm)
- [ ] **REQ-INFRA-01**: `bun run docker:up` brings entire stack online with zero manual steps — including Keycloak realm import, Kong routes, DB migrations, RabbitMQ exchanges/queues

### Out of Scope

- **Production deployment / CDN / cloud infra** — challenge runs locally via Docker Compose
- **Real money / payment integration** — wallets are play-money only per challenge spec
- **Mobile native apps** — responsive web only
- **Admin panel / KYC** — not requested, would expand scope without scoring impact
- **i18n** — English-only is acceptable; PT-BR comments OK but UI in EN keeps it neutral
- **Multiple game variants** — only Crash, per spec

## Context

- **Challenge source**: github.com/pedropaulobrasca/fullstack-challenge (forked from junglegaming/fullstack-challenge)
- **Scoring weights**: DDD/Architecture 25%, Code Quality 20%, Tests 20%, Frontend/UX 15%, Provably Fair 10%, Git History 10%
- **Disqualifiers**: float math for money, `docker:up` failures, no tests, AI-generated code without understanding (live arguição required)
- **Pre-provisioned infra**: PostgreSQL 18, RabbitMQ 4.2 (management UI), Keycloak 26.5 (realm `crash-game`, client `crash-game-client` PKCE S256, user `player/player123`), Kong 3.9 (DB-less declarative)
- **Pre-scaffolded backend**: NestJS 11 modules for `games` (port 4001) and `wallets` (port 4002), DDD folder structure, health endpoints only
- **Frontend**: empty `frontend/` directory — candidate scaffolds from scratch
- **Workspace**: Bun workspaces (`services/*`, `packages/*`, `frontend`)
- **Recruiter perspective**: differentiation is mandatory because every other submission will also use AI. Differentiator vector = depth of reasoning (ADRs), domain rigor (DDD purity, property tests), engineering hygiene (Outbox, observability, replay), and frontend polish.

## Constraints

- **Tech stack — Backend**: NestJS 11 + TypeScript strict + Bun runtime (required by spec)
- **Tech stack — Database**: PostgreSQL 18 (provided); ORM choice open (MikroORM | Prisma | TypeORM) — TBD via research
- **Tech stack — Messaging**: RabbitMQ provided; saga + outbox pattern required
- **Tech stack — IdP**: Keycloak provided; backend validates JWTs via JWKS
- **Tech stack — Frontend**: TanStack Start (preferred stack signal for the company)
- **Tech stack — Styling**: Tailwind CSS v4 + shadcn/ui
- **Tech stack — State**: TanStack Query (server) + Zustand (client)
- **Tech stack — Tests**: Bun test (unit/e2e), Playwright (browser E2E), fast-check (property)
- **Money precision**: no float arithmetic anywhere — decimal lib or bigint+scale (TBD via research)
- **Timeline**: official prazo 5 dias corridos; candidate has "no rush" meaning quality-first
- **Real-time**: WebSocket multiplier must remain in sync across multiple tabs (validated by spec)
- **Setup**: `bun run docker:up` must bring up the entire stack — no manual steps
- **No AI fingerprints**: per global CLAUDE.md rules — no AI-attribution in commits, no unnecessary comments, no emojis in code, no hardcoded values without explicit justification

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TanStack Start frontend | Company's preferred stack — strongest fit signal vs Next/Vite | — Pending |
| Full GSD workflow (discuss → plan → execute → verify → review per phase) | Generates ADRs naturally; produces defensible artifacts for arguição | — Pending |
| Include all listed bonus items (Outbox, observability, auto bet/cashout, replay, leaderboard, Playwright, CI) | User chose "sem pressa / qualidade absoluta"; differentiation requires depth | — Pending |
| Use Context7 / web for up-to-date library docs in every phase | Training data outdated; prevents stale-API bugs | — Pending |
| ORM choice deferred to research phase | Significant DDD impact (MikroORM identity map / unit-of-work vs Prisma anemic models) | — Pending |
| Money library deferred to research phase | Dinero.js v2 vs bigint+scale tradeoffs need current verification | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-24 after initialization*
