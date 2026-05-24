# Research Synthesis — Crash Game (Jungle Gaming Challenge)

**Synthesized:** 2026-05-24
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Scoring weights:** DDD/Architecture 25 · Code Quality 20 · Tests 20 · Frontend/UX 15 · Provably Fair 10 · Git 10

---

## 1. Executive Summary

- **Domain pattern is well-converged.** Every shipped crash game (Bustabit, Stake, Aviator, BC.Game) uses the same lifecycle (BETTING → RUNNING → CRASHED), same client-side interpolation with server-authoritative reconciliation, and a Bustabit-style HMAC-SHA-256 pre-generated hash chain. Deviating reads as inexperience; following the canon and executing it cleanly is the win.
- **Stack is locked with high confidence.** All open ORM/money/WS/auth decisions were resolved: MikroORM 7 (DDD-native Unit-of-Work + Identity Map), Dinero.js v2 stable (March 2026 GA), Socket.IO 4.8 via NestJS adapter, Bustabit-style provably-fair hand-rolled with Bun `crypto`, oidc-spa for Keycloak in TanStack Start.
- **Architecture is two NestJS services + RabbitMQ + per-service Postgres.** Game orchestrates a 2-step saga (place bet, cashout); Wallet is passive and command-driven. Outbox/Inbox is hand-rolled (~200 lines) in `packages/shared-kernel` — third-party libs are abandonware risk and hide the very pattern recruiters score.
- **Five critical failure modes dominate the risk surface:** float arithmetic in money, cashout race conditions around the crash boundary, leaked/lazy hash-chain seeds, missing transactional outbox (dual-write loss), and anemic domain models. Any one of these is either an explicit disqualifier or guts the 25%-weighted architecture score.
- **Differentiator vector is depth, not breadth.** Every other AI-assisted submission will ship the same feature list. What separates this submission is: ADRs with rejected alternatives, property tests on monetary and FSM invariants, deterministic replay byte-for-byte, kill-9 recovery demo, single-source provably-fair algorithm in `packages/contracts` consumed identically by FE and BE.
- **`bun run docker:up` zero-step bootstrap is a hard gate.** Healthchecks with `service_healthy` / `service_completed_successfully`, realm import + migrations as one-shot containers, declarative Kong config. CI must run this on every push.
- **Phase ordering is non-negotiable in the first half.** Outbox/Inbox infra MUST land before any saga code (otherwise dual-write bugs from day one). Round loop unblocks WS. Saga must work end-to-end BEFORE the FE bet panel ships, or FE wastes time on mocks.

---

## 2. Locked Stack

| Layer | Tech | Version | One-liner rationale |
|-------|------|---------|---------------------|
| Runtime | Bun | 1.3.11+ (pin in `.bun-version`) | Required by spec; native decorator transform unblocks NestJS unmodified |
| Backend framework | NestJS | 11.1.21 | Required by spec; DI + WS + microservices + DDD ergonomics |
| Language | TypeScript | 5.6+ strict | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Database | PostgreSQL | 18 | Provided; `NUMERIC` or `BIGINT` cents only — never `FLOAT` |
| Broker | RabbitMQ | 4.2 (management) | Provided; quorum queues + publisher confirms + DLX with `x-delivery-limit` on DLQ itself |
| IdP | Keycloak | 26.5 | Provided; JWKS-verified JWTs in each NestJS service (NOT at Kong) |
| Gateway | Kong | 3.9 DB-less | Provided; routes-only, declarative config, no JWT plugin |
| ORM | MikroORM | 7.1+ | UoW + Identity Map + Data Mapper = DDD-native; `em.transactional(SERIALIZABLE)` one-liner |
| Money | Dinero.js | 2.0 (stable) | GA March 2026 after 5y alpha; integer-only arithmetic; wrapped in project-local `Money` VO |
| WebSocket | Socket.IO | 4.8.x via `@nestjs/platform-socket.io` | Rooms, ack, reconnection free; volatile broadcast for ticks |
| Provably fair | hand-rolled (Bun `crypto`) | n/a | ~80 LOC; Bustabit 52-bit HMAC; visible in repo for arguição |
| Validation | zod | 3.23 + `nestjs-zod` 4 | Edge-only; domain VOs throw their own errors |
| AMQP client | `@golevelup/nestjs-rabbitmq` 5 + `amqplib` 0.10 | own channel/confirm lifecycle; Nest microservices transport rejected for outbox |
| Outbox/Inbox | hand-rolled in `packages/shared-kernel` | n/a | Polling + `FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY` wake-up |
| Frontend | TanStack Start | 1.x stable | Company preference signal; GA March 2026 |
| Styling | Tailwind CSS | 4.1+ | `@theme` directive, CSS-first config |
| UI primitives | shadcn/ui | CLI v4 | TanStack Start template native since March 2026 |
| Client state | Zustand | 5.x | Per-slice subscriptions to scope multiplier rAF re-renders |
| Server state | TanStack Query | 5.x | Native TanStack Start integration |
| OIDC client | oidc-spa | latest | TanStack Start adapter; PKCE/refresh/silent-renew |
| Tests | `bun:test` + `fast-check` 3 + Playwright 1.49 | n/a | Property tests on Money + Round FSM; Playwright for player-flow E2E |
| Logs | `pino` + `nestjs-pino` | 9 / 4 | Structured JSON with correlationId / traceId |
| Observability | OpenTelemetry + Prometheus + Grafana | OTel 0.55 / Prom v3 / Grafana 11 | `nestjs-otel` bridge; custom crash metrics (RTP, WS latency, multiplier drift) |

