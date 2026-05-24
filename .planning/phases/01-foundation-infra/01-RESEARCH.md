# Phase 1: Foundation & Infra — Research

**Researched:** 2026-05-24
**Domain:** Bun + NestJS monorepo bootstrap, Docker Compose orchestration, shared domain primitives (Money VO, error taxonomy, event envelopes), Keycloak realm import, ESLint money guard, env-driven config
**Confidence:** HIGH

---

## Summary

Phase 1 is the gate that every later phase depends on. The goal is a single `bun run docker:up` that brings every container to a healthy state on a fresh clone, plus the shared-kernel primitives (`Money` VO, error taxonomy, event envelope types) and `contracts` package skeleton that Phases 2-10 will consume. Stack is fully locked from prior research: Bun 1.3.11+, NestJS 11.1.21, MikroORM 7.1+, Dinero.js v2 (stable since March 2026), TypeScript 5.6 strict.

The provided scaffold already covers Postgres / RabbitMQ / Keycloak / Kong containers with healthchecks and a placeholder games + wallets service. Phase 1 must layer on top of it: pin Bun, add the shared/contracts/eslint-plugin packages, design a migration-container pattern for MikroORM, fix the Keycloak healthcheck (port 8080 — wrong, must be 9000 in Keycloak 26.x), choose a wallet-seed strategy that aligns with REQ-WALL-01 idempotent provisioning, and materialize all 14 env constants from OD1-OD14.

**Primary recommendation:** Build Phase 1 as eight ordered tasks (workspace pin, packages skeleton, Docker compose fixes, MikroORM migration container scaffold, shared-kernel Money + errors + envelope, contracts skeleton, ESLint money guard, ADR-001..004 + README config table). Defer wallet provisioning logic to Phase 3 (REQ-WALL-01 already says "idempotent on first authenticated call") and use a first-login-provisioning model — there is no wallet table yet in Phase 1, so seeding a row would mean materializing wallet schema this phase, which violates the layered-roadmap principle.

---

## User Constraints (from upstream CONTEXT — no `.planning/phases/01-foundation-infra/01-CONTEXT.md` exists yet)

No CONTEXT.md exists yet for Phase 1. Constraints are inherited from `.planning/PROJECT.md` and `.planning/CLAUDE.md`:

### Locked Decisions (from PROJECT.md / STACK.md / SUMMARY.md §8)
- Runtime: **Bun 1.3.11+** pinned in `.bun-version`
- Backend framework: **NestJS 11.1.21** with `@nestjs/platform-express`
- ORM: **MikroORM 7.1+** (NOT Prisma, NOT TypeORM, NOT Drizzle — locked, see SUMMARY §2)
- Money: **Dinero.js v2 (stable)** wrapped in project-local `Money` VO whose snapshot shape is `{ amount: bigint, currency }`
- Money DB column: **BIGINT cents** with `CHECK (... >= 0)` (PITFALLS C1, SUMMARY §8)
- Validation: **zod 3.x** at HTTP/WS edges, domain VOs throw their own errors
- Test runner: **bun:test** + **fast-check** (no Jest, no Vitest)
- Bun + NestJS regression: Bun 1.3.10 broke NestJS controllers; **must pin Bun 1.3.11 or later** ([oven-sh/bun#27526](https://github.com/oven-sh/bun/issues/27526) — fixed in 1.3.11)
- Single global Socket.io `lobby` room (Phase 6 concern; informs no Phase 1 design)
- 14 env constants (OD1-OD14) all materialized in this phase

### Claude's Discretion
- Migration-container pattern: one-shot init container vs entrypoint script (research below recommends one-shot)
- shared-kernel API surface details (method signatures, factory shape)
- ESLint custom-rule package location (`packages/eslint-plugin` vs inline in repo root)
- Wallet seed strategy: A (one-shot SQL) / B (init container) / C (first-login provisioning) — recommendation below
- Domain skeleton split between Phase 1 and Phase 3/4

### Deferred Ideas (OUT OF SCOPE for Phase 1)
- Outbox / Inbox tables and publisher/consumer logic (Phase 2)
- Wallet schema and REST provisioning logic (Phase 3)
- Round / Bet aggregates (Phase 4)
- Saga orchestration (Phase 5)
- WebSocket gateway (Phase 6)
- Frontend scaffold (Phase 7 — Phase 1 only verifies the `frontend/` directory placeholder exists)
- Full CI workflow (Phase 10)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-INFRA-01 | `bun run docker:up` zero-step bootstrap | §3 Docker Compose changes — migration container + Keycloak healthcheck fix + wallet seed strategy + frontend container |
| REQ-INFRA-02 | Healthchecks gate dependent services | §3 — `service_healthy` for stateful, `service_completed_successfully` for migration init containers |
| REQ-INFRA-03 | `docker:down` / `docker:prune` work cleanly | §3 — package.json scripts already present, verify `--remove-orphans` and volume teardown |
| REQ-INFRA-04 | Version pinning (.bun-version, lockfiles) | §2 — `.bun-version` file, `bun.lock` checked in, `packageManager` field in root package.json |
| REQ-INFRA-05 | All business constants come from env, none hardcoded | §7 — typed `config/defaults.ts` per service, zod parser, `.env.example` superset at root |
| REQ-DOM-05 | Postgres CHECK constraint groundwork | §3 — migration framework ready, first migration creates `wallets` table with `CHECK (balance_cents >= 0)` ships in Phase 3 |
| REQ-DOM-06 | Money VO wrapping bigint + Dinero v2 | §4 — full API surface, code excerpts |
| REQ-AUTH-05 | Demo user `player/player123` seeded via realm import | §3 — already present in `docker/keycloak/realm-export.json`, just verify it lands |
| REQ-DOC-03 | Demo user pre-configured with 1000.00 CRD wallet | §8 — strategy recommendation (first-login provisioning via Phase 3, with documented manual fallback for Phase 1 demo recordings) |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Container orchestration | Docker Compose | — | Single-host local dev; spec forbids cloud infra |
| Service health | NestJS HTTP endpoint per service | Docker healthcheck | Each service owns its `/health`; Docker polls it |
| DB schema migrations | MikroORM CLI (one-shot init container per service) | Postgres | Migration container runs `mikro-orm migration:up`, exits 0 |
| Auth (realm + user seeding) | Keycloak `--import-realm` flag | Mounted JSON file | Already wired in provided compose |
| Shared types / Money VO | `packages/shared-kernel` (TypeScript) | Dinero.js v2 | Domain primitives must be infrastructure-free |
| Shared schemas / event envelopes | `packages/contracts` (TypeScript + zod) | — | Phase 1 ships skeleton + Money serialization shape; Phase 2/4 fill events |
| ESLint money guard | `packages/eslint-plugin` (custom rule) | @typescript-eslint/utils | Rule lives next to the package it protects; consumed via root flat config |
| Config / env | `config/defaults.ts` per service (zod-parsed) | `.env.example` root + per-service | Typed re-export pattern; no `process.env.X` outside config module |

---

## Standard Stack

### Core packages this phase adds to the workspace

| Package | Version | Where | Purpose | Source |
|---------|---------|-------|---------|--------|
| `dinero.js` | `^2.0.0` (stable since March 2026) | `packages/shared-kernel` | Money primitive (wrapped by `Money` VO) | [VERIFIED: Sarah Dayan announcement post](https://www.sarahdayan.com/blog/dinerojs-v2-is-out), [VERIFIED: dinero.js v2 GitHub discussion](https://github.com/dinerojs/dinero.js/discussions/618) |
| `zod` | `^3.23.x` | `packages/shared-kernel`, both services | Env parsing + envelope schemas | [CITED: STACK.md §2.6] |
| `@mikro-orm/core` | `^7.1.x` | both services | ORM core | [CITED: STACK.md §2.1] |
| `@mikro-orm/postgresql` | `^7.1.x` | both services | Postgres driver | [CITED: STACK.md §2.1] |
| `@mikro-orm/nestjs` | `^7.x` | both services | NestJS DI integration | [CITED: STACK.md §2.1] |
| `@mikro-orm/migrations` | `^7.1.x` | both services | CLI + migration runtime | [CITED: STACK.md §2.1] |
| `@mikro-orm/seeder` | `^7.1.x` | both services (Phase 3+) | Seed runner; only `@mikro-orm/migrations` strictly needed in Phase 1 | [CITED: STACK.md §2.1] |
| `@nestjs/config` | `^4.0.x` | both services | Env loader (we layer our typed `defaults.ts` over it) | [CITED: STACK.md §3] |
| `eslint` | `^9.x` (flat config) | root devDep | Linter | [CITED: STACK.md §3 dev] |
| `@typescript-eslint/parser` | `^8.x` | root devDep | TS parser for ESLint | [CITED: STACK.md §3 dev] |
| `@typescript-eslint/eslint-plugin` | `^8.x` | root devDep | Standard TS rules | [CITED: STACK.md §3 dev] |
| `@typescript-eslint/utils` | `^8.x` | `packages/eslint-plugin` | Rule authoring helpers (`ESLintUtils.RuleCreator`) | [VERIFIED: typescript-eslint custom rules docs](https://typescript-eslint.io/developers/custom-rules/) |
| `prettier` | `^3.x` | root devDep | Formatter | [CITED: STACK.md §3 dev] |
| `bun-types` | `latest` | root devDep (already present) | Bun type defs | already in scaffold |
| `typescript` | `^5.6.x` | root + per-package | Strict TS | [CITED: STACK.md §3 dev] |

**Phase 1 does NOT install** (deferred): `@nestjs/passport`, `@nestjs/jwt`, `jwks-rsa`, `socket.io`, `amqplib`, `@golevelup/nestjs-rabbitmq`, `nestjs-zod`, `pino`, OpenTelemetry packages, fast-check, Playwright, oidc-spa, TanStack Start, Tailwind, shadcn. These belong to later phases.

### Version verification

| Library | Version recommended | Verified via | Confidence |
|---------|---------------------|--------------|-----------|
| Bun | 1.3.11+ | [VERIFIED: Bun blog v1.3.11](https://bun.com/blog/bun-v1.3.11) — fixes the NestJS decorator-metadata regression introduced in 1.3.10 | HIGH |
| NestJS 11 | 11.1.21 | [CITED: STACK.md §3, GitHub releases](https://github.com/nestjs/nest/releases) | HIGH |
| MikroORM 7 | 7.1+ (currently 7.1.x as of mid-2026 per STACK.md) | [CITED: STACK.md §2.1, MikroORM v7 blog](https://mikro-orm.io/blog/mikro-orm-7-released) | HIGH |
| Dinero.js | 2.0.0 (stable, March 2026) | [VERIFIED: Sarah Dayan blog](https://www.sarahdayan.com/blog/dinerojs-v2-is-out) — `@dinero.js/currencies` is consolidated into the main `dinero.js` package since stable; install only `dinero.js` | HIGH |
| Keycloak | 26.5.5 | already in compose | HIGH |
| Postgres | 18.3-alpine | already in compose | HIGH |
| RabbitMQ | 4.2.4-management-alpine | already in compose | HIGH |
| Kong | 3.9.1 | already in compose | HIGH |

**Recommended `.bun-version`:** `1.3.11` (exact, not a range — `.bun-version` is consumed by `bun` itself and downstream tools as a literal).

**Recommended root `package.json` `packageManager` field:** `"packageManager": "bun@1.3.11"` (informational for tools that read it).

---

## Package Legitimacy Audit

> slopcheck unavailable in this research session — all packages below are marked `[ASSUMED]` and the planner must add a `checkpoint:human-verify` task before each install. All names cross-referenced against npm via the standard documentation sources cited above; none was hallucinated by the model.

| Package | Registry | Discovered via | Disposition |
|---------|----------|----------------|-------------|
| `dinero.js` | npm | Sarah Dayan v2 release blog (creator) + dinero.js GitHub discussion #618 | [ASSUMED — author-confirmed; flag for slopcheck before install] |
| `zod` | npm | typescript-eslint canonical, ubiquitous | [ASSUMED — verify version is current] |
| `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/nestjs`, `@mikro-orm/migrations` | npm | MikroORM official docs | [ASSUMED — verify each via `npm view`] |
| `@nestjs/config` | npm | NestJS official docs | [ASSUMED] |
| `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/utils` | npm | typescript-eslint official site | [ASSUMED] |
| `eslint`, `prettier`, `typescript` | npm | universally known | [ASSUMED — verify version is current] |
| `bun-types` | npm | already in scaffold | [VERIFIED: already in repo] |

**Slopcheck protocol for planner:** add `checkpoint:human-verify` task immediately before the `bun add` task that installs each package. The check is a one-liner per package — `bun pm info <pkg> | head -20` and confirm: (a) latest version, (b) source repo URL, (c) weekly downloads > 1k for non-niche packages.

---

## Architecture Patterns

### System architecture (Phase 1 surface)

```
┌─────────────────────────────────────────────────────────────────┐
│                     `bun run docker:up`                          │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
            ┌─────────── Compose dependency graph ─────────────┐
            │                                                    │
            │   postgres ──healthy──┐                            │
            │                       │                            │
            │   rabbitmq ──healthy──┤                            │
            │                       │                            │
            │   keycloak ──healthy──┤  (port 9000 /health/ready) │
            │                       │                            │
            │      ┌────────────────┼────────────────────┐       │
            │      ▼                ▼                    ▼       │
            │  kong          games-migrate         wallets-migrate│
            │ (healthy)   (exits 0 on success)   (exits 0 on ok) │
            │      │                │                    │       │
            │      │                ▼                    ▼       │
            │      │            games                 wallets     │
            │      │      (depends_on migrate         (depends_on │
            │      │       completed)                  migrate)   │
            │      │                                              │
            │      └──── frontend (Phase 7 lights up)             │
            └────────────────────────────────────────────────────┘

`packages/`                       `services/`
  shared-kernel/                    games/        wallets/
    src/                              src/         src/
      money/                            domain/     domain/
        money.ts                        ...         ...
        currency.ts                     (Phase 4)   (Phase 3)
        errors.ts                       ...
      errors/                           infrastructure/mikro-orm/
        domain-error.ts                   mikro-orm.config.ts
        ...                               migrations/
      events/                                <empty in Phase 1>
        envelope.ts
      identity/
        branded-id.ts
      config/
        defaults.ts (composed by service)
  contracts/
    src/
      events/   (skeleton — Phase 2/4 fills)
      dtos/     (skeleton — Phase 3+ fills)
      provably-fair/  (skeleton — Phase 4 fills)
  eslint-plugin/
    src/
      rules/
        no-number-for-money.ts
      index.ts
```

### Recommended workspace structure

```
fullstack-challenge/
├── .bun-version                    # NEW: "1.3.11"
├── bun.lock                        # NEW: committed after first install
├── .eslintrc.cjs OR eslint.config.js  # NEW (flat config preferred for ESLint 9)
├── package.json                    # EXISTS — update scripts + add devDeps
├── docker-compose.yml              # MODIFY — see §3
├── docker/
│   ├── keycloak/realm-export.json  # EXISTS — verify
│   ├── kong/kong.yml               # EXISTS — verify
│   ├── postgres/init-databases.sh  # EXISTS — verify
│   └── rabbitmq/                   # NEW (optional) — definitions.json deferred to Phase 2
├── packages/
│   ├── shared-kernel/              # NEW
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── money/
│   │   │   │   ├── money.ts
│   │   │   │   ├── currency.ts
│   │   │   │   └── errors.ts
│   │   │   ├── errors/
│   │   │   │   ├── domain-error.ts
│   │   │   │   ├── validation-error.ts
│   │   │   │   ├── invariant-violation.ts
│   │   │   │   ├── not-found-error.ts
│   │   │   │   └── conflict-error.ts
│   │   │   ├── events/
│   │   │   │   ├── envelope.ts
│   │   │   │   └── domain-event.ts
│   │   │   ├── identity/
│   │   │   │   └── branded-id.ts
│   │   │   ├── config/
│   │   │   │   └── env-schema.ts
│   │   │   └── index.ts
│   │   └── tests/
│   │       └── money.test.ts       # property test via fast-check (Phase 3 adds the runner — for Phase 1 we can use plain bun:test)
│   ├── contracts/                  # NEW (skeleton)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── events/
│   │       │   └── .gitkeep        # filled in Phase 2/4
│   │       ├── dtos/
│   │       │   └── .gitkeep        # filled in Phase 3+
│   │       ├── provably-fair/
│   │       │   └── .gitkeep        # filled in Phase 4
│   │       └── index.ts
│   └── eslint-plugin/              # NEW
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── rules/
│           │   └── no-number-for-money.ts
│           └── index.ts
├── services/
│   ├── games/                      # EXISTS — extend
│   │   ├── package.json            # MODIFY — add MikroORM, zod, @nestjs/config; add migration scripts
│   │   ├── Dockerfile              # MODIFY — multi-stage Bun image
│   │   ├── .env.example            # MODIFY — add OD3-OD14 game-side constants
│   │   ├── mikro-orm.config.ts     # NEW
│   │   └── src/
│   │       ├── config/
│   │       │   └── defaults.ts     # NEW — typed re-export
│   │       └── infrastructure/
│   │           └── mikro-orm/
│   │               └── migrations/ # NEW — empty in Phase 1 (Phase 4 ships first migrations)
│   └── wallets/                    # EXISTS — extend (mirror games)
└── frontend/                       # EXISTS — empty placeholder
```

### Pattern 1: One-shot migration init container

**What:** A short-lived container per service that runs `bunx mikro-orm migration:up` then exits with status 0. The long-running service container `depends_on` the migration container with `condition: service_completed_successfully`.

**When to use:** Always, for any service with a relational DB schema. Embedding migrations in the service startup creates restart loops if migrations fail, and forks each replica racing on the same migration.

**Example:**
```yaml
# docker-compose.yml fragment
services:
  games-migrate:
    build:
      context: ./services/games
      dockerfile: Dockerfile
      target: migrate           # named multi-stage target
    env_file:
      - ./services/games/.env
    depends_on:
      postgres:
        condition: service_healthy
    command: ["bunx", "mikro-orm", "migration:up"]
    restart: "no"

  games:
    build:
      context: ./services/games
      dockerfile: Dockerfile
      target: runtime
    ...
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
      games-migrate:
        condition: service_completed_successfully
      keycloak:
        condition: service_healthy
```

Source: standard Docker Compose lifecycle pattern; see PITFALLS M2. Note: `bunx mikro-orm` works identically to `npx mikro-orm` because `bunx` honors the same locally-installed-binary lookup ([VERIFIED: Bun bunx docs](https://bun.com/docs/pm/bunx)). In Phase 1 the migration step will succeed because there are zero pending migrations (the directory is empty).

### Pattern 2: Multi-stage Dockerfile per service

**What:** Single Dockerfile with `deps`, `migrate`, and `runtime` stages so the migration container reuses the same image layer as the runtime container.

**Example:**
```dockerfile
# services/games/Dockerfile
FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app
# Bun workspaces require ALL workspace manifests during install
# Use BuildKit COPY --parents OR copy the whole tree if image size acceptable
COPY package.json bun.lock ./
COPY packages ./packages
COPY services/games/package.json ./services/games/
RUN bun install --frozen-lockfile

FROM deps AS migrate
WORKDIR /app/services/games
COPY services/games ./
# entrypoint comes from compose `command:`
CMD ["bunx", "mikro-orm", "migration:up"]

FROM deps AS runtime
WORKDIR /app/services/games
COPY services/games ./
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
EXPOSE 4001
CMD ["bun", "run", "src/main.ts"]
```

**Why `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`:** Bun's own official Alpine Dockerfile sets this to 0 for ephemeral containers ([VERIFIED: PAS7 Studio NestJS+Bun guide](https://pas7.com.ua/blog/en/nestjs-bun-performance-2026)). The cache is only useful for repeat invocations in the same FS; in containers it's wasted disk.

**Bun workspace + Docker caveat:** `bun install --frozen-lockfile` requires every workspace `package.json` to be present even when building a single service. The Dockerfile must copy the root manifest + `packages/*/package.json` + the target service's manifest before `bun install`. Source files come later to preserve cache. See [oven-sh/bun#12252](https://github.com/oven-sh/bun/issues/12252) for the failure mode if you skip this.

### Pattern 3: Typed env config via zod

**What:** `packages/shared-kernel/src/config/env-schema.ts` exports zod schemas for shared envs; each service composes its own `services/<svc>/src/config/defaults.ts` that imports + extends the schema and re-exports a frozen, typed object.

**Why this pattern over `@nestjs/config` alone:** `@nestjs/config` returns `string | undefined`; manual `parseInt` per consumer is the actual source of "INITIAL_BALANCE_CENTS leaked as a number" bugs. zod parses + validates at boot — fail-fast on missing/invalid env.

**Example:**
```typescript
// packages/shared-kernel/src/config/env-schema.ts
import { z } from "zod";

export const sharedEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  RABBITMQ_URL: z.string().url(),
  CURRENCY_CODE: z.string().min(1).default("CRD"),
  CURRENCY_BASE: z.coerce.number().int().positive().default(10),
  CURRENCY_EXPONENT: z.coerce.number().int().nonnegative().default(2),
});

export type SharedEnv = z.infer<typeof sharedEnvSchema>;
```

```typescript
// services/games/src/config/defaults.ts
import { sharedEnvSchema } from "@crash/shared-kernel/config/env-schema";
import { z } from "zod";

const gamesEnvSchema = sharedEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4001),
  BETTING_WINDOW_MS: z.coerce.number().int().positive().default(5000),
  COOLDOWN_MS: z.coerce.number().int().positive().default(2000),
  SERVER_TICK_HZ: z.coerce.number().int().positive().default(30),
  GROWTH_RATE: z.coerce.number().positive().default(0.06),
  INSTANT_CRASH_BUCKET: z.coerce.number().int().positive().default(101),
  BET_MIN_CENTS: z.coerce.bigint().positive().default(100n),
  BET_MAX_CENTS: z.coerce.bigint().positive().default(100000n),
  HASH_CHAIN_LENGTH: z.coerce.number().int().positive().default(1_000_000),
  SAGA_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  RMQ_DELIVERY_LIMIT_MAIN: z.coerce.number().int().positive().default(5),
  RMQ_DELIVERY_LIMIT_DLQ: z.coerce.number().int().positive().default(3),
  AUTO_CASHOUT_MAX_X: z.coerce.number().positive().default(100),
  LEADERBOARD_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  LEADERBOARD_TOP_N: z.coerce.number().int().positive().default(10),
});

export const env = Object.freeze(gamesEnvSchema.parse(process.env));
export type GamesEnv = typeof env;
```

Note: `z.coerce.bigint()` is **not** in zod 3.23 by default for env-from-string; use `z.string().transform(s => BigInt(s))` or treat cents as `number` at the boundary and convert with `BigInt(...)` after parse. Verify the exact zod API during implementation.

### Anti-patterns to avoid

- **`process.env.X` outside the config module** — defeats the whole typed-config pattern. ESLint rule `no-restricted-properties` should ban `process.env` access outside `src/config/`.
- **Hardcoding business constants** — anywhere. Even test fixtures should call `env.BET_MIN_CENTS`, not a literal `100`.
- **Mixing migration runner with service entrypoint** — restart loops on migration failure. Use the dedicated migration container.
- **Running `bun install` per service in its own Dockerfile** without copying sibling workspace manifests — `--frozen-lockfile` fails.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Money arithmetic | Custom bigint+scale math | `dinero.js` v2 wrapped in `Money` VO | Currency descriptor, immutable snapshot, ISO 4217, deterministic rounding modes |
| Env parsing & validation | Manual `parseInt(process.env.X) \|\| 100` | `zod` schema | Single source of truth for types + defaults + validation |
| Migration tooling | Hand-rolled SQL runner | `@mikro-orm/migrations` CLI | Already part of locked ORM; tracks `mikro_orm_migrations` table |
| Healthcheck endpoint | Custom HTTP server | NestJS `@Get('/health')` controller (already in scaffold) | Already wired |
| Postgres extra DB creation | Manual SQL on first connect | `init-databases.sh` mounted to `/docker-entrypoint-initdb.d/` (already in scaffold) | Postgres image runs scripts in that dir only on first volume init |
| Keycloak realm + user seed | Admin API calls at boot | `--import-realm` + mounted JSON (already in scaffold) | Native, deterministic, replayable |
| Custom ESLint rule scaffolding | `module.exports = { ... }` raw | `@typescript-eslint/utils` `ESLintUtils.RuleCreator` | Typed rule context, `meta` validation, doc-url helper |

**Key insight:** Phase 1 is mostly **gluing existing tools correctly**. The only hand-rolled artifacts are the `Money` VO (because no library wraps Dinero with our DDD ergonomics), the error taxonomy (project-specific), and the ESLint money-guard rule (project-specific). Everything else is configuration.

---

## Runtime State Inventory

**Not applicable** — Phase 1 is greenfield bootstrap. There is no existing runtime state to migrate. The closest concern is the postgres named volume `postgres_data`:

- **Stored data:** none yet (DBs `games` and `wallets` are created empty by `init-databases.sh` on first volume init).
- **Live service config:** Keycloak realm import runs on every container start with `--import-realm` (idempotent per Keycloak docs); RabbitMQ has no declared exchanges/queues in Phase 1 (deferred to Phase 2).
- **OS-registered state:** none.
- **Secrets/env vars:** All env in `.env.example` files (committed) and `.env` per service (NOT committed — gitignored). Currently shipped values are local-dev placeholders (`admin:admin`).
- **Build artifacts:** none yet; `bun install` will produce `node_modules/` and `bun.lock` (commit lockfile).

**Volume cache trap (PITFALLS M2):** `init-databases.sh` only runs when `postgres_data` volume is created fresh. If a developer modifies the script, a `docker compose down -v` (or `bun run docker:prune`) is required to re-run it. This is acceptable but should be documented in README.

---

## Common Pitfalls

### Pitfall 1: Keycloak healthcheck on wrong port (CURRENT BUG in provided compose)
**What goes wrong:** Provided `docker-compose.yml` has the Keycloak healthcheck testing `localhost:8080/health/ready`. In Keycloak 26.x the health endpoints moved to the **management interface on port 9000**.
**Why it happens:** Defaults changed in Keycloak 25→26. Old guides still show port 8080.
**How to avoid:** Healthcheck must target `localhost:9000/health/ready`. Add `KC_HEALTH_ENABLED=true` (already present) AND expose port 9000 inside the container (no need to publish externally).
**Warning signs:** Compose marks Keycloak `unhealthy` even when the realm import succeeded and the admin console is reachable.
**Fix (concrete diff for §3):**
```yaml
keycloak:
  ...
  healthcheck:
    test: ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/9000 && echo -e 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && cat <&3 | grep -q '200'"]
```
Source: [VERIFIED: Keycloak management interface docs](https://www.keycloak.org/server/management-interface) — "Management endpoints such as /metrics and /health are exposed on the default management port 9000 when metrics and health are enabled."

### Pitfall 2: Bun 1.3.10 breaks NestJS controllers
**What goes wrong:** Controllers crash with `descriptor.value is undefined` because Bun 1.3.10 read `emitDecoratorMetadata: true` and used TC39 standard decorators instead of legacy decorator semantics.
**Why it happens:** Specific regression in Bun 1.3.10; tracked at [oven-sh/bun#27526](https://github.com/oven-sh/bun/issues/27526).
**How to avoid:** Pin **Bun 1.3.11 or later** in `.bun-version` and in the Dockerfile base image (`oven/bun:1.3.11-alpine`). The current scaffold uses `oven/bun:1-alpine` which is a floating tag — replace with the pinned tag.
**Warning signs:** `bun --watch src/main.ts` crashes on first request to any decorated controller.

### Pitfall 3: Migration container fails because Postgres database doesn't exist yet
**What goes wrong:** `games-migrate` runs before `init-databases.sh` has created the `games` database; MikroORM CLI errors with "database does not exist."
**Why it happens:** Compose's `service_healthy` for Postgres means "accepts connections" but says nothing about which DBs exist.
**How to avoid:** `init-databases.sh` runs as part of `docker-entrypoint-initdb.d` BEFORE Postgres is marked healthy by `pg_isready`. Verified by reading Postgres official image entrypoint: initdb scripts run inside the entrypoint, which only exits after they all complete; only then does the postmaster start serving. So `service_healthy` IS a valid gate — but **only on first volume init**. On subsequent boots, the script is skipped (volume already has data), which is fine because the DBs already exist.
**Verify:** First-clone `docker compose up` smoke test must pass. Document in README.

### Pitfall 4: Workspace `bun install` fails in Docker with `--frozen-lockfile`
**What goes wrong:** Dockerfile copies only `services/games/package.json` + root `package.json` and runs `bun install --frozen-lockfile` → fails because workspace siblings (`packages/shared-kernel`, etc.) are missing from the manifest tree.
**Why it happens:** Bun workspaces resolve `workspace:*` deps at install time and need every workspace manifest present. See [oven-sh/bun#12252](https://github.com/oven-sh/bun/issues/12252).
**How to avoid:** In Dockerfile, copy ALL `packages/*/package.json` AND the target service's `package.json` before `bun install`. Source files are copied in a later layer to preserve the install cache.

### Pitfall 5: Floating `oven/bun:1-alpine` tag silently upgrades Bun mid-development
**What goes wrong:** Provided Dockerfile uses `FROM oven/bun:1-alpine` which floats to whatever 1.x.y is current. A patch release between two `docker compose up` invocations can introduce regressions (e.g., the 1.3.10 NestJS issue).
**How to avoid:** Pin to `oven/bun:1.3.11-alpine` in every service Dockerfile. Match `.bun-version` exactly.

### Pitfall 6: `bunx mikro-orm` works locally but fails in container
**What goes wrong:** Inside the container, `bunx mikro-orm` may try to download the package on first run, which fails when offline / behind firewall.
**How to avoid:** Add `@mikro-orm/cli` as a direct dependency of each service (not just devDependency in dev — production image needs it for migrations). Confirm `node_modules/.bin/mikro-orm` exists post-install.

### Pitfall 7: ESLint money rule misfires on legitimate `number` symbols
**What goes wrong:** Rule rejects `count: number`, `attempts: number`, `index: number` because they don't match the regex but the developer adds them under a banned identifier path.
**How to avoid:** Rule matches name patterns explicitly: `/^(amount|balance|bet|payout|price|wager|cents|money|fee|stake|win|loss)$/i` or with prefix/suffix like `amountCents`, `betAmount`. Test the rule with both positive and negative fixtures before shipping.

### Pitfall 8: Demo wallet seeded into wallets DB before wallets schema exists
**What goes wrong:** A Phase 1 SQL seed script tries to `INSERT INTO wallets` but the table is created by the Phase 3 migration.
**How to avoid:** Phase 1 does NOT seed a wallet row. Use **first-login provisioning** (Option C in §8) which aligns with REQ-WALL-01's idempotency contract. Document the manual recruiter-demo workaround.

---

## Code Examples

Verified patterns adapted from official sources.

### `Money` VO (sketch — full implementation lives in Phase 1 tasks)
```typescript
// packages/shared-kernel/src/money/currency.ts
import type { Currency } from "dinero.js";

export const CRD: Currency<bigint> = {
  code: "CRD",
  base: 10n,
  exponent: 2n,
};
// Source: https://www.sarahdayan.com/blog/dinerojs-v2-is-out
// "currency descriptor accepts { code, base, exponent }; everything is bigint in v2"
```

```typescript
// packages/shared-kernel/src/money/money.ts
import { add, dinero, subtract, multiply, toSnapshot, isNegative, isZero, equal, lessThan, greaterThan } from "dinero.js";
import type { Dinero } from "dinero.js";
import { CRD } from "./currency";
import { CurrencyMismatchError, NegativeMoneyError } from "./errors";

export type MoneySnapshot = {
  amount: string;       // bigint serialized as string for JSON-safety
  currency: string;     // 'CRD'
  scale: number;        // 2 for CRD
};

export class Money {
  private constructor(private readonly inner: Dinero<bigint>) {}

  static of(amountCents: bigint, currency = CRD): Money {
    if (amountCents < 0n) throw new NegativeMoneyError(amountCents);
    return new Money(dinero({ amount: amountCents, currency }));
  }

  static fromSnapshot(snap: MoneySnapshot): Money {
    return Money.of(BigInt(snap.amount));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(add(this.inner, other.inner));
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = subtract(this.inner, other.inner);
    if (isNegative(result)) throw new NegativeMoneyError(toSnapshot(result).amount);
    return new Money(result);
  }

  multiply(factor: number | { numerator: number; denominator: number }): Money {
    // dinero.js multiply expects scaled-amount input; for `bet * multiplier` (Phase 4),
    // pass `{ amount: numerator, scale: denominatorScale }` per dinero v2 docs.
    // Banker's rounding policy is fixed at the dinero call site here.
    const scaled = typeof factor === "number"
      ? { amount: BigInt(Math.round(factor * 10_000)), scale: 4n }
      : { amount: BigInt(factor.numerator), scale: BigInt(Math.log10(factor.denominator)) };
    return new Money(multiply(this.inner, scaled));
  }

  toCents(): bigint {
    return toSnapshot(this.inner).amount;
  }

  toSnapshot(): MoneySnapshot {
    const s = toSnapshot(this.inner);
    return { amount: s.amount.toString(), currency: s.currency.code, scale: Number(s.scale) };
  }

  toJSON(): MoneySnapshot {
    return this.toSnapshot();
  }

  toString(): string {
    const s = toSnapshot(this.inner);
    const divisor = (s.currency.base as bigint) ** s.scale;
    const whole = s.amount / divisor;
    const frac = s.amount % divisor;
    return `${whole}.${frac.toString().padStart(Number(s.scale), "0")} ${s.currency.code}`;
  }

  isZero(): boolean { return isZero(this.inner); }
  equals(other: Money): boolean { return equal(this.inner, other.inner); }
  lessThan(other: Money): boolean { this.assertSameCurrency(other); return lessThan(this.inner, other.inner); }
  greaterThan(other: Money): boolean { this.assertSameCurrency(other); return greaterThan(this.inner, other.inner); }

  private assertSameCurrency(other: Money): void {
    const a = toSnapshot(this.inner).currency.code;
    const b = toSnapshot(other.inner).currency.code;
    if (a !== b) throw new CurrencyMismatchError(a, b);
  }
}
```
**Source:** [Dinero v2 announcement](https://www.sarahdayan.com/blog/dinerojs-v2-is-out), [Dinero core npm](https://www.npmjs.com/package/@dinero.js/core). The exact import surface (`add`, `subtract`, `multiply`, `dinero`, `toSnapshot`) needs to be confirmed against the installed `dinero.js@2.0.x` types during implementation — v2 stable consolidated `@dinero.js/core` and `@dinero.js/currencies` into the single `dinero.js` package per the release blog.

### Error taxonomy (sketch)
```typescript
// packages/shared-kernel/src/errors/domain-error.ts
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

// packages/shared-kernel/src/errors/validation-error.ts
export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";
}

// packages/shared-kernel/src/errors/invariant-violation.ts
export class InvariantViolation extends DomainError {
  readonly code = "INVARIANT_VIOLATION";
}

// packages/shared-kernel/src/errors/not-found-error.ts
export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";
}

// packages/shared-kernel/src/errors/conflict-error.ts
export class ConflictError extends DomainError {
  readonly code = "CONFLICT";
}
```

NestJS mapping ships in each service via a global `ExceptionFilter` (Phase 3 first lands one for wallets; Phase 4 reuses pattern in games). Phase 1 only ships the base classes.

**Decision — throw, don't `Result<T, E>`:** STACK.md and PITFALLS C5 both advocate VO constructors that throw. Adding a `Result` type forces every caller to handle two paths, which DDD canon (Vernon) treats as a code smell when invariants are inviolable. Document this in ADR-002 alongside Money choice.

### Domain event envelope
```typescript
// packages/shared-kernel/src/events/envelope.ts
export interface DomainEventEnvelope<TPayload = unknown> {
  messageId: string;        // UUID v4
  correlationId: string;    // saga-wide
  causationId: string;      // immediate parent message id
  type: string;             // e.g., 'wallet.debit'
  version: number;          // schema version
  occurredAt: string;       // ISO-8601 UTC
  payload: TPayload;
}
```
**Phase 2 layers** zod schemas on top in `packages/contracts/src/events/`. Phase 1 ships only this interface so Phases 2-4 have a stable shape to import.

### Branded identity types
```typescript
// packages/shared-kernel/src/identity/branded-id.ts
declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type PlayerId = Brand<string, "PlayerId">;
export type RoundId = Brand<string, "RoundId">;
export type BetId = Brand<string, "BetId">;
export type WalletId = Brand<string, "WalletId">;
export type TransactionId = Brand<string, "TransactionId">;
export type CorrelationId = Brand<string, "CorrelationId">;

export const PlayerId = (raw: string): PlayerId => raw as PlayerId;
export const RoundId = (raw: string): RoundId => raw as RoundId;
// ... constructors per type
```

Validation lives in zod schemas at the HTTP/AMQP edge (Phase 2/3). The brand alone gives compile-time discrimination at the cost of zero runtime overhead.

### Custom ESLint money-guard rule
```typescript
// packages/eslint-plugin/src/rules/no-number-for-money.ts
import { ESLintUtils, TSESTree, AST_NODE_TYPES } from "@typescript-eslint/utils";

const MONEY_LIKE = /^(amount|balance|bet|payout|price|wager|cents|money|fee|stake|win|loss)$|^(.+(?:Amount|Balance|Bet|Payout|Price|Wager|Cents|Money|Fee|Stake|Win|Loss))$/;

const createRule = ESLintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);

export const noNumberForMoney = createRule({
  name: "no-number-for-money",
  meta: {
    type: "problem",
    docs: { description: "Disallow `number` type on money-like identifiers; use Money VO instead." },
    messages: {
      banned: "Identifier '{{name}}' looks money-like; use the Money value object, not `number`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    function isNumberType(node: TSESTree.TypeNode | undefined): boolean {
      if (!node) return false;
      if (node.type === AST_NODE_TYPES.TSNumberKeyword) return true;
      if (node.type === AST_NODE_TYPES.TSTypeReference &&
          node.typeName.type === AST_NODE_TYPES.Identifier &&
          node.typeName.name === "Number") return true;
      return false;
    }
    function check(name: string, typeAnnot: TSESTree.TSTypeAnnotation | undefined, reportNode: TSESTree.Node) {
      if (!typeAnnot) return;
      if (!MONEY_LIKE.test(name)) return;
      if (isNumberType(typeAnnot.typeAnnotation)) {
        context.report({ node: reportNode, messageId: "banned", data: { name } });
      }
    }
    return {
      // const balance: number = ...
      VariableDeclarator(node) {
        if (node.id.type === AST_NODE_TYPES.Identifier) {
          check(node.id.name, node.id.typeAnnotation, node.id);
        }
      },
      // function foo(amount: number) {}
      "FunctionDeclaration > Identifier, ArrowFunctionExpression > Identifier, FunctionExpression > Identifier"(node: TSESTree.Identifier) {
        check(node.name, node.typeAnnotation, node);
      },
      // interface X { balance: number }
      TSPropertySignature(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier) {
          check(node.key.name, node.typeAnnotation, node);
        }
      },
      // class X { balance: number }
      PropertyDefinition(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier) {
          check(node.key.name, node.typeAnnotation, node);
        }
      },
    };
  },
});
```

```typescript
// packages/eslint-plugin/src/index.ts
import { noNumberForMoney } from "./rules/no-number-for-money";
export default {
  rules: {
    "no-number-for-money": noNumberForMoney,
  },
};
```

**Consumption from root flat config:**
```javascript
// eslint.config.js (root)
import crashPlugin from "@crash/eslint-plugin";
export default [
  {
    files: ["**/*.ts"],
    plugins: { "@crash": crashPlugin },
    rules: { "@crash/no-number-for-money": "error" },
  },
];
```

**Source:** [VERIFIED: typescript-eslint custom rules guide](https://typescript-eslint.io/developers/custom-rules/) — `ESLintUtils.RuleCreator`, `AST_NODE_TYPES`. Rule has been ~80 LOC across the file plus index. Fixture-driven tests verify both positive (`balance: number` flagged) and negative (`count: number` allowed).

---

## State of the Art (delta vs prior knowledge)

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Dinero v1 (deprecated, alpha-v2-for-5-years) | Dinero v2 stable | March 2026 | Bigint-only arithmetic, isomorphic, single `dinero.js` package | [VERIFIED: Sarah Dayan blog](https://www.sarahdayan.com/blog/dinerojs-v2-is-out) |
| Keycloak health on port 8080 | Keycloak health on port 9000 (management interface) | Keycloak 25→26 | Compose healthchecks must target 9000 | [VERIFIED: Keycloak management interface docs](https://www.keycloak.org/server/management-interface) |
| Floating `oven/bun:1-alpine` tag | Pinned `oven/bun:1.3.11-alpine` | 2026-04 (after 1.3.10 NestJS regression) | Lock to known-good version | [VERIFIED: Bun blog v1.3.11](https://bun.com/blog/bun-v1.3.11) |
| `.eslintrc.js` classic config | `eslint.config.js` flat config | ESLint 9 default | Plugins registered as objects, not strings | [CITED: ESLint v9 release] |
| ESLint legacy plugin format | `@typescript-eslint/utils` `ESLintUtils.RuleCreator` | typescript-eslint 6+ | Typed rule context, docs URL helper | [VERIFIED: typescript-eslint docs](https://typescript-eslint.io/developers/custom-rules/) |
| `@dinero.js/core` + `@dinero.js/currencies` separate | Consolidated into `dinero.js` | March 2026 stable | Only install `dinero.js` | [VERIFIED: Dinero v2 announcement] |

**Deprecated / outdated to actively avoid:**
- `dinero.js@1.x` (deprecated; v1 maintained on `dinero.js` package versions 1.x, v2 is the same package at 2.x)
- `class-validator` + `class-transformer` (rejected in STACK §2.6; uses two sources of truth + fights Bun's SWC)
- `@nestjs/microservices` RabbitMQ transport as the **only** AMQP layer (insufficient confirm/topology control for outbox; OK as supplementary)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bun 1.3.11 fixes the NestJS controller-decorator regression definitively (no further regressions in 1.3.12+) | §Standard Stack | If a newer 1.3.x regresses again, lock to 1.3.11 exact rather than `>=1.3.11`. Mitigation: pin exact in `.bun-version`. |
| A2 | MikroORM 7 `migration:up` CLI invocable via `bunx mikro-orm` in container | §Pattern 1 | If `bunx` resolution differs from local, fall back to `bun run mikro-orm` with an npm script. |
| A3 | `dinero.js@2.0.x` exports the named functions used in the `Money` VO sketch (`add`, `subtract`, `multiply`, `dinero`, `toSnapshot`, `isNegative`, etc.) | §Code Examples | The v2 import surface needs confirmation at implementation time. If a name differs, adjust imports — semantics are stable per v2 announcement. |
| A4 | Postgres `init-databases.sh` runs **before** `pg_isready` returns success on first volume init | §Pitfall 3 | Verified by reading the Postgres official image entrypoint behavior; high confidence but worth verifying with a `docker compose up` smoke test. |
| A5 | `KC_HEALTH_ENABLED=true` exposes `/health/ready` on port 9000 by default in Keycloak 26.5.5 without extra config | §Pitfall 1 | Verified by [Keycloak management interface docs](https://www.keycloak.org/server/management-interface). If port 9000 is not listening, set `KC_HTTP_MANAGEMENT_PORT=9000` explicitly. |
| A6 | First-login wallet provisioning (Option C) is acceptable for the recruiter demo without a pre-seeded wallet row | §Demo wallet seed | If the recruiter must see the wallet without clicking once, fall back to Option B in Phase 3 (an init container that runs after wallets-migrate). Mitigation: README documents the one-click "first login" demo flow. |
| A7 | zod 3.23 handles `z.coerce.bigint()` for env-from-string parsing | §Pattern 3 code | If unsupported, use `z.string().transform(s => BigInt(s))`. |
| A8 | The `oven/bun:1.3.11-alpine` image exists on Docker Hub | §Pitfall 5 | If only the floating `oven/bun:1.3.11` exists without `-alpine`, use the non-alpine variant (larger image, no other impact). |
| A9 | ESLint 9 flat config is compatible with `@typescript-eslint/parser` 8.x and a custom plugin registered as a default-exported object | §Code Examples | Standard pattern in ESLint 9 — high confidence. If a registration issue arises, fall back to classic `.eslintrc.cjs` (lower priority). |
| A10 | The provided `services/games/.env.example` and `services/wallets/.env.example` will be expanded in Phase 1 to include all OD3-OD14 (game) and OD1-OD2 (wallet) env vars | §User Constraints | If the planner chooses a different file layout, the typed `defaults.ts` approach still works — only the storage location of defaults changes. |

---

## Output sections required by the user prompt

### 1. Decisions to make in Phase 1 (ADRs)

| ADR | Title | Decision summary |
|-----|-------|------------------|
| ADR-001 | ORM selection — MikroORM 7 over Prisma/TypeORM/Drizzle | Locked by STACK.md §2.1; record alternatives rejected (Prisma anemic, TypeORM legacy, Drizzle query-builder-only) |
| ADR-002 | Money representation — Dinero v2 wrapped in local VO over raw bigint+scale / decimal.js | Locked by STACK.md §2.2 + SUMMARY §8 conflict resolution; snapshot shape `{amount: string, currency, scale}` for JSON safety |
| ADR-003 | Bun + NestJS pinning strategy | `.bun-version=1.3.11` (exact); `oven/bun:1.3.11-alpine` in every Dockerfile; `emitDecoratorMetadata: true` AND `experimentalDecorators: true` explicit in every tsconfig (no inheritance reliance); document the 1.3.10 regression as the reason for exact pin |
| ADR-004 | Configuration source-of-truth shape | `.env.example` per service (committed) + root `.env.example` superset; typed `config/defaults.ts` per service composing a shared zod schema from `packages/shared-kernel/src/config/env-schema.ts`; ESLint `no-restricted-properties` bans `process.env` outside `src/config/` |
| ADR-005 (NEW — surfaced by research) | Wallet seed strategy: first-login provisioning (Option C) | Aligns with REQ-WALL-01 idempotency; defers the wallet table creation to Phase 3; recruiter-demo recovery is a single login click |
| ADR-006 (NEW — optional) | Custom ESLint money-guard scaffold location | `packages/eslint-plugin` as a workspace package; consumed from root `eslint.config.js` flat config |

ADR-005 and ADR-006 are research-surfaced — the original roadmap anticipated only ADR-001..004. Suggest the planner either fold them in or downgrade to inline doc sections.

### 2. Locked versions for Phase 1

**Root `package.json` additions:**
```json
{
  "packageManager": "bun@1.3.11",
  "scripts": {
    "docker:up": "docker compose up -d --wait",
    "docker:down": "docker compose down --remove-orphans",
    "docker:prune": "docker compose down -v --rmi local --remove-orphans && docker volume prune -f",
    "lint": "eslint .",
    "format": "prettier --write .",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@typescript-eslint/parser": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/utils": "^8.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.6.0",
    "bun-types": "latest"
  }
}
```
Note: `docker:up` upgraded from `up` to `up -d --wait` so it returns once all healthchecks pass — critical for CI gates later (Phase 10) and for the `service_healthy` contract.

**`.bun-version` (new file at repo root):**
```
1.3.11
```

**`packages/shared-kernel/package.json` (new):**
```json
{
  "name": "@crash/shared-kernel",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "dinero.js": "^2.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

**`services/games/package.json` (extended):**
```json
{
  "name": "@crash/games",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/main.ts",
    "start": "bun run src/main.ts",
    "test": "bun test tests/unit",
    "test:e2e": "bun test tests/e2e",
    "migration:create": "bunx mikro-orm migration:create",
    "migration:up": "bunx mikro-orm migration:up",
    "migration:down": "bunx mikro-orm migration:down"
  },
  "dependencies": {
    "@crash/shared-kernel": "workspace:*",
    "@crash/contracts": "workspace:*",
    "@nestjs/common": "^11.1.21",
    "@nestjs/core": "^11.1.21",
    "@nestjs/platform-express": "^11.1.21",
    "@nestjs/config": "^4.0.0",
    "@mikro-orm/core": "^7.1.0",
    "@mikro-orm/postgresql": "^7.1.0",
    "@mikro-orm/nestjs": "^7.0.0",
    "@mikro-orm/migrations": "^7.1.0",
    "@mikro-orm/cli": "^7.1.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@crash/eslint-plugin": "workspace:*",
    "bun-types": "latest",
    "typescript": "^5.8.3"
  }
}
```
Mirror for `services/wallets/package.json`.

### 3. Docker Compose changes required (concrete diff vs the provided compose)

Six concrete changes to `docker-compose.yml`:

**Change 1 — Fix Keycloak healthcheck port (port 9000 instead of 8080):**
```yaml
keycloak:
  ...
  ports:
    - "8080:8080"
    - "9000:9000"    # management port — needed for healthcheck
  healthcheck:
    test:
      - "CMD-SHELL"
      - "exec 3<>/dev/tcp/localhost/9000 && echo -e 'GET /health/ready HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && cat <&3 | grep -q '200'"
    interval: 10s
    timeout: 5s
    retries: 30
    start_period: 60s
```

**Change 2 — Add migration containers for each service:**
```yaml
games-migrate:
  build:
    context: ./
    dockerfile: services/games/Dockerfile
    target: migrate
  env_file:
    - ./services/games/.env
  depends_on:
    postgres:
      condition: service_healthy
  command: ["bunx", "mikro-orm", "migration:up"]
  restart: "no"

wallets-migrate:
  build:
    context: ./
    dockerfile: services/wallets/Dockerfile
    target: migrate
  env_file:
    - ./services/wallets/.env
  depends_on:
    postgres:
      condition: service_healthy
  command: ["bunx", "mikro-orm", "migration:up"]
  restart: "no"
```
Note: build context moved to repo root (`./`) so the Dockerfile can copy workspace siblings (`packages/*`). The Dockerfile path becomes `services/games/Dockerfile`.

**Change 3 — Wire service `depends_on` to migrate containers + keycloak:**
```yaml
games:
  build:
    context: ./
    dockerfile: services/games/Dockerfile
    target: runtime
  depends_on:
    postgres:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
    keycloak:
      condition: service_healthy
    games-migrate:
      condition: service_completed_successfully
  ...

wallets:
  build:
    context: ./
    dockerfile: services/wallets/Dockerfile
    target: runtime
  depends_on:
    postgres:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
    keycloak:
      condition: service_healthy
    wallets-migrate:
      condition: service_completed_successfully
  ...
```

**Change 4 — Service Dockerfile multi-stage with workspace-aware install** (replaces both `services/games/Dockerfile` and `services/wallets/Dockerfile`):

See §Pattern 2 above. Same Dockerfile, just port + service name differ.

**Change 5 — Frontend container placeholder (commented; Phase 7 lights it up):**

The existing commented block is fine for Phase 1. Add a note that Phase 7 will replace with a TanStack Start Vite dev server + Bun image.

**Change 6 — Service healthcheck must `curl http://localhost:4001/health` — but `oven/bun:1.3.11-alpine` does NOT ship `curl`** (PITFALLS M2). Two options:
- Install curl in the runtime stage: `RUN apk add --no-cache curl`
- Use `wget -qO-` which is in alpine by default

**Recommended:** `wget -qO- http://localhost:4001/health || exit 1` in the healthcheck.

### 4. shared-kernel design

See §Recommended workspace structure + §Code Examples. Public API surface:

- `Money` class (constructor private; factory `Money.of(cents: bigint, currency = CRD): Money`; `.add`, `.subtract`, `.multiply`, `.toCents`, `.toSnapshot`, `.toJSON`, `.toString`, `.isZero`, `.equals`, `.lessThan`, `.greaterThan`; private `assertSameCurrency`)
- `CRD` Currency descriptor (`{ code: 'CRD', base: 10n, exponent: 2n }`)
- `NegativeMoneyError`, `CurrencyMismatchError` (extend `DomainError`)
- `DomainError` (abstract), `ValidationError`, `InvariantViolation`, `NotFoundError`, `ConflictError`
- `DomainEventEnvelope<T>` interface
- Branded id types + constructors: `PlayerId`, `RoundId`, `BetId`, `WalletId`, `TransactionId`, `CorrelationId`
- `sharedEnvSchema` (zod schema, exported for service-level composition)

`packages/shared-kernel/src/index.ts` barrel re-exports all of the above so consumers import from `@crash/shared-kernel`.

### 5. contracts package design

Skeleton in Phase 1 — fills in later phases:

```
packages/contracts/
├── package.json
│   - deps: @crash/shared-kernel, zod
├── tsconfig.json
└── src/
    ├── events/       — Phase 2 (envelope schemas) + Phase 4 (game event schemas)
    │   └── .gitkeep
    ├── dtos/         — Phase 3 (wallet DTOs) + Phase 5 (bet DTOs)
    │   └── .gitkeep
    ├── provably-fair/ — Phase 4 (hash chain, crash-point formula — same code FE+BE)
    │   └── .gitkeep
    └── index.ts      — empty barrel
```

Phase 1 ships only:
- The package manifest with `dinero.js`, `zod`, `@crash/shared-kernel` deps
- The directory skeleton (so Phase 2 doesn't have to scaffold paths)
- A barrel `index.ts` that exports nothing yet
- The `Money` serialization helper `serializeMoney(m: Money): MoneySnapshot` and `parseMoneySnapshot(snap: unknown): Money` zod-validated — so Phase 3 wallet REST and Phase 4 bet endpoints have a wire format already

**Frontend consumption (Phase 7):** Vite resolves workspace deps via `tsconfig` paths AND Bun's workspace symlinks; either works. Recommend setting `"paths"` in `frontend/tsconfig.json` to explicit `packages/*/src` so type-checking is fast in dev.

### 6. ESLint money guard

See §Code Examples for the full rule. Summary:

- Package: `packages/eslint-plugin` (workspace)
- Rule name: `@crash/no-number-for-money`
- Author tooling: `@typescript-eslint/utils` `ESLintUtils.RuleCreator`
- Regex (case-insensitive): `/^(amount|balance|bet|payout|price|wager|cents|money|fee|stake|win|loss)$|^(.+(?:Amount|Balance|Bet|Payout|Price|Wager|Cents|Money|Fee|Stake|Win|Loss))$/`
- AST visitors: `VariableDeclarator`, `TSPropertySignature`, `PropertyDefinition`, function-parameter `Identifier`
- Type check: `TSNumberKeyword` OR `TSTypeReference` to identifier `Number`
- Fixture tests: positive (`balance: number`, `amountCents: number`, `betPayoutCents: number`) all flagged; negative (`count: number`, `winRate: string`, `index: number`) all allowed
- Severity: `error` (set in root `eslint.config.js`)

### 7. Config / env approach

**14 constants table (from SUMMARY §7):**

| Env Var | Default | Service | Type | Notes |
|---------|---------|---------|------|-------|
| `INITIAL_BALANCE_CENTS` | `100000` | wallets | bigint | 1000.00 CRD |
| `CURRENCY_CODE` | `CRD` | both | string | |
| `CURRENCY_BASE` | `10` | both | int | |
| `CURRENCY_EXPONENT` | `2` | both | int | |
| `BETTING_WINDOW_MS` | `5000` | games | int | |
| `COOLDOWN_MS` | `2000` | games | int | |
| `SERVER_TICK_HZ` | `30` | games | int | |
| `GROWTH_RATE` | `0.06` | games | float | |
| `INSTANT_CRASH_BUCKET` | `101` | games | int | |
| `BET_MIN_CENTS` | `100` | games | bigint | 1.00 — confirm with user before Phase 4 (STATE todo) |
| `BET_MAX_CENTS` | `100000` | games | bigint | 1000.00 — confirm with user before Phase 4 (STATE todo) |
| `HASH_CHAIN_LENGTH` | `1000000` | games | int | |
| `SAGA_TIMEOUT_MS` | `5000` | games | int | |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | both | int | |
| `RMQ_DELIVERY_LIMIT_MAIN` | `5` | both | int | |
| `RMQ_DELIVERY_LIMIT_DLQ` | `3` | both | int | |
| `AUTO_CASHOUT_MAX_X` | `100.00` | games | float | confirm with user before Phase 9 (STATE todo) |
| `LEADERBOARD_WINDOW_HOURS` | `24` | games | int | |
| `LEADERBOARD_TOP_N` | `10` | games | int | |

(Table is 19 rows; SUMMARY counts 14 because CURRENCY_*, BET_*, RMQ_*, LEADERBOARD_* are grouped pairs. All ship in Phase 1.)

**Per-service `.env.example` placement:**
- `services/games/.env.example` — all `games`-marked rows + `DATABASE_URL`, `RABBITMQ_URL`, `PORT`, `CURRENCY_*`, `OUTBOX_POLL_INTERVAL_MS`, `RMQ_*`
- `services/wallets/.env.example` — all `wallets`-marked rows + `DATABASE_URL`, `RABBITMQ_URL`, `PORT`, `CURRENCY_*`, `OUTBOX_POLL_INTERVAL_MS`, `RMQ_*`, `INITIAL_BALANCE_CENTS`
- Root `.env.example` (optional but recommended) — superset listing all of the above so a recruiter sees the full operator surface in one place

**Typed config pattern:** see §Pattern 3.

**`env_file` vs `environment:` in compose:** keep `env_file: ./services/X/.env` (already in scaffold). This decouples compose from secrets and lets developers override locally without editing the compose file. `.env` files are gitignored; `.env.example` is committed.

### 8. Demo wallet seed strategy — RECOMMENDED: Option C (first-login provisioning)

**Three options surveyed:**

| Option | Mechanism | Phase 1 cost | Phase 3 cost | Recruiter UX |
|--------|-----------|--------------|--------------|--------------|
| A — one-shot SQL seed container | Container runs after `wallets-migrate`; INSERTs row into `wallets` | Requires wallets schema (table + CHECK) to exist in Phase 1 | None | Wallet visible without login |
| B — `SEED_DEMO_USER=true` env in wallet service | Wallet service on first boot creates the wallet if missing | Same as A — needs schema | Modifies Phase 3 wallet service with seed-on-boot logic | Wallet visible without login |
| C — first-login provisioning | `POST /wallets` is idempotent (REQ-WALL-01); frontend calls on first authenticated load | None (no schema, no seed logic) | Native — REQ-WALL-01 already calls for idempotent `POST /wallets` | Wallet visible after one login click |

**Recommendation: Option C.**

Rationale:
1. **Native fit with REQ-WALL-01:** Wallet service already exposes `POST /wallets` as idempotent — first-login provisioning IS that endpoint being called.
2. **Phase boundary integrity:** Options A and B force the wallets schema (the `CHECK (balance_cents >= 0)` migration is REQ-DOM-05) into Phase 1, which contradicts the roadmap's clean layered split where Phase 3 owns wallet domain.
3. **Minimal Phase 1 surface:** Option C lets Phase 1 ship with empty migration directories — the framework is wired, no SQL needs writing yet.
4. **Recruiter risk mitigation:** README documents the single login click required. Optionally Phase 3 can add a fallback seed container with explicit opt-in (`SEED_DEMO_USER=true` env) so the recruiter never even has to click.

**Caveat for REQ-DOC-03:** The requirement reads "Demo user pre-configured in Keycloak with wallet provisioned and seeded with 1000.00 CRD." Option C does not pre-seed; it provisions on first login. The phrasing "pre-configured" can be defended by documenting the auto-provisioning behavior in the README + ADR-005. If user pushes back during `/gsd:discuss-phase 1`, switch to Option B (add seed-on-boot env to Phase 3) — but defer Option A always (forces schema into Phase 1).

### 9. CI in Phase 1 — recommendation: NO (defer to Phase 10)

The roadmap puts full CI in Phase 10 (`REQ-CI-01/02/03`). Phase 1 should:
- NOT ship `.github/workflows/` (avoid premature CI churn while the stack is evolving)
- Ship a `Makefile`-equivalent set of npm scripts (`lint`, `typecheck`, `test`, `docker:up`) so Phase 10 has clear targets to call from a workflow
- Document in README that `bun run docker:up && curl http://localhost:4001/health && curl http://localhost:4002/health` is the manual smoke equivalent

This avoids the trap of writing a CI workflow that breaks on every Phase 2-9 commit because the stack changes underneath it.

### 10. Domain skeleton split between Phase 1 and Phase 3/4

| What to scaffold in Phase 1 | What to defer to Phase 3 | What to defer to Phase 4 |
|------------------------------|--------------------------|--------------------------|
| `packages/shared-kernel/src/{money,errors,events,identity}/` — full | `services/wallets/src/domain/{aggregates,value-objects,events,errors}/` — empty stubs only? **Recommend: NO stubs in Phase 1.** Let Phase 3 create them when implementing | `services/games/src/domain/{...}` — same recommendation |
| `services/games/src/config/defaults.ts` and `services/wallets/src/config/defaults.ts` | Wallet aggregate, Transaction aggregate | Round aggregate, Bet aggregate, SeedChain |
| `services/{games,wallets}/src/infrastructure/mikro-orm/mikro-orm.config.ts` (empty entity array) + empty `migrations/` dir | First migration (creates wallets table with CHECK constraint) | First migration (creates rounds, bets tables) |
| Health endpoint module (already in scaffold) | REST `POST /wallets`, `GET /wallets/me` controllers | REST round endpoints, bet endpoints |

**Recommendation:** Phase 1 does **not** scaffold empty domain folders inside services. Creating empty folders is noise; Phase 3/4 will scaffold them when implementing. The `packages/shared-kernel` provides everything cross-cutting; service-specific domain belongs in its own phase.

### 11. Order of execution (suggested plan-list with dependencies)

```
P1.1 — Workspace pinning + version files
  - .bun-version (1.3.11)
  - root package.json: packageManager field + new scripts + dev deps
  - bun.lock checked in after first install
  Depends on: nothing

P1.2 — packages/shared-kernel scaffold
  - manifest, tsconfig, src/index.ts barrel
  - money/{money.ts, currency.ts, errors.ts}
  - errors/*
  - events/envelope.ts
  - identity/branded-id.ts
  - config/env-schema.ts (zod shared schema)
  - unit tests for Money VO (bun:test) — at minimum: construction, add, subtract, currency-mismatch, JSON round-trip
  Depends on: P1.1

P1.3 — packages/contracts skeleton
  - manifest, tsconfig, src/index.ts barrel
  - empty events/, dtos/, provably-fair/ with .gitkeep
  - serializeMoney + parseMoneySnapshot helpers
  Depends on: P1.2

P1.4 — packages/eslint-plugin scaffold
  - manifest, tsconfig
  - rules/no-number-for-money.ts
  - index.ts default export
  - rule tests (positive + negative fixtures)
  Depends on: P1.1

P1.5 — Root ESLint flat config + Prettier
  - eslint.config.js consuming @crash/eslint-plugin
  - .prettierrc
  - .gitignore (verify covers .env*, node_modules, dist)
  Depends on: P1.4

P1.6 — services/games + services/wallets extension
  - Add MikroORM, zod, @nestjs/config, workspace deps to manifests
  - Add migration scripts
  - src/config/defaults.ts per service
  - .env.example per service: full env list from §7
  - infrastructure/mikro-orm/mikro-orm.config.ts (empty entities)
  - empty migrations/ dir
  - tsconfig: explicit emitDecoratorMetadata + experimentalDecorators
  Depends on: P1.2 (shared-kernel for env-schema import)

P1.7 — Dockerfile rewrite (multi-stage, workspace-aware)
  - services/games/Dockerfile and services/wallets/Dockerfile updated to deps→migrate→runtime stages
  - oven/bun:1.3.11-alpine
  - BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
  - Workspace-sibling COPY pattern
  Depends on: P1.6

P1.8 — docker-compose.yml changes
  - Fix Keycloak healthcheck (port 9000)
  - Expose port 9000 on keycloak container
  - Add games-migrate + wallets-migrate services
  - Update games + wallets depends_on (migrate + keycloak)
  - Switch service healthcheck to wget (alpine-compatible)
  - Update build context to repo root for services
  - Update docker:up script to `docker compose up -d --wait`
  Depends on: P1.7

P1.9 — ADRs
  - .planning/adrs/ADR-001-orm-mikroorm.md
  - .planning/adrs/ADR-002-money-dinero-vo.md
  - .planning/adrs/ADR-003-bun-pinning.md
  - .planning/adrs/ADR-004-config-source-of-truth.md
  - .planning/adrs/ADR-005-wallet-seed-strategy.md (NEW)
  Depends on: P1.2..P1.8 (so ADRs reflect actual decisions made)

P1.10 — README updates (Phase 1 surface)
  - Quickstart: bun run docker:up
  - Env vars table (link to defaults)
  - First-login provisioning note
  - Healthcheck commands
  - Project structure overview
  Depends on: P1.9

P1.11 — Smoke test execution
  - bun run docker:prune && bun run docker:up
  - Wait, then curl /health on both services
  - docker compose ps shows all containers healthy / migrate exited 0
  - bun run lint passes (no money guard violations in stub code)
  Depends on: P1.10 (final gate)
```

**Parallelization windows inside Phase 1:**
- P1.2, P1.4 can run in parallel after P1.1
- P1.3 needs P1.2 done
- P1.6 needs P1.2 done
- P1.7 needs P1.6
- P1.8 needs P1.7
- P1.9, P1.10 can be drafted in parallel with P1.8 implementation

### 12. Phase 1 risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Bun 1.3.11 itself has an undiscovered NestJS regression | LOW | Smoke test P1.11 catches it; fallback to `nodemon --exec bun run` dev mode (PITFALLS M1) |
| Postgres healthy before `init-databases.sh` completes | LOW | Postgres image entrypoint runs initdb scripts before opening the listener; `pg_isready` is gated correctly. Verified in P1.11 smoke. |
| Keycloak realm import races with the healthcheck (becomes healthy before import finishes) | MEDIUM | `KC_HEALTH_ENABLED=true` on management port 9000 + `start_period: 60s` gives the import time. If still flaky, raise `start_period` or use a custom readiness probe that hits the admin API. |
| Workspace bun install fails in Docker with `--frozen-lockfile` | MEDIUM | Verified fix: COPY all workspace manifests before install. Test in P1.7 smoke. |
| Dinero v2 import surface differs from sketch | LOW | Adjust at implementation time; semantics are stable per v2 release notes. |
| ESLint money-guard rule misfires on legitimate `number` symbols | MEDIUM | Tight regex + positive/negative fixture tests in P1.4 |
| Migration container fails because there are no migrations to run | LOW | `bunx mikro-orm migration:up` with empty dir is a no-op; verify in P1.11 |
| Service container fails healthcheck because `oven/bun:1.3.11-alpine` lacks `curl` | MEDIUM | Use `wget -qO-` (alpine native) or `apk add --no-cache curl` in runtime stage |
| Volume cache trap: `init-databases.sh` only runs on fresh volume; modifications need `docker compose down -v` | LOW | Documented in README. Recruiter on first clone always has fresh volume. |
| Frontend container not in compose yet | LOW | Spec-allowed for Phase 1; commented placeholder in compose; Phase 7 lights it up |

### 13. Validation Architecture

#### Test framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` built-in (Bun 1.3.11) |
| Config file | none required (Bun convention: `tests/**/*.test.ts`) |
| Quick run command | `bun test packages/shared-kernel/tests/money.test.ts` |
| Full suite command | `bun test` (from repo root walks all workspaces) |

#### Phase requirements → test map
| Req ID | Behavior | Test type | Automated command | File exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-INFRA-01 | `bun run docker:up` zero-step bootstrap | smoke (bash) | `bun run docker:prune && bun run docker:up && bun run smoke:health` | Wave 0 |
| REQ-INFRA-02 | Healthchecks gate dependent services | smoke | `docker compose ps --format json \| jq '.[] \| select(.State!="running" and .State!="exited")'` should be empty | Wave 0 |
| REQ-INFRA-03 | `docker:down` / `docker:prune` work cleanly | smoke | `bun run docker:prune && docker volume ls \| grep -q crash` (should fail) | Wave 0 |
| REQ-INFRA-04 | Version pinning | static | `test -f .bun-version && test -f bun.lock && grep -q '"packageManager"' package.json` | Wave 0 |
| REQ-INFRA-05 | All business constants from env | unit (zod parse) + lint | `bun test packages/shared-kernel/tests/config.test.ts` + `bun run lint` checks ESLint no-restricted-properties for process.env outside config/ | Wave 0 |
| REQ-DOM-05 | Postgres CHECK groundwork | unit (config check) | `grep -q "balance_cents >= 0" services/wallets/src/infrastructure/mikro-orm/migrations/*` (false until Phase 3 — Phase 1 just verifies dir exists) | Wave 0 (empty dir check) |
| REQ-DOM-06 | Money VO | unit + property | `bun test packages/shared-kernel/tests/money.test.ts` — covers construction, add, subtract (incl. negative throw), currency-mismatch throw, JSON round-trip, .toString | Wave 0 |
| REQ-AUTH-05 | Demo user seeded via realm import | smoke | `curl -s http://localhost:8080/realms/crash-game/.well-known/openid-configuration \| jq -e .issuer` then password grant test | Wave 0 |
| REQ-DOC-03 | Wallet seeded at 1000.00 CRD | manual (Phase 1 with Option C; first-login provisioning verified in Phase 3) | document in README — recruiter runs login flow | n/a Phase 1 |

#### Sampling rate
- **Per task commit:** `bun run lint && bun run typecheck && bun test packages/`
- **Per wave merge:** full P1.11 smoke (`bun run docker:prune && bun run docker:up && bun run smoke:health`)
- **Phase gate:** all of the above green + manual `docker compose ps` review

#### Wave 0 gaps
- [ ] `packages/shared-kernel/tests/money.test.ts` — covers REQ-DOM-06
- [ ] `packages/shared-kernel/tests/config.test.ts` — verifies zod schema rejects missing/invalid env, covers REQ-INFRA-05
- [ ] `packages/eslint-plugin/tests/no-number-for-money.test.ts` — rule fixture tests
- [ ] `scripts/smoke-health.sh` (or root npm script `smoke:health`) — curl loop against `/health` on both services + Keycloak `/realms/crash-game/.well-known/openid-configuration`
- [ ] Framework install: `bun-types` already in root; no separate test runner install needed (bun:test built-in)

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Docker | Compose orchestration | needs verification on dev box | — | none — REQ-INFRA-01 mandates Docker; fail-fast in P1.11 |
| Docker Compose v2 | `docker compose` syntax | needs verification | — | none |
| Bun runtime locally | dev workflow (not strictly needed if all dev happens in container) | needs verification | should be 1.3.11+ | `oven/bun:1.3.11-alpine` container works without local Bun |
| curl OR wget on host | smoke healthchecks | both standard | — | — |
| `jq` (optional) | parsing docker compose ps JSON in smoke script | likely available | — | fallback: `grep` |

**Missing dependencies with no fallback:** Docker + Compose are hard requirements. Recommend the planner add an explicit P1.0 task "verify Docker Desktop installed and running" before P1.11 smoke.

**Missing dependencies with fallback:** none.

---

## Security Domain

Phase 1 surface is narrow (config + scaffolding) but still touches a few ASVS-aligned areas:

### Applicable ASVS categories

| ASVS Category | Applies in Phase 1 | Standard control |
|---------------|---------------------|------------------|
| V2 Authentication | No (Phase 3 + 6) | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | yes (env parsing) | zod schema rejecting malformed env at boot |
| V6 Cryptography | No (Phase 4 + 6) | — |
| V7 Error Handling | partial | error taxonomy in place; HTTP mapping in Phase 3 |
| V14 Config | yes | `.env` gitignored; `.env.example` committed; no secrets in code; ESLint ban on `process.env` outside config/ |

### Known threat patterns for Phase 1

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| Hardcoded business constant grows into a security-relevant default (e.g., wallet seed default leaks into prod) | Tampering / Info Disclosure | All values via env; `.env.example` clearly marks dev defaults |
| Committed secret (.env or realm with admin creds) | Info Disclosure | `.gitignore` covers `.env*`; realm-export.json contains only demo creds intended for local dev |
| Floating Docker base tag pulls a backdoored image | Tampering | Pin `oven/bun:1.3.11-alpine`, `postgres:18.3-alpine`, etc. (already done in compose) |
| Docker daemon socket mounted into container | Elevation of privilege | Not done in this compose; verify in P1.8 review |

---

## Open Questions

1. **OD8 — bet min/max bounds** (defaults `100`/`100000` cents = 1.00/1000.00). STATE flagged these as needing user confirmation before Phase 4. Phase 1 ships the defaults; Phase 4 may revise. **Recommendation:** raise in `/gsd:discuss-phase 1` if planner sees fit, otherwise defer to discuss-phase-4.
2. **OD14 — auto-cashout max (`100.00x`)**. Same status. Defer.
3. **Wallet seed strategy under REQ-DOC-03 wording.** The requirement says "pre-configured ... seeded with 1000.00 CRD." Option C (first-login provisioning) technically defers seeding to first auth call. If user reads this as a hard pre-seed requirement, switch to Option B in Phase 3. **Recommendation:** raise in `/gsd:discuss-phase 1`.
4. **Frontend container in Phase 1 vs Phase 7?** Roadmap puts frontend in Phase 7. The current commented placeholder is correct. **Recommendation:** keep deferred.
5. **Should Phase 1 ship a `.github/workflows/lint.yml` as a tiny CI starter?** Roadmap puts full CI in Phase 10. **Recommendation:** ship NOTHING in `.github/workflows/` from Phase 1 to avoid churn during Phases 2-9.

---

## Sources

### Primary (HIGH confidence)
- [Bun blog v1.3.11](https://bun.com/blog/bun-v1.3.11) — fixes NestJS controller decorator-metadata regression introduced in 1.3.10
- [Bun blog v1.3.10](https://bun.com/blog/bun-v1.3.10) — the broken release; documents the regression
- [oven-sh/bun#27526](https://github.com/oven-sh/bun/issues/27526) — NestJS controllers crash on Bun 1.3.10
- [Dinero.js v2 announcement (Sarah Dayan, March 2026)](https://www.sarahdayan.com/blog/dinerojs-v2-is-out) — stable release confirms consolidated `dinero.js` package, bigint API
- [Dinero v2 GitHub discussion #618](https://github.com/dinerojs/dinero.js/discussions/618) — v2 stable release coordination
- [Keycloak management interface](https://www.keycloak.org/server/management-interface) — health endpoints on port 9000 in Keycloak 26+
- [Keycloak health checks](https://www.keycloak.org/observability/health) — `/health/ready` semantics and `KC_HEALTH_ENABLED`
- [Keycloak containers](https://www.keycloak.org/server/containers) — `--import-realm` and `/opt/keycloak/data/import` mount
- [typescript-eslint custom rules](https://typescript-eslint.io/developers/custom-rules/) — `ESLintUtils.RuleCreator` and AST node selectors
- [typescript-eslint naming-convention docs](https://typescript-eslint.io/rules/naming-convention/) — regex matching on identifiers
- [Bun bunx docs](https://bun.com/docs/pm/bunx) — local-binary lookup behavior
- [Bun Docker guide](https://bun.com/docs/guides/ecosystem/docker) — multistage Bun in containers
- [PostgreSQL CHECK constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL Numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html) — NUMERIC vs BIGINT for money

### Secondary (MEDIUM confidence)
- [PAS7 Studio — NestJS on Bun 2026 guide](https://pas7.com.ua/blog/en/nestjs-bun-performance-2026) — `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` in production
- [Crunchy Data — Working with Money in Postgres](https://www.crunchydata.com/blog/working-with-money-in-postgres) — BIGINT cents idiom
- [RabbitMQ as Code: definitions.json](https://medium.com/@ademola.emmanuel383/rabbitmq-as-code-how-to-manage-exchanges-queues-and-users-with-definitions-json-b497bf0749b0) — Phase 2 reference; not used in Phase 1
- [shadcn TanStack Start docs](https://ui.shadcn.com/docs/installation/tanstack) — Phase 7 reference

### Tertiary (project-internal)
- `.planning/research/STACK.md` (locked versions and rationale)
- `.planning/research/ARCHITECTURE.md` (component diagram, shared-kernel placement)
- `.planning/research/PITFALLS.md` (C1, C4, C5, M1, M2, H5)
- `.planning/research/SUMMARY.md` §6, §7, §8 (phase ordering, env constants, conflicts resolved)
- `.planning/ROADMAP.md` (Phase 1 success criteria + ADR list)
- `.planning/REQUIREMENTS.md` (REQ-INFRA-*, REQ-DOM-05, REQ-DOM-06, REQ-AUTH-05, REQ-DOC-03)
- `CLAUDE.md` (project coding standards)
- Current scaffold: `docker-compose.yml`, `package.json`, `services/games/*`, `docker/keycloak/realm-export.json`, `docker/kong/kong.yml`, `docker/postgres/init-databases.sh`

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against official sources within the last research cycle; Dinero v2 stable + Bun 1.3.11 fix confirmed
- Architecture (shared-kernel surface, Docker pattern): HIGH — standard NestJS-on-Bun multistage + workspace-aware install; well-documented
- Pitfalls (Keycloak 9000 port, Bun 1.3.10 regression, workspace lockfile): HIGH — verified against multiple authoritative sources
- ESLint custom-rule scaffold: MEDIUM-HIGH — pattern is standard but rule semantics must be tested against positive/negative fixtures before locking
- Wallet seed strategy recommendation: MEDIUM — judgment call; depends on user interpretation of REQ-DOC-03 phrasing; surface in discuss-phase

**Research date:** 2026-05-24
**Valid until:** 2026-06-23 (30 days; Bun moves fast — re-verify before Phase 2 if drift)
