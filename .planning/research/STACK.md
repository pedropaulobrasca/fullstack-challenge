# Technology Stack — Crash Game

**Project:** Jungle Gaming Fullstack Challenge — Crash Game
**Researched:** 2026-05-24
**Overall confidence:** HIGH (versions and compatibilities verified against official sources and current 2026 ecosystem reporting)

---

## 1. Locked Stack (challenge constraints)

| Layer | Tech | Version | Rationale |
|-------|------|---------|-----------|
| Runtime | Bun | 1.3.11+ | Required by spec. Bun 1.3 ships native decorator transform — NestJS runs unmodified. ~2.4x throughput vs Node for NestJS+Express. |
| Backend framework | NestJS | 11.1.21 | Required by spec. Modular DI, decorators, first-class WS/microservices, mature DDD ergonomics. |
| Language | TypeScript | 5.6+ strict | Required. `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` for DDD safety. |
| Database | PostgreSQL | 18 | Provided in Docker Compose. PG 18 adds OAuth, async I/O, virtual generated columns. |
| Message broker | RabbitMQ | 4.2 (mgmt) | Provided. Quorum queues for durability; supports outbox/inbox + saga choreography. |
| Identity Provider | Keycloak | 26.5 | Provided. Realm `crash-game`, client `crash-game-client` (PKCE S256). JWT validated via JWKS in NestJS. |
| API Gateway | Kong | 3.9 (DB-less) | Provided. Declarative config; routes for game/wallet REST + WS. |
| Frontend framework | TanStack Start | 1.x stable | User-chosen. v1.0 stable released March 2026 (RC since Sep 2025). |
| Styling | Tailwind CSS | v4.1+ | Locked. `@theme` directive, CSS-first config. |
| UI primitives | shadcn/ui | CLI v4 | Locked. CLI v4 (March 2026) scaffolds TanStack Start templates natively. |
| Client state | Zustand | 5.x | Locked. Minimal, no Provider, store-as-hook. |
| Server state | TanStack Query | 5.x | Locked. Pairs natively with TanStack Start. |