---

## 3. Top-10 Differentiator Moves

Ranked by recruiter signal-strength (intersection of FEATURES Top-10 and PITFALLS Top-10, deduped).

1. **Money as `bigint`-backed VO from line one** — wrapped Dinero v2; ADR records the alternatives rejected (decimal.js, currency.js, raw bigint+scale). Property test: any zero-net sequence of credits/debits returns to original balance.
2. **Cashout race solved with server-authoritative timestamps + async mutex on the Round aggregate** — server computes `cashoutAcceptedAt` at gateway middleware, before any await; property test hammers cashout ±50ms around the crash boundary.
3. **Pre-generated hash chain + zero-server-call client verifier** — algorithm lives in `packages/contracts` (or `packages/provably-fair`), imported identically by FE and BE. Recruiter can recompute on a third-party SHA-256 page and the math reproduces.
4. **Outbox + Inbox + Quorum queues + Publisher confirms + DLX-with-delivery-limit-on-the-DLQ-itself** — `kill -9` the wallet service mid-saga during demo; balance still consistent on restart.
5. **One-aggregate-per-transaction enforced by saga** — Bet is its own aggregate (not nested in Round) so per-cashout TX touches one Bet row + one outbox row, not the whole Round. `bet_saga_state` row persists FSM and recovers after restart.
6. **Deterministic replay (REQ-BONUS-04)** — any past round reproduced byte-for-byte from `serverSeed + clientSeed + bets[]`. Reuses the canvas renderer; proves the fairness algorithm is the only source of truth.
7. **Multi-tab coordination via `BroadcastChannel` for token refresh** — open three tabs, force token expiry, watch them all refresh once. DB partial-unique-index (`UNIQUE (player_id, round_id) WHERE status IN ('PENDING','ACTIVE')`) prevents double-bet across tabs.
8. **`bun run docker:up` works on a fresh clone with zero manual steps** — healthchecks on every service, realm import + migrations as one-shot containers with `service_completed_successfully`, declarative Kong config. CI job recreates from scratch on every push.
9. **Property-based tests on monetary invariants + Round FSM legality** — `fast-check` generators for `Money`, `Multiplier`, and round-state sequences; assertions that no illegal transitions occur and rounding is loss-free.
10. **ADRs with rejected alternatives** — one per key decision (ORM, money lib, outbox hand-roll vs library, raw amqplib vs Nest transport, server-tick rate, hash-chain depth, light-CQRS vs full ES). Single clearest signal of senior reasoning.

---

## 4. Critical-Path Pitfalls (5)

