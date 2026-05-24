# Domain Pitfalls — Crash Game (NestJS + Bun + TanStack Start)

**Domain:** Multiplayer real-time crash casino game
**Stack:** NestJS 11, Bun, PostgreSQL 18, RabbitMQ 4.2, Keycloak 26.5, Kong, TanStack Start, Socket.IO/native WS
**Researched:** 2026-05-24
**Confidence:** HIGH on monetary/race/saga/RMQ (multiple sources). MEDIUM on Bun/NestJS regressions (recent issues, version-specific). MEDIUM on TanStack Start hydration (official docs but limited real-world examples for canvas+WS).

This document catalogues mistakes that will sink the Jungle Gaming challenge submission. Each pitfall is tied to a specific phase so the roadmapper can place mitigation tasks where they belong.

---

## CRITICAL — will fail the challenge if not prevented

These map to explicit disqualifiers in `PROJECT.md` (float math, broken `docker:up`, fake provably fair, race conditions exposing cheats) or to the highest scoring weight (DDD/Architecture 25%, Tests 20%).

### C1. Float arithmetic anywhere in money path
**Warning signs:**
- `balance: number`, `bet: number`, `payout: number` in domain or DTO types
- `bet * multiplier` expressed without explicit rounding policy
- Postgres column declared `REAL` / `DOUBLE PRECISION` / `FLOAT8`
- `JSON.parse(JSON.stringify(money))` round-trip in tests passes silently
- Unit test asserts `expect(0.1 + 0.2).toBe(0.3)` and you "fix" it with `toBeCloseTo`
- `pg` driver returning numbers (not strings) for NUMERIC columns

**Prevention:**
- Introduce a `Money` value object on day 1. Internal representation: `bigint` of minor units (cents). Never expose the raw bigint outside the VO.
- Postgres column: `NUMERIC(20, 2)` or `BIGINT` (cents). Pick one and document in ADR.
- `pg` returns NUMERIC as string — do NOT `Number(...)` or `parseFloat(...)`. Parse straight into `Money.fromString(...)`.
- Wire transport: serialize Money as `{ amount: "12345", currency: "BRL", scale: 2 }`, never as a JS number. `JSON.stringify(bigint)` throws — handle explicitly.
- Decide rounding policy once, in writing: payout = `floor(bet * multiplier)` (favours house, standard for crash). Document in ADR.
- Property test (`fast-check`): for any sequence of credits/debits whose net is zero, balance returns to original. Run 10k cases.
- ESLint rule banning `number` type on any symbol matching `/amount|balance|bet|payout|price|wager/i`.

**Phase:** Domain (first phase). This is foundational; retrofitting later means rewriting wallet + bet + saga.
**Cost if missed:** Instant disqualifier per `PROJECT.md`. Also kills the 10% Provably Fair score because verification will not reproduce.

### C2. Cashout race condition — client wins after server crashed
**Warning signs:**
- Cashout endpoint reads client-sent timestamp or client-sent multiplier
- Round state stored in a non-locked structure (plain Map) updated by multiple async handlers
- No single monotonic server clock for the round (`performance.now()` resets, `Date.now()` jumps on NTP sync)
- Cashout handler issues `SELECT round` then `UPDATE bet` without row lock or aggregate version check
- Test logs show occasional `payout` greater than expected at `crashPoint`

**Prevention:**
- Server is the only authority. The cashout REST call carries NO multiplier and NO timestamp — only `{ betId }`. Server computes "what is the multiplier RIGHT NOW given round start + elapsed?" using its own clock.
- Define the authoritative timestamp explicitly: `cashoutAcceptedAt = server-receive-of-cashout-request`, NOT processing time. Stamp it in the gateway middleware, before any async work.
- Round state machine is a single in-memory aggregate guarded by an async mutex (e.g. `async-mutex`). Cashout and crash-tick contend for the same lock; whichever wins, wins.
- Crash transition happens via a single `setTimeout(crashAt - now)` scheduled at round start, not per-tick comparison. If cashout request enters the queue at `crashAt - 1ms` and acquires lock before crash callback runs, it wins. After crash runs, cashout sees state = CRASHED and rejects.
- Optimistic locking on persisted Bet aggregate (`version` column) so even if memory and DB diverge after restart, double-cashout fails at commit.
- Property test (`fast-check`): generate random cashout times around crash point ± 50ms; assert payout is either valid-for-time-before-crash OR rejected, never both.