Sources: [Bun 1.3 release notes](https://bun.com/blog), [NestJS releases](https://github.com/nestjs/nest/releases), [TanStack Start v1 blog](https://tanstack.com/blog/announcing-tanstack-start-v1), [shadcn/cli v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4).

---

## 2. Recommended Choices (open decisions)

### 2.1 ORM — **MikroORM 7.1+**

| Field | Value |
|-------|-------|
| Choice | MikroORM `^7.1.x` (latest 7.0.10, v7.1 with PG partitioning/triggers/AbortSignal) |
| Packages | `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/nestjs`, `@mikro-orm/migrations`, `@mikro-orm/seeder` |
| Confidence | HIGH |

**Rationale — why MikroORM wins for this challenge:**
- **Identity Map + Unit of Work are DDD-native.** Aggregates returned from a repository are the SAME instance across the request. No "load then re-save with stale state" footguns. This directly serves REQ-DOM-01/02/03 (aggregate invariant enforcement).
- **Data Mapper, not Active Record.** Entities are POJOs with private setters; no inheritance from a framework base class. Domain layer stays pure.
- **`em.transactional()` with `IsolationLevel.SERIALIZABLE`** is one line — critical for Wallet debit/credit (REQ-DOM-03, REQ-WALL-02) and outbox writes in same TX (REQ-WALL-03).
- **First-class NestJS integration** via `@mikro-orm/nestjs` — request-scoped EntityManager per request, automatic transaction propagation.
- **Embeddables** map Value Objects (Money, Multiplier) to columns natively — no manual hydration code.
- **Bun compatibility verified.** Works on Bun 1.3 with NestJS; only caveat is `Relation<>` wrapper type for circular entity references when using SWC.

**Alternatives rejected:**

| Option | Why not |
|--------|---------|
| Prisma 6/7 | Anemic models by design — schema-first generator produces plain types, no encapsulation. Forces "service-with-getters" anti-pattern. UoW is implicit per query; explicit aggregate semantics are awkward. Bun support stable since 5.4 but the philosophical mismatch with DDD purity (which is 25% of scoring) disqualifies it. |
| TypeORM | Maintenance has slowed; Active Record vs Data Mapper duality leaks framework concerns into entities. Repository pattern is shallow. Known issues with circular deps + SWC + Bun. Legacy. |
| Drizzle | Excellent type safety but it's a query builder, not an ORM with UoW/Identity Map. Would force hand-rolling aggregate persistence — too much wheel-reinvention for 5 days. |

Sources: [MikroORM v7 blog](https://mikro-orm.io/blog/mikro-orm-7-released), [MikroORM NestJS integration](https://mikro-orm.io/docs/usage-with-nestjs), [Bun+NestJS+MikroORM guide](https://pas7.com.ua/blog/en/nestjs-bun-performance-2026).

---

### 2.2 Monetary precision — **dinero.js v2 (stable)**

| Field | Value |
|-------|-------|
| Choice | `dinero.js@^2.0.0` (stable, released **March 2, 2026** after ~5 years of alpha) |
| Confidence | HIGH (stable release confirmed) |

**Rationale:**
- **v2 is finally stable** — March 2026 GA after 17 alphas. No longer a risk.
- **Pure integer arithmetic** (amount + currency.exponent). Zero float ops anywhere — directly satisfies REQ-DOM-03 and the disqualifier "float math for money."
- **Immutable + functional API.** Tree-shakable. Each operation returns a new Dinero object — perfect for Money as a Value Object in DDD.
- **Isomorphic.** Same library backend (NestJS) and frontend (TanStack) — Money serializes via `toSnapshot()` over the wire, one mental model.
- **Currency objects ship 166 ISO 4217 codes** with correct exponents (USD=2, JPY=0, BHD=3). Play-money for the challenge uses a custom currency descriptor (`{ code: 'CRD', base: 10, exponent: 2 }`).
- **Martin Fowler's Money pattern** — explicitly DDD-aligned; recruiter-recognizable reference.

**Wrapper strategy:** Wrap dinero.js in a project-local `Money` value object class in `packages/shared-kernel`. The class enforces non-negative balance invariant, currency-mismatch errors, and exposes only the operations needed (`add`, `subtract`, `multiply`, `compareTo`, `isZero`). dinero.js stays an implementation detail.

**Alternatives rejected:**

| Option | Why not |
|--------|---------|
| decimal.js | General-purpose arbitrary precision — no currency concept. Would have to hand-roll currency, rounding mode, formatting. Used by Prisma internally but overkill for a single play-money currency. |
| bigint + scale | Maximum control but maximum surface area for bugs. Have to hand-roll formatting, parsing, rounding (banker's vs half-up), serialization. Net-negative under 5-day timeline. |
| currency.js | Internally uses float (Number with ×100 scale) — fast but loses precision on multi-step calcs (Martingale chains in REQ-BONUS-02). Disqualifies on principle. |
| js-money | Unmaintained since 2018. Dead. |

Sources: [Dinero.js v2 release announcement](https://www.sarahdayan.com/blog/dinerojs-v2-is-out), [Honeybadger currency comparison](https://www.honeybadger.io/blog/currency-money-calculations-in-javascript/).

---

### 2.3 WebSocket — **Socket.IO 4.8 via `@nestjs/platform-socket.io`**

| Field | Value |
|-------|-------|
| Choice | `socket.io@^4.8.x` + `@nestjs/websockets@11.1.21` + `@nestjs/platform-socket.io@11.1.21` |
| Confidence | HIGH |

**Rationale:**
- **Rooms, namespaces, auto-reconnection are free.** Crash game needs a global "round-feed" room, per-user notifications, and resilient browser clients. Hand-rolling these on raw `ws` or uWS for a 5-day challenge is wasted effort.
- **Socket.IO 4.8.x confirmed compatible** with NestJS 11.1.x (current example uses both at 11.1.13+).
- **Client interpolation strategy (REQ-WS-02)** doesn't need 60 Hz from server — server emits at 10-20 Hz (every 50-100ms), client interpolates locally at requestAnimationFrame (60fps). At that broadcast rate, Socket.IO p99 latency is fine for hundreds of concurrent clients on a single node (well within challenge scope).
- **Acknowledgement support** for cashout RPC-style ops (client emits `cashout`, server replies with payout or rejection) — built-in, no custom protocol.
- **Bun support is improving.** `@socket.io/bun-engine` exists if needed, but the default engine.io runs on Bun's Node-compat layer; this is the lowest-risk path.

**Alternatives rejected:**

| Option | Why not |
|--------|---------|
| `ws` (raw) | Have to hand-roll rooms, broadcasts, reconnection, auth handshake, heartbeat. No benefit at this scale. |
| uWebSockets.js | 5-10x throughput is real but irrelevant — challenge is judged on architecture/correctness, not c10k. NestJS adapter exists but is third-party and less battle-tested. No server-side reconnection concept. Adds risk for no scoring upside. |
| Server-Sent Events | One-way only; cashout needs client→server. Disqualified by bidirectional requirement. |

**Multiplier sync strategy (decision detail for roadmap):**
- Server is canonical authority for `roundStartedAt: epoch ms` and the crash multiplier formula.
- Tick broadcast every ~100ms: `{ roundId, serverNow, multiplier }`.
- Client computes its own multiplier each frame from `roundStartedAt` + own clock + drift correction (EWMA of `serverNow - clientNow`).
- Crash event broadcast immediately on server-side crash with `{ roundId, crashAt, finalMultiplier }`.

Sources: [@nestjs/platform-socket.io on npm](https://www.npmjs.com/package/@nestjs/platform-socket.io), [Socket.IO vs ws vs uWS comparison](https://www.pkgpulse.com/guides/socketio-vs-ws-vs-uwebsockets-websocket-servers-nodejs-2026), [NestJS WebSocket adapter docs](https://docs.nestjs.com/websockets/adapter).

---

### 2.4 Provably-Fair — **Hand-rolled hash-chain (Bustabit pattern), Node `crypto`**

| Field | Value |
|-------|-------|
| Choice | Bun built-in `crypto` (`createHmac`, `createHash`) — no extra dep |
| Pattern | Pre-generated server-seed hash chain + per-round client seed + HMAC-SHA256 + 52-bit method |
| Reference impl | Bustabit verifier (public source) |
| Confidence | HIGH |

**Algorithm (canonical Bustabit-style, suitable for ADR):**

1. **Server-seed chain (pre-generated, persisted at bootstrap):**
   - Generate `terminalSeed = randomBytes(32)`.
   - Build chain: `chain[0] = terminalSeed`, `chain[i+1] = SHA256(chain[i])`.
   - Use rounds in REVERSE: round 1 uses `chain[N-1]`, round 2 uses `chain[N-2]`, etc.
   - Publish `chain[0]` (the terminalHash) at launch — proves chain was committed before any bet.

2. **Client seed (per round):** Public, unpredictable. Use the SHA-256 hash of the previous round's RabbitMQ-ack'd `roundClosedAt` timestamp + previous round's final multiplier (deterministic but unknowable before round close). For higher rigor, optionally allow players to contribute entropy.

3. **Crash-point derivation (52-bit method):**
   ```
   hash = HMAC_SHA256(serverSeed, clientSeed)
   hex13 = hash.substring(0, 13)
   intVal = parseInt(hex13, 16)         // 52-bit int
   e = 2**52
   crashPoint = floor((100 * e - intVal) / (e - intVal)) / 100
   ```
   - Also apply a 1-in-N "instant-crash at 1.00x" bucket for house edge calibration (configurable RTP).

4. **Verification (REQ-FE-05, REQ-BONUS-04):**
   - Round view exposes `{ serverSeedHash, serverSeed (revealed post-crash), clientSeed, nonce, crashPoint }`.
   - Frontend recomputes locally using SubtleCrypto and asserts equality.
   - For replay (REQ-BONUS-04), the round's `serverSeed + clientSeed + bets[]` are sufficient to reproduce the entire round byte-for-byte (tick by tick).

**No library used** — implementation is ~80 lines, fits in `packages/shared-kernel/src/provably-fair/`. Adding a third-party crypto wrapper would obscure the algorithm during arguição. The reference implementations (Bustabit Rust/PHP) are study material, not deps.

Sources: [Bustabit verifier](https://bustabit.github.io/verifier/), [Bustabit Rust reference impl](https://github.com/vladignatyev/bustabit-rust), [createIT crash impl writeup](https://medium.com/@createitsc/implementing-provably-fair-in-crash-games-d82d2a31157f), [crashgamesplay.com algorithm guide](https://crashgamesplay.com/guides/crash-game-algorithm/).

---

### 2.5 Testing — **Bun test (unit + integration) + Playwright 1.49+ (browser E2E) + fast-check 3.x (property)**

| Field | Value |
|-------|-------|
| Unit/integration | `bun:test` built-in (no install) |
| Property-based | `fast-check@^3.x` — official Bun tutorial exists, confirmed working |
| Browser E2E | `@playwright/test@^1.49.x` (current as of 2026) |
| Confidence | HIGH for Bun test + fast-check, HIGH for Playwright |

**Rationale:**
- **Bun test is 10-15x faster than Jest, 3-10x faster than Vitest.** For a pure-TS DDD codebase (no DOM, no React rendering server-side, no Jest-specific mocks), Bun test is the right call. Zero config, ships with the runtime.
- **fast-check + Bun is officially documented** and used in production CI. Satisfies REQ-TEST-02 (property tests for monetary invariants, state-machine transitions). Generators for `Money`, `Multiplier`, round-state sequences.
- **NestJS e2e with Bun test:** Works for service-level integration tests using `Test.createTestingModule(...)`. Bun's Jest API compat is sufficient.
- **Playwright** for REQ-BONUS-06 (full player flow: login → bet → cashout, login → bet → crash). Bun-installable, runs under Node for browser drivers — this is fine, only test execution touches Bun.

**Caveat:** A handful of obscure Jest globals (`jest.advanceTimersByTime` mocks, some matchers) are missing in bun:test. Workaround: use `vi`-style equivalents or `setSystemTime`. For Round lifecycle tests (which need controlled time), inject a `Clock` port into the aggregate — purer DDD anyway.

**Not used:**
- Vitest — adds a second test runner to the toolchain; Bun test covers it.
- Jest — slower, ESM friction, no upside.
- Cypress — Playwright is the modern standard, multi-browser, faster.

Sources: [Bun test runner docs](https://bun.com/docs/test), [fast-check Bun tutorial](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-bun-test-runner/), [bun test vs vitest vs jest benchmarks](https://www.pkgpulse.com/guides/bun-test-vs-vitest-vs-jest-2026).

---

### 2.6 Validation — **zod 3.x at the edges + project-local Value Objects in the domain**

| Field | Value |
|-------|-------|
| Choice | `zod@^3.23.x` + `nestjs-zod@^4.x` for controller/DTO layer |
| Domain layer | NO validation library — invariants enforced in VO constructors |
| Confidence | HIGH |

**Rationale:**
- **Two layers, two responsibilities.** At the HTTP boundary (controllers, WS handlers): zod schema validates request shape and primitive constraints (positive number, ISO string, UUID). At the domain layer: VOs (`Money`, `BetAmount`, `Multiplier`, `RoundId`) enforce invariants in their constructors and throw domain errors.
- **zod gives single-source-of-truth types.** `type CreateBetDto = z.infer<typeof CreateBetSchema>`. No DTO/validator drift.
- **`nestjs-zod` integrates with `ValidationPipe`** and produces OpenAPI schemas — useful for the README's API docs section.
- **class-validator is rejected** because:
  - Two sources of truth (DTO class shape + decorator metadata).
  - Reflect-metadata + decorator dance fights Bun's SWC transform.
  - Inferior type narrowing; doesn't compose with discriminated unions cleanly.
- **Domain VOs do NOT use zod.** Construction throws `InvalidMoneyError`, `BetBelowMinimumError`, etc. — explicit domain exceptions per DDD. zod errors stay HTTP-layer concern. This is the "no anemic models" discipline.

Sources: [nestjs-zod npm](https://www.npmjs.com/package/nestjs-zod), [Zod vs class-validator comparison](https://dev.to/young_gao/input-validation-in-typescript-apis-zod-vs-joi-vs-class-validator-2gcg).

---

### 2.7 Observability — **OpenTelemetry SDK + Prometheus + Grafana (provided dashboards)**

| Field | Value |
|-------|-------|
| SDK | `@opentelemetry/sdk-node@^0.55.x`, `@opentelemetry/api@^1.9.x` |
| Auto-instrumentation | `@opentelemetry/auto-instrumentations-node@^0.55.x` |
| NestJS bridge | `nestjs-otel@^6.x` (by pragmaticivan) — adds NestJS-aware spans, request scope, metric decorators |
| Metrics exporter | `@opentelemetry/exporter-prometheus@^0.55.x` |
| Trace exporter | `@opentelemetry/exporter-trace-otlp-http@^0.55.x` (to local Tempo or Jaeger) |
| Prometheus | `prom/prometheus:v3.x` Docker image |
| Grafana | `grafana/grafana:11.x` Docker image |
| Confidence | HIGH |

**Custom metrics for crash game (REQ-BONUS-03):**

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `crash_round_total` | counter | `result=crashed|cashed_out` | game service |
| `crash_round_duration_seconds` | histogram | — | game service |
| `crash_bet_volume_total` | counter | `currency` | game service |
| `crash_bet_amount` | histogram | `currency` | game service |
| `crash_payout_amount` | histogram | `currency` | game service |
| `crash_rtp_ratio` | gauge | `window=24h|7d` | computed by collector job |
| `crash_ws_clients` | gauge | — | gateway |
| `crash_ws_broadcast_latency_seconds` | histogram | `event_type` | gateway |
| `crash_multiplier_drift_seconds` | histogram | — | client→server reconciliation report |
| `wallet_balance_change_total` | counter | `op=debit|credit` | wallet service |
| `outbox_pending_messages` | gauge | `service` | both services |
| `inbox_processed_total` | counter | `service,result=ok|duplicate|error` | both services |
| `saga_state` | gauge | `saga,state` | game service |
| `rabbitmq_publish_total` | counter | `exchange,routing_key,result` | both services |

**Grafana dashboards to import (JSON sources):**

| Source | Use |
|--------|-----|
| [RabbitMQ official Grafana dashboards](https://www.rabbitmq.com/docs/prometheus#grafana-dashboards) | Cluster, queues, message rates |
| [PostgreSQL exporter dashboards](https://grafana.com/grafana/dashboards/?search=postgres) (IDs 9628, 14114) | Connections, locks, slow queries |
| [Node.js / OTel dashboards](https://grafana.com/grafana/dashboards/?dataSource=prometheus&search=opentelemetry) | Auto-instrumented HTTP, GC, event loop lag |
| Custom Crash dashboard | RTP, bet volume, WS latency, multiplier drift (hand-built panels — score points for visible domain literacy) |

Sources: [SigNoz NestJS+OTel guide](https://signoz.io/blog/opentelemetry-nestjs/), [pragmaticivan/nestjs-otel](https://github.com/pragmaticivan/nestjs-otel), [Last9 OpenTelemetry NestJS](https://last9.io/blog/opentelemetry-in-nestjs/), [RabbitMQ Prometheus docs](https://www.rabbitmq.com/docs/prometheus).

---

### 2.8 TanStack Start specifics

| Aspect | Decision | Source |
|--------|----------|--------|
| Version | `@tanstack/react-start@^1.x` stable (GA March 2026) | [TanStack blog](https://tanstack.com/blog/announcing-tanstack-start-v1) |
| Build | Vite 5+ (built-in) | TanStack docs |
| Routing | File-based via `src/routes/**` | TanStack Router |
| Auth pattern | **`oidc-spa` + server-function middleware** for Keycloak | [oidc-spa TanStack Start guide](https://docs.oidc-spa.dev/integration-guides/tanstack-router-start/tanstack-start) |
| OIDC flow | Authorization Code + PKCE (S256) — matches Keycloak realm config | spec |
| Token storage | HttpOnly cookie set by server function; access token in memory, refresh via TanStack Query | oidc-spa pattern |
| Deployment | Vite production build → static + Node server, runnable in Docker via Bun | spec — Docker only |
| Server-state hydration | TanStack Query `dehydrate`/`hydrate` via `routeLoader` | TanStack docs |

**Rationale for `oidc-spa`:** Purpose-built for browser-first SPAs with Keycloak, ships TanStack Start adapter, handles PKCE/refresh/silent-renew correctly. The alternative (raw `oidc-client-ts` or rolling your own) burns 1-2 days that should go to game logic.

Sources: [oidc-spa TanStack Start example](https://example-tanstack-start.oidc-spa.dev/), [Medium OIDC Keycloak TanStack Start](https://medium.com/@othmane.outama/tanstack-start-authentication-with-oidc-oauth-2-0-keycloak-example-2a2177824d7c), [TanStack Start auth overview](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-overview).

---

### 2.9 shadcn/ui — **CLI v4 with TanStack Start template, Tailwind v4**

| Aspect | Decision |
|--------|----------|
| CLI | `shadcn@latest` (v4, March 2026) |
| Init command | `bunx shadcn@latest init` → choose **TanStack Start** template |
| Tailwind | v4 with `@theme` directive (auto-configured by `init`) |
| Components installed on demand | `bunx shadcn@latest add button card dialog toast ...` |
| Confidence | HIGH |

CLI v4 natively scaffolds TanStack Start (no longer Next.js-only). `@/*` alias auto-configured. All components updated for Tailwind v4 + React 19.

**Components likely needed for crash UI:** `button`, `card`, `dialog`, `input`, `label`, `tabs`, `toast`/`sonner`, `tooltip`, `dropdown-menu`, `skeleton`, `badge`, `progress`, `separator`.

Sources: [shadcn/cli v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4), [shadcn TanStack Start install](https://ui.shadcn.com/docs/installation/tanstack), [shadcn Tailwind v4 page](https://ui.shadcn.com/docs/tailwind-v4).

---

### 2.10 Outbox/Inbox — **Hand-rolled, NOT a third-party package**

| Field | Value |
|-------|-------|
| Choice | Custom implementation in `packages/shared-kernel/src/messaging/{outbox,inbox}` |
| Storage | PostgreSQL tables `outbox_messages`, `inbox_messages` |
| Publisher | Polling worker (1-2s tick) using `SELECT ... FOR UPDATE SKIP LOCKED` |
| Idempotency | Inbox row keyed by `(consumer, message_id)` UNIQUE, processed in same TX as side-effect |
| Confidence | HIGH |

**Rationale:**
- Existing packages (`@naviedu/nestjs-outbox-inbox`, `Nestixis/nestjs-inbox-outbox`) are **low-adoption** (sub-1k weekly downloads), maintained by single authors, with thin docs. Risk of arguição question "how does the outbox dispatcher recover from a crash?" being unanswerable hurts the 25% DDD/Architecture score.
- **Hand-rolled is ~200 lines** and demonstrates the pattern explicitly. Recruiter sees the polling loop, the `SKIP LOCKED` claim, the at-least-once + idempotent-consumer combo — direct evidence of senior engineering (this scores).
- Same-TX write to domain table + outbox table (the dual-write fix) is the entire point — this needs to be visible code in the repo, not hidden in a node_modules dep.
- ADR for this choice writes itself: "we chose to implement to demonstrate understanding, not to depend on a single-maintainer abandoned package."

**Implementation shape:**

```
[DomainCommand] → @Transactional()
  ├── repo.save(aggregate)
  └── outboxRepo.insert({ id, aggregateType, eventType, payload, occurredAt })

[OutboxPoller] every 1s
  ├── SELECT * FROM outbox WHERE published_at IS NULL ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT 50
  ├── publish to RabbitMQ (mandatory + publisher confirms)
  └── UPDATE outbox SET published_at = now() WHERE id IN (...)

[Consumer] AMQP handler
  ├── @Transactional()
  ├── INSERT INTO inbox (consumer, message_id, ...) -- UNIQUE violation = duplicate, ack & skip
  ├── handle business logic (debit wallet, etc.)
  └── COMMIT → ack message
```

Sources for understanding (not deps): [axotion outbox+inbox NestJS writeup](https://axotion.medium.com/solving-the-dual-write-problem-with-nestjs-implementing-inbox-and-outbox-patterns-3b20a8bd49a1), [Iwanczyszyn outbox+RabbitMQ](https://medium.com/@sebastian.iwanczyszyn/implementing-the-outbox-pattern-in-distributed-systems-with-nestjs-rabbitmq-and-postgres-65fcdb593f9b).

---

## 3. Versions Matrix (2026-pinned)

### Backend (services/games, services/wallets)

| Package | Version | Notes |
|---------|---------|-------|
| `@nestjs/core` | `^11.1.21` | |
| `@nestjs/common` | `^11.1.21` | |
| `@nestjs/platform-express` | `^11.1.21` | Express adapter (mature, lower risk than Fastify for Bun) |
| `@nestjs/websockets` | `^11.1.21` | |
| `@nestjs/platform-socket.io` | `^11.1.21` | |
| `@nestjs/microservices` | `^11.1.21` | RabbitMQ transport |
| `@nestjs/config` | `^4.0.x` | |
| `@nestjs/passport` | `^11.x` | Keycloak JWT validation |
| `@nestjs/jwt` | `^11.x` | JWKS verification |
| `passport-jwt` | `^4.0.x` | |
| `jwks-rsa` | `^3.x` | Keycloak public key fetching |
| `@mikro-orm/core` | `^7.1.x` | |
| `@mikro-orm/postgresql` | `^7.1.x` | |
| `@mikro-orm/nestjs` | `^7.x` | |
| `@mikro-orm/migrations` | `^7.1.x` | |
| `@mikro-orm/seeder` | `^7.1.x` | |
| `socket.io` | `^4.8.x` | |
| `amqplib` | `^0.10.x` | Direct AMQP client for outbox publisher |
| `@golevelup/nestjs-rabbitmq` | `^5.x` | Higher-level consumer ergonomics (optional, but cleaner than raw amqplib for inbox handlers) |
| `dinero.js` | `^2.0.x` | **STABLE — March 2026** |
| `zod` | `^3.23.x` | |
| `nestjs-zod` | `^4.x` | |
| `@opentelemetry/api` | `^1.9.x` | |
| `@opentelemetry/sdk-node` | `^0.55.x` | |
| `@opentelemetry/auto-instrumentations-node` | `^0.55.x` | |
| `@opentelemetry/exporter-prometheus` | `^0.55.x` | |
| `@opentelemetry/exporter-trace-otlp-http` | `^0.55.x` | |
| `nestjs-otel` | `^6.x` | NestJS-specific OTel decorators |
| `uuid` | `^10.x` | |
| `pino` | `^9.x` + `nestjs-pino` `^4.x` | Structured logs for OTel/Grafana Loki later |

### Frontend (frontend/)

| Package | Version | Notes |
|---------|---------|-------|
| `@tanstack/react-start` | `^1.x` | Stable |
| `@tanstack/react-router` | `^1.x` | |
| `@tanstack/react-query` | `^5.x` | |
| `react` | `^19.x` | TanStack Start v1 ships on React 19 |
| `react-dom` | `^19.x` | |
| `vite` | `^5.x` | TanStack Start uses Vite |
| `tailwindcss` | `^4.1.x` | v4 |
| `@tailwindcss/vite` | `^4.1.x` | Tailwind v4 Vite plugin |
| `zustand` | `^5.x` | |
| `dinero.js` | `^2.0.x` | Same lib client+server |
| `oidc-spa` | `^latest` | Keycloak PKCE |
| `socket.io-client` | `^4.8.x` | |
| `zod` | `^3.23.x` | |
| `lucide-react` | `^latest` | Default shadcn icon set |
| `sonner` | `^latest` | Toast (shadcn-recommended) |
| `class-variance-authority`, `clsx`, `tailwind-merge` | shadcn deps | |

### Dev

| Package | Version | Notes |
|---------|---------|-------|
| `typescript` | `^5.6.x` | |
| `@types/node` | `^22.x` | |
| `fast-check` | `^3.x` | Property-based tests |
| `@playwright/test` | `^1.49.x` | E2E |
| `prettier` | `^3.x` | |
| `eslint` | `^9.x` (flat config) | |
| `@typescript-eslint/eslint-plugin` | `^8.x` | |

### Infrastructure (docker-compose images)

| Image | Tag | Provided? |
|-------|-----|-----------|
| `postgres` | `18-alpine` | Yes |
| `rabbitmq` | `4.2-management` | Yes |
| `quay.io/keycloak/keycloak` | `26.5` | Yes |
| `kong` | `3.9-alpine` | Yes |
| `prom/prometheus` | `v3.x` | Add for REQ-BONUS-03 |
| `grafana/grafana` | `11.x` | Add for REQ-BONUS-03 |
| `otel/opentelemetry-collector-contrib` | `0.110.x` | Add for OTLP → Prometheus + traces |

---

## 4. Compatibility Risks (monitor list)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bun + NestJS decorators with SWC: circular entity refs in MikroORM | Medium | Use `Relation<EntityName>` wrapper type for back-references in entity files. Document in ADR. |
| Bun's Node.js compat ~95%, edge cases in some npm packages | Low-Medium | Test `bun run docker:up` end-to-end early (Phase 1 smoke). Pin Bun version in `.bun-version`. Fallback: a given package can be loaded under Bun's Node compat — verify each transitive dep on first install. |
| `@nestjs/microservices` RabbitMQ transport limitations (no native exchange/routing-key config flexibility) | Medium | Use `@golevelup/nestjs-rabbitmq` OR drop down to `amqplib` for the outbox publisher and inbox consumers. NestJS microservices module is acceptable for simple RPC but not for our exchange topology. |
| TanStack Start v1: no RSC yet, no Server Components | Low | Doesn't matter for this app — we want client-driven WS + REST + TanStack Query. Server functions cover SSR data loading and auth. |
| Socket.IO 4.8 + Bun: `@socket.io/bun-engine` is newer | Low | Default engine works under Bun's Node compat. Only switch to `bun-engine` if perf becomes an issue (won't, at expected scale). |
| Keycloak 26.5 + oidc-spa: version skew | Low | oidc-spa actively maintained; Keycloak 26.x explicitly supported. Verify on first auth flow in Phase 2. |
| PostgreSQL 18 + MikroORM 7: PG18 is recent | Low | MikroORM uses standard `pg` driver under the hood, which supports PG 18. No PG18-specific features needed (no virtual generated cols in domain). |
| dinero.js v2 stable just released March 2026 | Low | Stable now, but ecosystem (formatters, plugins) may lag. We only need core ops — covered. |
| shadcn CLI v4 TanStack Start template freshness | Low | If template is missing a file, manual install path documented. |

---

## 5. What NOT to use (and why)

| Tech | Why excluded |
|------|--------------|
| **Prisma** | Anemic models. Schema-first generator fights DDD. Direct conflict with 25% scoring weight on DDD. |
| **TypeORM** | Active Record + Data Mapper hybrid leaks framework into entities. Maintenance slowdown. |
| **Drizzle** | Query builder, not ORM with UoW/Identity Map. Would force hand-rolling aggregate persistence. |
| **decimal.js** | No currency concept. Forces hand-rolling Money. Dinero v2 better fit. |
| **currency.js** | Float-based internally. Violates "no float for money" disqualifier. |
| **bigint+scale (raw)** | All upside is reinventing dinero. Net cost over 5 days. |
| **js-money** | Unmaintained. |
| **uWebSockets.js** | Premature optimization. No NestJS-official adapter. Reconnection model differs. |
| **raw `ws`** | Hand-roll rooms, broadcasts, reconnection, ack semantics. Anti-productivity. |
| **Server-Sent Events** | One-way only. Cashout needs client→server. |
| **Jest** | Slower than bun:test by 10-15x. ESM friction. No upside on a greenfield Bun project. |
| **Vitest** | Second test runner, no benefit over bun:test for backend. |
| **Cypress** | Slower than Playwright. Single-browser. Inferior CI story. |
| **class-validator + class-transformer** | Two sources of truth. Decorator metadata fights Bun's SWC transform. Inferior type narrowing. |
| **Next.js** | TanStack Start is the chosen frontend (company preference signal). |
| **Vite + React Router (alone, no Start)** | Loses server functions, SSR, and unified config Start provides. |
| **redux / redux-toolkit** | Overkill. Zustand + TanStack Query covers all state needs without boilerplate. |
| **third-party outbox packages** | Single-maintainer abandonware risk. Hand-rolling scores higher and is ~200 lines. |
| **`@nestjs/microservices` RabbitMQ transport (alone)** | Insufficient flexibility for exchange topology and outbox publisher. Use `amqplib` directly or `@golevelup/nestjs-rabbitmq`. |
| **Joi** | Inferior to Zod for TypeScript inference. |
| **moment.js** | Deprecated by maintainers. Use `date-fns` or native `Intl` if needed (likely not for this challenge). |
| **lodash** | Bundle bloat. Native ES + small utilities cover everything we need. |

---

## Sources (consolidated)

- [Bun blog](https://bun.com/blog) — runtime version notes
- [Bun docs/test](https://bun.com/docs/test)
- [NestJS releases](https://github.com/nestjs/nest/releases)
- [NestJS WebSocket adapter docs](https://docs.nestjs.com/websockets/adapter)
- [@nestjs/platform-socket.io npm](https://www.npmjs.com/package/@nestjs/platform-socket.io)
- [MikroORM v7 blog](https://mikro-orm.io/blog/mikro-orm-7-released)
- [MikroORM NestJS integration](https://mikro-orm.io/docs/usage-with-nestjs)
- [PAS7 Studio: NestJS on Bun guide](https://pas7.com.ua/blog/en/nestjs-bun-performance-2026)
- [Prisma Bun docs](https://www.prisma.io/docs/guides/bun) — for completeness, rejected
- [Dinero.js v2 release post](https://www.sarahdayan.com/blog/dinerojs-v2-is-out)
- [Honeybadger money JS comparison](https://www.honeybadger.io/blog/currency-money-calculations-in-javascript/)
- [TanStack Start v1 blog](https://tanstack.com/blog/announcing-tanstack-start-v1)
- [TanStack Start auth overview](https://tanstack.com/start/latest/docs/framework/react/guide/authentication-overview)
- [oidc-spa TanStack Start adapter](https://docs.oidc-spa.dev/integration-guides/tanstack-router-start/tanstack-start)
- [Othmane Outama: TanStack Start + Keycloak](https://medium.com/@othmane.outama/tanstack-start-authentication-with-oidc-oauth-2-0-keycloak-example-2a2177824d7c)
- [shadcn TanStack Start install](https://ui.shadcn.com/docs/installation/tanstack)
- [shadcn CLI v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)
- [SigNoz: OpenTelemetry NestJS guide](https://signoz.io/blog/opentelemetry-nestjs/)
- [pragmaticivan/nestjs-otel](https://github.com/pragmaticivan/nestjs-otel)
- [Last9 OpenTelemetry NestJS](https://last9.io/blog/opentelemetry-in-nestjs/)
- [RabbitMQ Prometheus + Grafana docs](https://www.rabbitmq.com/docs/prometheus)
- [fast-check Bun tutorial](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-bun-test-runner/)
- [Bustabit verifier (source)](https://bustabit.github.io/verifier/)
- [Bustabit Rust reference impl](https://github.com/vladignatyev/bustabit-rust)
- [createIT: implementing provably fair in crash games](https://medium.com/@createitsc/implementing-provably-fair-in-crash-games-d82d2a31157f)
- [crashgamesplay.com algorithm guide](https://crashgamesplay.com/guides/crash-game-algorithm/)
- [axotion: outbox+inbox in NestJS](https://axotion.medium.com/solving-the-dual-write-problem-with-nestjs-implementing-inbox-and-outbox-patterns-3b20a8bd49a1)
- [Iwanczyszyn: outbox + RabbitMQ + Postgres in NestJS](https://medium.com/@sebastian.iwanczyszyn/implementing-the-outbox-pattern-in-distributed-systems-with-nestjs-rabbitmq-and-postgres-65fcdb593f9b)
- [nestjs-zod npm](https://www.npmjs.com/package/nestjs-zod)