| # | Pitfall | Phase to mitigate | Prevention summary |
|---|---------|-------------------|--------------------|
| C1 | Float arithmetic anywhere in money path | Foundation (Wallet domain) | `Money` VO with `bigint` cents; Postgres `NUMERIC(20,2)` or `BIGINT`; `pg` numeric→string→VO; ESLint ban on `number` for amount-like symbols |
| C2 | Cashout race condition (client wins after crash) | Game core + WS + Saga | Server-authoritative clock; no client-supplied multiplier/timestamp; async mutex on Round aggregate; `setTimeout(crashAt - now)` not per-tick check; optimistic locking on Bet |
| C3 | Provably-fair seed leaked or chain forged at runtime | Game core (provably-fair module) | Pre-generate full chain (1M+ rounds) at first boot with `crypto.randomBytes`; reveal seed for round N only AFTER N settles; Bustabit 52-bit formula (no modulo bias); client-side verifier |
| C4 | No transactional outbox — wallet events lost on crash | Foundation (outbox/inbox infra) before any saga code | Same-TX write of domain row + outbox row; `confirmSelect` + `waitForConfirms`; inbox `INSERT...ON CONFLICT DO NOTHING` in same TX as side-effect; quorum queues + DLX with `x-delivery-limit` on DLQ itself |
| C5 | Anemic domain model (entities as ORM rows, logic in services) | Foundation (DDD skeletons) before any saga code | Zero infra imports in domain layer; aggregates expose behaviour methods (`round.acceptBet`, `bet.cashOut`); VOs throw on invalid construction; one aggregate per TX — saga for cross-aggregate consistency |

---

## 5. Architectural Spine

Two NestJS services (`games-service`, `wallets-service`) each own a private Postgres DB with `outbox` and `inbox` tables alongside their domain tables. Game orchestrates a 2-step saga: `POST /games/bet` writes Bet(PENDING) + outbox row in one TX, returns 202 Accepted, polling publisher emits `wallet.debit` (direct exchange) with `confirmSelect`; Wallet consumer inserts inbox row + debits balance + writes its own outbox `wallet.debited` (or `wallet.debit.rejected`) all in one TX; Game inbox handler transitions Bet→ACTIVE (or REFUNDED) and pushes `bet:active` over WS to `user:{playerId}`. Cashout is synchronous-200 from Game (it owns the multiplier × bet computation) with the wallet credit as fire-and-forget downstream bookkeeping. An in-process `RoundLoopService` (recursive `setTimeout` at ~30 Hz, with `pg_try_advisory_lock` for future leader election) drives BETTING → RUNNING → CRASHED with all state changes persisted; `setTimeout(crashAt - now)` schedules the actual crash transition for race-free settlement. The WebSocket gateway (`games-service`, `/ws`, Kong proxies WS upgrade) authenticates JWT at handshake via cached JWKS, joins each socket to a single global `lobby` room plus `user:{playerId}`, broadcasts `tick` events as `volatile` 30 Hz heartbeats (~30 bytes) and `round:current` snapshots compressed on connect. Clients render at 60 fps via `requestAnimationFrame`, anchoring to `roundStartedAt` and computing the multiplier locally from the same `e^(growthRate·t/1000)` formula the server uses; each tick refines an EWMA clock offset, and divergence > 0.02 tweens (never snaps) toward the server value. Provably-fair lives in `packages/contracts` as pure functions imported by both FE and BE: Bustabit-style pre-generated chain of 1M+ SHA-256-linked seeds consumed in reverse, per-round `HMAC-SHA-256(serverSeed, clientSeed)` taking the first 13 hex (52 bits) for the crash-point formula with a 1-in-101 instant-crash bucket for house edge; the `/games/rounds/:id/verify` endpoint exposes the data, but actual verification runs in the browser via `crypto.subtle`.

---

## 6. Phase Roadmap Hints (reconciled)

All four research files converge on the following ordering. The roadmapper should produce 8-10 phases mapping to these clusters; cross-cutting concerns (ADRs, observability instrumentation hooks, commit hygiene) ride along inside every phase.