**Phase:** Domain (round/bet aggregates) + WS (gateway timestamp capture) + Saga (cashout flow).
**Cost if missed:** Cheat vector — recruiter will probe this in arguição. Direct hit on 25% Architecture and 10% Provably Fair scores. Documented in real crash game scaling literature as the #1 trust-killer.

### C3. Provably fair — seed leaked / hash-chain forged at runtime
**Warning signs:**
- Server seed for round N exists in the DB / logs / WS payload BEFORE round N has crashed
- Hash chain generated lazily one round at a time (so server can pick the next seed after seeing bets)
- Verification page that needs a server call to verify (defeats the point — must be reproducible by hash alone on client)
- `Math.random()` used anywhere in seed generation
- Crash point formula uses `parseInt(hash.slice(0,8), 16) % BIG_NUMBER` — modulo bias makes some values more likely
- Seed reveal endpoint returns the CURRENT round's seed instead of the previous one

**Prevention:**
- Pre-generate the entire hash chain at service boot (e.g. 1M rounds), seeded from `crypto.randomBytes(32)`. Store hashes in DB. Reveal seed for round N only AFTER round N has settled (publish in `RoundCrashed` event + history endpoint).
- The hash of round N is publicly visible BEFORE the round starts. After the round, reveal the seed and players verify `sha256(seed) === publishedHash`.
- Use the Bustabit 52-bit formula or the Stake 32-bit formula. Both are public, audited, and free of modulo bias when implemented as documented.
  - Bustabit: take first 13 hex chars of `HMAC-SHA256(serverSeed, clientSeed)`, parse as int, compute `floor((100 * 2^52 - int) / (2^52 - int)) / 100`, with a hardcoded 1-in-101 instant crash for house edge.
- Verification UI is pure client-side JS. Player pastes `serverSeed`, `clientSeed`, `nonce` → page hashes and shows crash point. Zero server calls. Document the algorithm verbatim in README so any third-party tool can reproduce.
- Determinism test: given fixed seed, crash point must be byte-identical across runs. Run in CI.

**Phase:** Domain (provably fair module) + FE (verification page). Address in same phase as Round aggregate.
**Cost if missed:** Direct hit on 10% Provably Fair score. If verification doesn't reproduce in arguição demo, the entire fairness story collapses and credibility with it.

### C4. No transactional outbox — wallet events lost on crash
**Warning signs:**
- Service logic: `await wallet.save(); await rabbitmq.publish(event);` (two separate operations)
- Code path where the DB commit succeeds but the broker publish throws and the exception is swallowed
- Replaying a round shows divergence between persisted wallet balance and event log
- No `outbox` table in either service's schema

**Prevention:**
- Outbox table: `(id, aggregate_id, event_type, payload, occurred_at, published_at NULL, attempts)`. Domain handler writes domain change + outbox row in the SAME transaction. Separate poller publishes to RabbitMQ, marks `published_at` only after broker confirm (`channel.confirmSelect` + `waitForConfirms`).
- Use `confirmSelect` on the publisher channel. Without it, "publish returned" means nothing — message may be lost in broker memory.
- Inbox table on consumers: `(message_id, processed_at, result)`. Before processing, `INSERT ... ON CONFLICT DO NOTHING`. If conflict, ack and skip. Wraps business work in same transaction as inbox row.
- Configure DLX (dead-letter exchange) and DLQ on every queue with `x-delivery-limit: 5` (quorum queues, available since RMQ 3.10+). CRITICAL: apply the same limit to the DLQ itself — otherwise a poisonous message in the DLQ that fails further routing loops forever, which has been documented to take down entire clusters.
- Quorum queues (not classic) for durability and at-least-once dead-lettering with publisher confirms.

**Phase:** Infra (RabbitMQ topology) + Saga. The outbox is non-negotiable per `REQ-WALL-03`.
**Cost if missed:** Wallet desync demonstrable in 3 lines (`kill -9` the wallet service mid-saga, check balance vs event log). Architecture score destroyed.

### C5. Anemic domain model — entities are ORM rows with services holding logic
**Warning signs:**
- `Round` class is just `@Entity` decorators and getters/setters
- `RoundService.crash(round)` mutates `round.status` directly instead of `round.crash()`
- Money validation lives in DTO validators, not in `Money` constructor
- Cross-aggregate transactions: bet placement updates Round, Bet, AND Wallet in one DB transaction
- Domain layer files import from `@nestjs/typeorm`, `@mikro-orm/core`, `prisma/client`