| # | Phase cluster | Delivers | Blocks |
|---|---------------|----------|--------|
| 1 | **Foundation & Infra** | docker-compose with healthchecks + realm import + migrations as one-shot; Kong declarative; `packages/shared-kernel` (Money VO, errors); `packages/contracts` (zod schemas, event envelopes); ESLint money guard; ADR templates | Everything |
| 2 | **Outbox/Inbox shared package** | Hand-rolled outbox table + polling publisher + LISTEN/NOTIFY wake; inbox table + idempotent consumer wrapper; quorum queues + DLX + delivery-limit on DLQ itself; `confirmSelect` publisher | All saga work |
| 3 | **Wallet service** | Wallet + Transaction aggregates; `POST /wallets`, `GET /wallets/me` REST; AMQP `wallet.commands` consumers (debit/credit); inbox dedupe; property tests on Money invariants | Bet saga |
| 4 | **Game core (domain only, no WS)** | Round + Bet aggregates with FSM; provably-fair module (chain pre-gen, crash-point derivation, verify) shared via `packages/contracts`; autonomous `RoundLoopService`; unit + property tests on Round FSM legality | Saga, WS |
| 5 | **Saga integration** | End-to-end bet placement (Game→Wallet→Game) and cashout sagas; `bet_saga_state` persistence + restart recovery; compensation paths (insufficient funds, timeout, late ACK); E2E test with real RMQ via testcontainers + `kill -9` recovery test | WS bet flows, FE |
| 6 | **WebSocket gateway + multiplier sync** | JWT-at-handshake adapter; `lobby` + `user:{id}` rooms; `tick` volatile broadcast at 30 Hz; `round:current` snapshot on connect; server-authoritative cashout timestamping at gateway middleware; reconnection backoff | FE game page |
| 7 | **Frontend vertical slice** | TanStack Start scaffold + oidc-spa Keycloak; game page with Canvas 2D curve (rAF, devicePixelRatio, clearRect); bet panel with Money-VO validation; potential-payout live; countdown; dark casino theme; toasts with dedupe | All UX-scoring polish |
| 8 | **Provably-fair UX + history + replay** | Pre-round commitment badge; post-round reveal panel with client-side `crypto.subtle` verification; `/verify` route; history strip color-coded; deterministic replay (REQ-BONUS-04) reusing canvas renderer | Leaderboard, stats |
| 9 | **Auto features + leaderboard + polish** | Auto-cashout (server-enforced), auto-bet (fixed + Martingale), stop-loss/stop-win; leaderboard projector consuming `game.events` (light CQRS); hot-streak stats panel (free from history); sound + haptics; crash overlay; cashout celebration | Quality hardening |
| 10 | **Quality hardening + docs** | Playwright E2E (login→bet→cashout, login→bet→crash); GitHub Actions CI with status badges; OpenTelemetry instrumentation + Prometheus exporter + Grafana dashboard JSON (RTP, WS latency, multiplier drift); ADR catalogue audit; README with architecture diagram, saga flow, provably-fair algorithm, trade-offs | Submission |

**Stretch (only if 1-10 are rock-solid):** multi-bet (REQ-DOM-02 update required), Fibonacci/Labouchere strategies, crash-point distribution histogram, pre-bet trajectory ghost line.

**Parallelization windows:**
- Phase 4 (Game core domain) and Phase 3 (Wallet) can run in parallel once Phase 2 lands.
- Phase 8 (provably-fair UX) and Phase 9 (auto features) can partially overlap once Phase 7 ships the vertical slice.
- ADRs and READMEs are written inside each phase, audited in Phase 10.

---

## 7. Open Decisions Requiring User Input

These MUST come from env / config, not hardcoded (per global CLAUDE.md and PROJECT.md constraints).

| # | Decision | Why it cannot be hardcoded | Suggested default for discussion |
|---|----------|----------------------------|----------------------------------|
| OD1 | **Initial wallet balance** on first provisioning | Operator-facing tuning; affects play feel | 1000.00 play coins (`INITIAL_BALANCE_CENTS=100000`) |
| OD2 | **Currency descriptor** for play-money | Dinero v2 needs `{ code, base, exponent }` | `{ code: 'CRD', base: 10, exponent: 2 }` |
| OD3 | **Betting window duration** | Tunable per environment | 5s |
| OD4 | **Crashed-cooldown duration** | Pacing between rounds | 2s |
| OD5 | **Tick broadcast rate** (Hz) | Network / battery trade-off | 30 Hz (server) / 60 fps (client interpolated) |
| OD6 | **Multiplier growth rate** `k` in `e^(k·t/1000)` | Defines median round length | 0.06 (median ~5-7s) |
| OD7 | **House-edge bucket** for instant-crash 1.00x | Configurable RTP | 1 in 101 (Bustabit canon, ~99% RTP) |
| OD8 | **Bet min / max bounds** | Domain invariant constants | min 0.01, max 100.00 (subject to user input) |
| OD9 | **Hash chain length** at first boot | Storage vs lifetime trade-off | 1,000,000 rounds (≈months at 7s/round) |
| OD10 | **Saga timeout** for wallet response | Affects compensation trigger | 5s |
| OD11 | **Outbox poller interval** | Latency vs DB load trade-off | 1s baseline + LISTEN/NOTIFY wake |
| OD12 | **`x-delivery-limit`** on main queue and DLQ | Operator policy | 5 on main, 3 on DLQ |
| OD13 | **JWKS cache TTL** | Respect Keycloak `Cache-Control` | follow Keycloak header |
| OD14 | **Auto-cashout max target** | UX guardrail | 100.00x (subject to user input) |

**Action for roadmapper:** Phase 1 should produce a single `config/defaults.ts` (or `.env.example`) listing all of these, and each ADR that touches them references the same source.

---

## 8. Conflicts Found Between Research Files

| Topic | Conflict | Resolution |
|-------|----------|------------|
| **AMQP client choice** | STACK suggests `@golevelup/nestjs-rabbitmq` as primary with `amqplib` for outbox publisher; PITFALLS H5/M8 leans toward raw `amqplib` for full control over confirms; ARCHITECTURE uses `amqplib` directly | **Use both intentionally:** raw `amqplib` for the outbox publisher (own confirm lifecycle) AND for inbox consumer registration; `@golevelup/nestjs-rabbitmq` for ergonomic `@RabbitSubscribe` decorators in domain handlers that wrap the inbox-checked dispatcher. Document in ADR. |
| **Money internal representation** | STACK locks Dinero.js v2; PITFALLS C1 mentions `bigint` of cents as the canonical safe path and the differentiator-1 entry frames "bigint+scale over Dinero" as the ADR-worthy decision | **Use Dinero v2 wrapped in a project-local `Money` VO whose internals are Dinero snapshots (`{ amount: bigint, currency }`).** ADR records that the choice between raw bigint and Dinero was explicit; chose Dinero for isomorphic FE/BE + ISO currency table + immutability, kept bigint cents as the snapshot shape so `pg` NUMERIC→string→bigint round-trips losslessly. |
| **Crash-point formula constant** | FEATURES section 5.5 uses `floor((100 * 2^52) / (2^52 - H)) / 100`; STACK 2.4 and ARCHITECTURE 9.2 use `floor((100 * 2^52 - H) / (2^52 - H)) / 100`; PITFALLS C3 references the Bustabit canon | **Use Bustabit canon `floor((100 * 2^52 - H) / (2^52 - H)) / 100` with 1-in-101 instant-crash bucket.** Verify against Bustabit Rust reference impl during Phase 4. ADR captures the formula verbatim. The FEATURES variant is a near-equivalent simplification; standardize to one. |
| **Per-round room vs single lobby** | FEATURES 4.x implies per-round dynamics; ARCHITECTURE 7.2 explicitly collapses to single global `lobby` + `user:{id}` | **Single `lobby` + `user:{id}` wins** — only one round runs at a time, per-round rooms add join/leave churn every 7-15s with no scoping benefit. |
| **Bet response policy** | FEATURES implies synchronous bet acceptance; ARCHITECTURE 3.1 chooses 202 Accepted + WS confirmation | **202 + WS for bet placement, synchronous 200 for cashout.** Cashout is Game-context-local (payout = bet × multiplier, atomic with Bet state); bet placement requires the cross-service wallet round-trip. Document the asymmetry in ADR. |
| **Round loop tick rate** | ARCHITECTURE uses ~30 Hz; STACK 2.3 mentions 10-20 Hz server emit; PITFALLS H1 mentions 10 Hz heartbeats | **Server emits `tick` at ~30 Hz (every 33 ms), client renders at 60 fps via rAF interpolation.** 30 Hz keeps multiplier drift tight; payload is ~30 bytes so bandwidth is trivial; client interpolation handles the 60→30 gap. Reconcile with EWMA clock offset on each tick. |
| **CQRS depth** | Multiple files mention projections (leaderboard); ARCHITECTURE 10 explicitly recommends light CQRS without event sourcing | **Light CQRS, NO event sourcing.** Write model = mutable Postgres; read models = denormalized views populated by projector consuming `game.events`. ADR records ES considered and rejected for scope. |