**Prevention:**
- Domain layer has ZERO infrastructure imports. Pure TS. Aggregates contain behaviour methods (`round.acceptBet(...)`, `round.crash()`, `bet.cashOut(...)`) that enforce invariants and emit domain events. Decorators (if any) belong on a separate persistence model that mappers convert to/from.
- One aggregate per transaction. The bet-placement flow is a saga: `Game.reserveBet()` (Round aggregate) → publish event → `Wallet.debit()` (Wallet aggregate) → publish event → `Game.confirmBet()`. Eventual consistency. NEVER a single DB transaction touching both aggregates.
- Value objects are real classes with private constructors and factory methods that throw on invalid input. `Money.of("-1")` must throw; `Multiplier.of(0.5)` must throw.
- ORM choice matters: MikroORM's Unit of Work + Identity Map + Data Mapper natively supports DDD (domain entities separate from schema). Prisma forces generated client types into your domain, which leaks infrastructure upward — usable but requires manual mapper layer.

**Phase:** Domain. Must be set in stone before saga work begins, otherwise refactoring cascades.
**Cost if missed:** 25% Architecture score. Recruiter explicitly looks for DDD purity; anemic models are the textbook anti-pattern.

---

## HIGH — major scoring impact, recoverable but expensive

### H1. WebSocket multiplier drift across tabs
**Warning signs:**
- Client computes multiplier independently using `setInterval`
- Two tabs of the same player show different multipliers at the same wall-clock moment
- After WS reconnect, multiplier "jumps"
- Tab in background pauses `setInterval`, then catches up via huge jump when refocused

**Prevention:**
- Server is the single source of truth for `roundStartedAt` and the multiplier formula. Server pushes `roundStartedAt` (epoch ms) at round start, then heartbeats current multiplier every 100ms (10 Hz tick rate).
- Client renders at 60fps via `requestAnimationFrame`, interpolating between heartbeats using the same formula the server uses, anchored to `roundStartedAt`. On every heartbeat, reconcile (snap or lerp to authoritative value if drift > threshold).
- On reconnect: server pushes a full `RoundState` snapshot including `roundStartedAt` and current phase. Client recomputes from that anchor; no jumps because formula is deterministic.
- Use `performance.now()` for elapsed-time math after anchoring, NOT `Date.now()` (which can jump on NTP correction).
- Tab visibility: when `document.hidden`, suspend the `requestAnimationFrame` loop (browsers throttle to 1Hz anyway). On `visibilitychange` back to visible, request a fresh snapshot before resuming render.

**Phase:** WS (gateway) + FE (game page render loop).
**Cost if missed:** `REQ-WS-02` failure. Multi-tab desync is the first thing a recruiter tests because the spec calls it out.

### H2. Saga state held only in memory
**Warning signs:**
- Saga coordinator stores in-flight `BetPlacementSaga { betId, status }` in a `Map`
- Service restart loses all pending sagas; players see "stuck" bets forever
- No persistent record of "Bet X is awaiting wallet debit confirmation"

**Prevention:**
- Saga state is a row in `bet_saga_state` table with explicit FSM (`PENDING_DEBIT`, `DEBIT_CONFIRMED`, `COMPENSATING`, `COMPLETED`, `FAILED`). Every transition is a DB write + outbox event.
- On service boot, scan for non-terminal saga rows older than N seconds and re-emit the next command. Combined with consumer idempotency (inbox), this is safe.
- Saga timeout policy documented: if `BalanceDebited` does not arrive within 5s, mark `TIMEOUT` and compensate by releasing the bet slot on the Game side.

**Phase:** Saga.
**Cost if missed:** Demo failure if service restarts during arguição. Loss of trust.

### H3. WebSocket authentication missing on handshake
**Warning signs:**
- WS endpoint accepts any connection; auth happens "later" via first message
- Token passed as URL query param logged in nginx/Kong access logs
- Anyone can subscribe to `bets-feed` and watch high rollers

**Prevention:**
- Validate Keycloak JWT during the HTTP upgrade handshake (NestJS gateway `handleConnection` rejecting if no valid `Authorization` header or `auth.token` from socket.io handshake payload). Verify against cached JWKS.
- Pass token via `Sec-WebSocket-Protocol` subprotocol or socket.io `auth` payload, NOT URL query. Query params end up in proxy logs.
- Refresh-token mid-round: implement silent refresh in FE; on token expiry, send `RECONNECT_AUTH` to server, server validates new token without dropping connection.
- JWKS cache: respect `Cache-Control: max-age` from Keycloak JWKS endpoint. Hammering JWKS on every connection is a DoS vector against Keycloak.

**Phase:** WS + Auth integration.
**Cost if missed:** Trivial PII leak. Security-conscious reviewer will flag instantly.

### H4. Token expiry mid-round → cashout rejected, player "loses" money
**Warning signs:**
- Player wins a 100x cashout that 401s because access token expired 200ms ago
- FE has no preemptive refresh; only refreshes on 401 response
- Two browser tabs racing on `refresh_token` rotation, one tab kills the other's session

**Prevention:**
- FE refreshes token at `expires_at - 30s` proactively (background timer). Use `BroadcastChannel` to coordinate refresh across tabs so only ONE tab performs the rotation; others wait and consume the new token.
- WS layer holds an internal "session valid until" timer. On expiry, server sends `AUTH_REFRESH_REQUIRED`, client sends new token via control frame, server revalidates. Round actions during the brief revalidation window are queued, not rejected.
- Refresh token rotation enabled in Keycloak; old refresh token is single-use. Without the BroadcastChannel coordination, multi-tab users will randomly get logged out.

**Phase:** Auth integration (FE + WS gateway).
**Cost if missed:** "Lost money" in demo = arguição catastrophe.

### H5. RabbitMQ topology mistakes
**Warning signs:**
- Single exchange carries both commands (`bet.debit`) and events (`balance.debited`)
- No `prefetch` set → one consumer hogs the queue
- Classic queues used instead of quorum → no at-least-once dead-lettering
- `noAck: true` → message lost if consumer crashes between receive and processing
- Topic exchange wildcards too broad → wallet service receives game-internal events
- Schema-less event payloads → adding a field breaks consumers silently

**Prevention:**
- Separate exchanges: `wallet.commands` (direct, durable) for `DebitBalance`/`CreditBalance`; `wallet.events` (topic, durable) for `BalanceDebited`/`InsufficientFunds`. Game side mirrors with `game.events`.
- Quorum queues everywhere. Set `x-delivery-limit: 5`. Add a DLQ per queue with `x-delivery-limit: 3` (lower) and an alert on non-empty DLQ.
- `channel.prefetch(N)` where N is small (10-50) per consumer. Manual ack only.
- Publisher confirms enabled (`channel.confirmSelect`). Outbox poller awaits `waitForConfirms` before marking published.
- Version events: include `eventVersion: 1` in every payload; consumers branch on version. Document event schemas in a shared `@crash/contracts` package.
- Use raw `amqplib` with explicit topology setup, OR `@nestjs/microservices` RabbitMQ transport — but NOT both for the same exchange. The Nest transport hides confirm-mode plumbing; if you need at-least-once outbox semantics, prefer raw `amqplib` and own the channel lifecycle.

**Phase:** Infra (topology + connection wrapper) + Saga.

### H6. Provably fair — verifier requires server call
**Warning signs:**
- "Verify" button hits `/games/rounds/:id/verify` and trusts the server's yes/no
- Algorithm code lives only on the backend; FE shows a black-box "verified ✓"
- Verifier page imports from `@crash/server` instead of `@crash/contracts`

**Prevention:**
- Provably-fair algorithm lives in `packages/provably-fair` — pure functions, no deps. Both backend and FE import it.
- Verifier UI takes `(serverSeed, clientSeed, nonce)` as inputs, computes crash point in browser, displays result. Compare with displayed-crash-point.
- README documents algorithm + provides curl example to independently verify via a public hashing tool.

**Phase:** Domain (algorithm) + FE (verifier page).

### H7. Multi-tab double cashout / double bet
**Warning signs:**
- Player has same `betId` on two tabs; both click cashout; both succeed
- Bet button enabled while a previous bet is `PENDING` saga state
- Optimistic UI shows balance updated before saga confirms; rollback flickers visibly