---

## 9. Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (locked picks) | HIGH | All versions verified against official sources; Dinero v2 stable confirmed for March 2026 |
| Stack (open decisions resolved) | HIGH | MikroORM, Socket.IO, oidc-spa all backed by multiple authoritative sources |
| Features — table stakes | HIGH | All shipped crash games converge; missing any = "broken" |
| Features — differentiators | MEDIUM-HIGH | Recommendations are opinionated; multi-bet flagged as REQ-DOM-02 invariant conflict |
| Architecture — bounded contexts, sagas, outbox | HIGH | Direct application of microservices.io + Vernon canon |
| Architecture — round loop, WS sync | MEDIUM-HIGH | Patterns from Gambetta + NestJS lifecycle docs are canonical; specific tick-rate is a judgment call |
| Architecture — frontend layout | MEDIUM-HIGH | TanStack Start patterns verified; folder layout opinionated, not the only valid choice |
| Pitfalls — money / race / saga / RMQ | HIGH | Multiple sources, well-documented patterns |
| Pitfalls — Bun/NestJS regressions | MEDIUM | Version-specific; pin and smoke-test in Phase 1 |
| Pitfalls — TanStack Start hydration | MEDIUM | Limited real-world examples for canvas+WS workloads |
| **Crash-point formula final variant** | MEDIUM | Verify against Bustabit Rust reference during Phase 4; ADR locks chosen variant |

**Gaps to address during planning:**
- Configuration source-of-truth file format (`.env.example` vs `config/defaults.ts`) — pick in Phase 1.
- Multi-bet stretch decision — REQ-DOM-02 explicitly says single-bet-per-round; if multi-bet is pursued, requirement update is mandatory.
- Replay UX shape — playback speed controls, scrubbing, etc. — defer concrete UX to Phase 8.
- Leaderboard window granularity (24h vs rolling vs sessionized) — confirm with user before Phase 9.

---

## Sources (aggregated)

### Domain / Crash games
- Bustabit verifier and Rust reference impl
- crashgamesplay.com algorithm guide
- createIT "Implementing provably fair in crash games"
- Stake / Aviator / BC.Game product surveys

### Architecture
- microservices.io (Saga, Outbox, Idempotent Consumer)
- Gabriel Gambetta — Fast-Paced Multiplayer series (interpolation/reconciliation canon)
- Vernon "Implementing DDD" patterns
- InfoQ "Saga Orchestration Using the Outbox Pattern"

### NestJS / Bun / TanStack
- NestJS official docs (lifecycle, WS, microservices)
- TanStack Start v1 announcement + hydration/SSR guides
- oidc-spa TanStack Start adapter docs
- Bun blog + docs/test
- pas7.com.ua NestJS-on-Bun guide
- oven-sh/bun#27526 (NestJS regression tracking)

### Stack choices
- MikroORM v7 release blog + NestJS integration
- Dinero.js v2 release announcement (sarahdayan.com)
- Honeybadger currency JS comparison
- shadcn CLI v4 changelog (TanStack Start template)
- pragmaticivan/nestjs-otel + SigNoz + Last9 OTel-NestJS guides
- nestjs-zod npm

### Infrastructure
- RabbitMQ official docs (DLX, Quorum Queues, Publishers, Reliability, Prometheus+Grafana)
- PostgreSQL Numeric Types reference
- Socket.IO performance tuning + scaling docs

### Pitfalls / process
- axotion outbox+inbox NestJS writeup
- Iwanczyszyn outbox+RabbitMQ+Postgres in NestJS
- fast-check Bun tutorial
- joaovieira.ca DLQ poisonous-message handling
- Global CLAUDE.md commit/code hygiene rules

---

*Generated 2026-05-24 as input for roadmapper agent. Phase ordering and open decisions feed directly into `/gsd-roadmap` and `/gsd-requirements` flows.*