**Prevention:**
- Bet aggregate enforces single-active-bet-per-(roundId, userId) at DB level via partial unique index: `CREATE UNIQUE INDEX bet_active ON bets(round_id, user_id) WHERE status IN ('PENDING','ACTIVE')`. Second tab's bet fails with DB constraint, surfaced as 409.
- Cashout enforces `status = 'ACTIVE'` precondition with optimistic locking (`UPDATE ... WHERE status = 'ACTIVE' AND version = ?`). Affected-rows = 0 → already cashed out, surface as no-op.
- FE: cashout button shows pending spinner immediately on click; disabled until server confirms. WS broadcasts cashout for this user → all tabs sync state.
- Balance updates ONLY from authoritative `BalanceUpdated` WS event, never optimistically. If user feels lag, that's correct — money UX must prioritize correctness over snappiness.

**Phase:** Domain + WS + FE.

---

## MEDIUM — quality/polish impact, recoverable

### M1. Bun + NestJS regressions on watch mode
**Warning signs:**
- `bun --watch src/main.ts` crashes with `descriptor.value is undefined` on controllers
- Decorator metadata not emitted because `tsconfig.json` extends from a parent that doesn't set `emitDecoratorMetadata: true`
- Specific to Bun 1.3.10; works on 1.3.9 (regression filed at oven-sh/bun#27526)

**Prevention:**
- Pin Bun version in `package.json` `"packageManager"` field and document in README. Use a version known to work with NestJS 11 (verify in initial phase).
- `tsconfig.json` explicitly sets `emitDecoratorMetadata: true` and `experimentalDecorators: true` even when extending — do NOT rely on inheritance for these.
- Smoke test in CI: `bun run start` boots, hits `/health`, exits cleanly.
- Fallback dev mode: `nodemon --exec bun run` if `bun --watch` flakes.

**Phase:** Infra/Bootstrap (first thing in first phase).

### M2. Docker compose startup order failures
**Warning signs:**
- First `bun run docker:up` returns 500s for a minute; "just rerun it" works
- Keycloak realm import happens before Postgres accepts connections → Keycloak boots with empty DB
- Game/Wallet services try to declare RabbitMQ topology before broker accepts AMQP connections
- `bun:alpine` image lacks `curl`, so `healthcheck` always fails → dependent services never start

**Prevention:**
- Every service has a `healthcheck` (not just `depends_on`). Use `condition: service_healthy` for dependencies.
- Postgres: `pg_isready -U $POSTGRES_USER`. Keycloak: hit `/health/ready` (requires `KC_HEALTH_ENABLED=true`).
- Keycloak realm import: use `--import-realm` flag with mounted `realm-export.json`. Mark Keycloak healthy only after import completes.
- Migrations: separate one-shot container (`game-migrate`, `wallet-migrate`) that runs `drizzle-kit migrate` / `mikro-orm migration:up`, exits 0. Services depend on migration containers with `condition: service_completed_successfully`.
- Bun image: install `curl` (or use `wget` already present in alpine) for healthchecks.
- RabbitMQ: management plugin healthcheck via `rabbitmq-diagnostics ping`.
- Kong DB-less: mount declarative config, healthcheck on `:8001/status`.
- CI: pipeline that runs `docker compose down -v && docker compose up -d && wait-for-healthy && curl every endpoint`. If this fails on a fresh machine, the submission fails the "zero manual steps" requirement.

**Phase:** Infra (Docker compose).

### M3. Test flakiness from timing dependencies
**Warning signs:**
- E2E test: `await sleep(5000); expect(round.status).toBe('CRASHED')`
- Round-loop timer driving tests, so they take real wall-clock seconds and flake under CI load
- Two tests in same file pollute each other's DB state
- WS test creates Socket.IO client and never disconnects → port leak

**Prevention:**
- Domain layer is time-injectable: `Round.constructor(clock: Clock)`. In tests, inject `FakeClock` and `tick(ms)`. No real timers in unit tests.
- E2E tests use a "fast mode" env flag that shortens betting window (10s → 100ms) and accelerates multiplier formula. Test the same logic, faster.
- Each E2E test runs in an isolated transaction rolled back at teardown, OR truncates relevant tables in `beforeEach`. Never share state.
- Use a real RabbitMQ container (testcontainers) for integration tests of saga + outbox + inbox. Mocking the broker hides timing bugs that only appear in production.
- Bun test: explicit `await server.stop()` and `await ws.close()` in teardown. Bun does NOT have Jest's process-level mock isolation, so cross-test leaks are easy.
- Bun mock subtlety: `mock.module()` updates the module cache but the original module's side effects (e.g. registering DI providers at import time) already ran. Mock before first import, OR design code so import is side-effect-free.

**Phase:** Tests (each phase contributes its own tests).

### M4. Canvas rendering pitfalls (crash curve)
**Warning signs:**
- Curve drawn over previous frame without `clearRect` → ghosting
- `requestAnimationFrame` loop continues when tab is hidden → battery drain on mobile
- Canvas sized via CSS without `width`/`height` attributes → blurry on retina (devicePixelRatio not applied)
- New `Path2D` allocated every frame → GC pressure visible in 60fps profile

**Prevention:**
- `clearRect(0, 0, canvas.width, canvas.height)` at top of every frame; OR redraw a background gradient.
- Respect `document.visibilityState`: cancel RAF on `hidden`, resume on `visible` after snapshot from server.
- Set canvas pixel dimensions to `cssSize * devicePixelRatio` and scale context by `dpr`. Critical for high-DPI screens.
- Reuse Path2D objects; mutate via `moveTo`/`lineTo` rather than `new Path2D()` per frame.

**Phase:** FE (game page).

### M5. TanStack Start SSR hydration mismatches
**Warning signs:**
- Console warning "Hydration failed because the server rendered HTML didn't match the client"
- Game page initially renders empty multiplier then jumps to live value
- Date/time formatting differs between server (UTC) and client (local TZ)

**Prevention:**
- Wrap WebSocket-driven components in `<ClientOnly>` from TanStack Start — there is no useful SSR for live game state.
- Or mark the route `ssr: false` for `/game`. Login/home stay SSR for SEO and fast first paint.
- For time displays in SSR'd parts, use ISO strings on server and let client format on hydration with a stable placeholder during first paint.
- Be aware of streaming-SSR race condition documented in TanStack Start (router#6806): a component that unsuspends before document stream completes triggers hydration crash. Keep WS subscriptions out of suspense boundaries.

**Phase:** FE.

### M6. Frontend input validation gaps
**Warning signs:**
- Bet input accepts `1e10`, `-5`, `0.0000001`, `Infinity`
- Auto-cashout target accepts `1.0` (lower than start = instant crash)
- Form submits during BETTING_CLOSED window because button wasn't reactive to round state
- Toast notifications stack to 50+ on rapid network errors

**Prevention:**
- Bet input parsed via Money VO on client side too (shared `packages/money`). Reject anything not parseable.
- Auto-cashout target validated as `> 1.00x` AND `<= maxConfigured`. Validation displayed inline, not as toast.
- Bet button derived from `useRoundPhase()` hook — `disabled = phase !== 'BETTING'`. Don't trust user not to click during the wrong window; server will reject, but FE should match.
- Toast library with deduplication (e.g. `sonner`'s built-in dedupe by message) and max-stack limit (3-5).

**Phase:** FE.

### M7. WebSocket reconnection storms after backend restart
**Warning signs:**
- Service restart → all clients reconnect simultaneously → broker overwhelmed
- No exponential backoff → tight reconnect loop pegs CPU
- Slow consumer (one client on poor wifi) blocks broadcast for everyone

**Prevention:**
- Client reconnect: exponential backoff with jitter (`min(2^n * 100ms, 30s) + random(0, 1000)ms`). Socket.io's default reconnection handles this; native WS needs manual implementation.
- Server: bounded outbound queue per client. Drop oldest non-critical messages (multiplier ticks) if queue full; never drop critical (round result, cashout confirmation).
- Decouple broadcast from per-client write via worker pool or `Promise.all`. Never `for (client of clients) await client.send(...)` — that's head-of-line blocking.
- Heartbeat (ping/pong) every 30s. Disconnect and clean up sockets that fail two pings.
- On disconnect handler: remove subscriptions, clear timers, null large references. Socket.io has documented memory-leak history when this is sloppy.

**Phase:** WS.

### M8. NestJS RabbitMQ transport vs raw amqplib choice
**Warning signs:**
- Using `@nestjs/microservices` RabbitMQ transport AND trying to implement outbox/inbox manually — fighting the framework
- `@MessagePattern` decorators hiding ack/nack semantics needed for at-least-once
- Cannot configure publisher confirms via the Nest transport without ejecting

**Prevention:**
- Decision in ADR: use raw `amqplib` (or `@golevelup/nestjs-rabbitmq`, which exposes channel/confirm semantics) for full control over outbox/inbox/confirms/DLX. The Nest microservices transport is fine for simple RPC; it is the wrong fit for production-grade event-sourcing.
- Wrap connection lifecycle in a NestJS provider with `OnModuleInit`/`OnModuleDestroy` so reconnect, channel re-creation, and topology re-assertion happen automatically.

**Phase:** Infra.

---

## LOW — code hygiene, naming, polish

### L1. Code smells fingerprinting AI generation
**Warning signs:**
- Excessive comments explaining what code does
- Variable names like `data`, `result`, `temp`, `obj`
- Verbose markdown-style commit messages
- TODO comments left in submitted code
- Unused imports or dead code paths
- Emojis in code or commits

**Prevention:**
- Strict ESLint config: `no-unused-vars`, `@typescript-eslint/no-explicit-any`, `eslint-plugin-import` for ordering and unused.
- Per global CLAUDE.md: no emojis anywhere in code or commits, no AI attribution, no obvious comments.
- Run a "humanization pass" before commit: read each file as a reviewer would.
- Name domain methods after ubiquitous-language verbs (`round.acceptBet`, not `round.addPlayerBet`).

**Phase:** Every phase (review gate).

### L2. Git history that fails the 10% scoring criterion
**Warning signs:**
- One giant "Initial commit" with everything
- Commit messages like "wip", "fix", "stuff"
- `Co-Authored-By: Claude` in any commit (explicit disqualifier per global CLAUDE.md)
- Sensitive files committed (.env, keycloak admin creds)
- Mixed concerns in single commit (refactor + feature + style)

**Prevention:**
- Per global CLAUDE.md: humanized commit messages, no AI attribution, follow project convention. Use conventional-commits-style verbs (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`) consistently.
- Commit atomically per task. Each task in the roadmap → 1-3 commits.
- `.gitignore` covers `.env*`, `node_modules`, `dist`, `coverage`, `.bun-cache`.
- Pre-commit hook (lefthook/husky) runs lint + format + secrets scanner (`detect-secrets` or `gitleaks`).
- README has install steps that work from a fresh clone — verify by cloning into `/tmp` and running.

**Phase:** Every phase (commit discipline), final pass before submission.

### L3. README and ADRs missing the "why"
**Warning signs:**
- ADRs that read "we chose X because we chose X"
- README has setup steps but no architecture diagram
- No mention of trade-offs considered and rejected
- Provably fair algorithm not documented anywhere

**Prevention:**
- ADR template: Context → Decision → Consequences → Alternatives Considered (with reasons rejected). One ADR per key decision listed in `PROJECT.md`.
- README sections: What/Why → Quickstart → Architecture (diagram) → Domain Model → Saga Flow → Provably Fair (with algorithm) → Trade-offs → Future Work.
- Architecture diagram: Mermaid in README so it renders on GitHub without external assets.

**Phase:** Docs (continuous, formalized at milestone).

### L4. Observability afterthought
**Warning signs:**
- No correlation IDs through saga (cannot trace one bet end-to-end)
- Logs are `console.log("here")` debugging strings
- Metrics endpoint missing or returning irrelevant data
- Grafana dashboards committed but reference nonexistent metrics

**Prevention:**
- Pino logger with structured JSON. Trace ID propagated via OpenTelemetry from REST → WS → RabbitMQ message headers → consumer.
- Domain metrics: `crash_round_total{outcome}`, `crash_bet_amount_sum`, `crash_payout_sum`, `crash_rtp_window`, `crash_ws_latency_seconds`, `crash_multiplier_drift_ms`.
- Grafana dashboard JSON committed; metrics actually emitted by code in same commit.

**Phase:** Bonus (REQ-BONUS-03), but design tracing in from phase 1 (otherwise retrofitting is painful).

---

## Top 10 Differentiator Moves

Avoiding these pitfalls demonstrates senior judgment beyond a generic AI submission. These are the moves that, in the arguição, will visibly separate this submission from the rest.

1. **Money as a value object with bigint internals from line one** — not retrofitted. Show ADR explicitly choosing bigint+scale over dinero.js v2, with the trade-off documented.
2. **Cashout race solved by server-authoritative timestamps + async mutex on the round aggregate** — demonstrate with a property test that hammers cashout requests around the crash boundary.
3. **Pre-generated hash chain, client-side verifier with zero server calls** — recruiter can verify a past round on a third-party SHA-256 page and the math reproduces.
4. **Outbox + Inbox + Quorum queues + Publisher confirms + DLX with delivery-limit on the DLQ itself** — kill -9 the wallet service mid-saga in the demo; balance still consistent on restart.
5. **One aggregate per transaction, enforced by saga** — show the saga state machine table and the `bet_saga_state` rows recovering after restart.
6. **Multi-tab coordination via BroadcastChannel for token refresh** — open three tabs, force token expiry, watch them all refresh once. Single Postgres-backed source of truth for active bets prevents double-cashout.
7. **Deterministic replay endpoint** — any past round reproduced byte-for-byte from its seed. Bonus REQ-BONUS-04 done properly demonstrates the same fairness algorithm is the only source of truth.
8. **`bun run docker:up` works on a fresh clone with zero manual steps** — including realm import, migrations, Kong routes. Recorded as a CI job that runs on every push.
9. **Property-based tests on monetary invariants and state-machine transitions** — fast-check on Money arithmetic and Round FSM legality. Demonstrates discipline beyond example-based testing.
10. **ADRs with rejected alternatives** — for each key decision (ORM, money lib, saga library vs hand-rolled, raw amqplib vs Nest transport, server-tick rate, hash-chain pre-generation depth), document what was considered and why rejected. This is the single clearest signal of senior reasoning.

---

## Sources (with confidence levels)

HIGH confidence (official docs, multiple corroborating sources):
- [PostgreSQL Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html) — NUMERIC for money, pg returns as string
- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx) — DLX semantics
- [RabbitMQ Quorum Queues](https://www.rabbitmq.com/docs/quorum-queues) — at-least-once dead-lettering with confirms
- [RabbitMQ Publishers](https://www.rabbitmq.com/docs/publishers) — publisher confirms
- [RabbitMQ Reliability Guide](https://www.rabbitmq.com/docs/reliability)
- [TanStack Start Hydration Errors](https://tanstack.com/start/latest/docs/framework/react/guide/hydration-errors)
- [TanStack Start Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)
- [Bun Mocks docs](https://bun.com/docs/test/mocks)
- [Bun Watch Mode docs](https://bun.sh/docs/runtime/hot)
- [Socket.IO Memory Usage docs](https://socket.io/docs/v4/memory-usage/)

MEDIUM confidence (community articles, dev blogs, GitHub issues):
- [Transactional Outbox with RabbitMQ — DLQ and Observability](https://dev.to/sagarmaheshwary/transactional-outbox-with-rabbitmq-part-2-handling-retries-dead-letter-queues-and-observability-4h19)
- [Inbox Pattern for Idempotency](https://dev.to/actor-dev/inbox-pattern-51af)
- [Implementing provably fair in crash games](https://medium.com/@createitsc/implementing-provably-fair-in-crash-games-d82d2a31157f)
- [Crash Game Algorithm: Formulas & Hash Math](https://crashgamesplay.com/guides/crash-game-algorithm/)
- [Understanding provable fairness: Seeds, hashes, HMAC](https://casinosblockchain.io/understanding-provable-fairness-in-crash-games/)
- [Scaling crash games — race condition prevention](https://pctechmag.com/2025/08/scaling-crash-games/)
- [Bun regression on NestJS controllers (oven-sh/bun#27526)](https://github.com/oven-sh/bun/issues/27526)
- [MikroORM competitive analysis vs Prisma, Drizzle](https://github.com/mikro-orm/mikro-orm/discussions/7176)
- [Applying DDD to NestJS](https://dev.to/bendix/applying-domain-driven-design-principles-to-a-nest-js-project-5f7b)
- [RabbitMQ DLQ poisonous message handling](https://joaovieira.ca/rabbitmq-dlq-poisonous-message/)
- [Dinero.js v2 release notes](https://www.sarahdayan.com/blog/dinerojs-v2-is-out)
- [Real-time Multiplayer Networking: Tick Rate and Interpolation](https://bytes.vokal.io/20160912-multiplayer-tickrate-interpolation/)
- [Money operations with Node.js and PostgreSQL](https://medium.com/geekculture/money-operations-with-node-js-and-postgresql-91d1f06ff263)

LOW confidence (single-source, opinion pieces):
- [RabbitMQ Failures in Microservices survival guide](https://medium.com/@har.avetisyan2002/rabbitmq-failures-in-microservices-a-comprehensive-survival-guide-1bb1768282b5)
- [Keycloak Token Validation for APIs](https://skycloak.io/blog/keycloak-token-validation-for-apis/)
