---
phase: 01-foundation-infra
plan: 07
subsystem: config-env-layer
tags: [config, env, zod, defaults, dotenv]
requires:
  - "@crash/shared-kernel sharedEnvSchema (Wave 2, P1.4)"
provides:
  - "services/games/src/config/defaults.ts — typed, frozen games env"
  - "services/wallets/src/config/defaults.ts — typed, frozen wallets env"
  - "services/games/.env.example — 19 game-side operator constants"
  - "services/wallets/.env.example — 7 wallet-side operator constants"
  - ".env.example — root superset reference"
  - "packages/shared-kernel/tests/env-schema.test.ts — 5 regression tests"
affects:
  - "Phase 3 wallet provisioning will read env.INITIAL_BALANCE_CENTS via the typed layer"
  - "Phase 4 round loop will read env.BETTING_WINDOW_MS, GROWTH_RATE, HASH_CHAIN_LENGTH, BET_MIN/MAX_CENTS via the typed layer"
  - "Phase 2 messaging will read env.OUTBOX_POLL_INTERVAL_MS and RMQ_DELIVERY_LIMIT_* via the typed layer"
tech-stack:
  added: []
  patterns:
    - "sharedEnvSchema.extend(...) per service — DRY of NODE_ENV/DATABASE_URL/RABBITMQ_URL/CURRENCY_*"
    - "z.string().regex(/^\\d+$/).transform(s => BigInt(s)) for bigint cents (A7 fallback — z.coerce.bigint() not used)"
    - "Object.freeze(schema.parse(process.env)) at module scope — fail-fast at boot"
key-files:
  created:
    - services/games/src/config/defaults.ts
    - services/wallets/src/config/defaults.ts
    - .env.example
    - packages/shared-kernel/tests/env-schema.test.ts
    - services/games/.env (gitignored)
    - services/wallets/.env (gitignored)
  modified:
    - services/games/.env.example
    - services/wallets/.env.example
    - services/games/package.json (added @crash/shared-kernel and zod deps)
    - services/wallets/package.json (added @crash/shared-kernel and zod deps)
    - bun.lock (workspace resolution)
decisions:
  - "Bigint cents parsed via string-regex-transform fallback (A7) — zod 3.25 z.coerce.bigint() exists but the explicit regex path is more readable and zod-version-portable"
  - "Imported sharedEnvSchema from @crash/shared-kernel root (single index re-export) rather than the @crash/shared-kernel/config/env-schema subpath — the games tsconfig.json has moduleResolution=commonjs which does not resolve package exports subpaths, and tsconfig is out of plan scope"
  - "Root .env.example is informational only; each service consumes services/<name>/.env directly per docker-compose env_file: contract"
metrics:
  duration_minutes: 6
  completed: 2026-05-24T18:51:26Z
  tasks_completed: 4
  files_created: 6
  files_modified: 4
---

# Phase 1 Plan 7: Typed Config & Env Layer Summary

Both services now boot through a zod-parsed, Object.freeze'd env object. Every operator-tunable constant from REQUIREMENTS §Open Configuration Values lives in `.env.example`. Missing or malformed env vars throw at module load, before any HTTP or AMQP traffic.

## Env Key Inventory

### Games service (`services/games/src/config/defaults.ts`)

| Key | Default | Type | Source |
|-----|---------|------|--------|
| NODE_ENV | development | enum | sharedEnvSchema |
| DATABASE_URL | (required) | url | sharedEnvSchema |
| RABBITMQ_URL | (required) | url | sharedEnvSchema |
| CURRENCY_CODE | CRD | string | sharedEnvSchema |
| CURRENCY_BASE | 10 | number | sharedEnvSchema |
| CURRENCY_EXPONENT | 2 | number | sharedEnvSchema |
| PORT | 4001 | number | games |
| BETTING_WINDOW_MS | 5000 | number | games |
| COOLDOWN_MS | 2000 | number | games |
| SERVER_TICK_HZ | 30 | number | games |
| GROWTH_RATE | 0.06 | number (float) | games |
| INSTANT_CRASH_BUCKET | 101 | number | games |
| BET_MIN_CENTS | 100n | bigint | games (OD8 — pending) |
| BET_MAX_CENTS | 100000n | bigint | games (OD8 — pending) |
| HASH_CHAIN_LENGTH | 1000000 | number | games |
| SAGA_TIMEOUT_MS | 5000 | number | games |
| OUTBOX_POLL_INTERVAL_MS | 1000 | number | games |
| RMQ_DELIVERY_LIMIT_MAIN | 5 | number | games |
| RMQ_DELIVERY_LIMIT_DLQ | 3 | number | games |
| AUTO_CASHOUT_MAX_X | 100 | number (float) | games (OD14 — pending) |
| LEADERBOARD_WINDOW_HOURS | 24 | number | games |
| LEADERBOARD_TOP_N | 10 | number | games |

### Wallets service (`services/wallets/src/config/defaults.ts`)

| Key | Default | Type | Source |
|-----|---------|------|--------|
| NODE_ENV | development | enum | sharedEnvSchema |
| DATABASE_URL | (required) | url | sharedEnvSchema |
| RABBITMQ_URL | (required) | url | sharedEnvSchema |
| CURRENCY_CODE | CRD | string | sharedEnvSchema |
| CURRENCY_BASE | 10 | number | sharedEnvSchema |
| CURRENCY_EXPONENT | 2 | number | sharedEnvSchema |
| PORT | 4002 | number | wallets |
| INITIAL_BALANCE_CENTS | 100000n | bigint | wallets (REQ-WALL-03) |
| OUTBOX_POLL_INTERVAL_MS | 1000 | number | wallets |
| RMQ_DELIVERY_LIMIT_MAIN | 5 | number | wallets |
| RMQ_DELIVERY_LIMIT_DLQ | 3 | number | wallets |

## Zod bigint approach (A7)

The installed zod is `3.25.76` (resolved from `^3.23.0` in shared-kernel). `z.coerce.bigint()` does exist in this version, but the plan instructed the explicit `z.string().regex(/^\d+$/).transform((s) => BigInt(s))` shape as the version-portable fallback. We kept the explicit form because:

1. It is identical to the documented A7 fallback — no behavioral surprise.
2. The regex enforces "non-negative integer cents" at the schema layer, where `z.coerce.bigint()` would happily accept negatives.
3. It is portable to any future zod downgrade if a security patch ever forces the lockfile back.

If zod is pinned and audited in a later phase, this can be revisited; the runtime behavior is identical.

## Smoke output

Both services parsed their `.env` successfully with `bun -e "import('./src/config/defaults.ts').then(m => console.log(...))"`:

- Games → `{"port":4001,"ttl":5000,"bet_min":"100"}`
- Wallets → `{"port":4002,"initial":"100000"}`

Bun auto-loads `services/<svc>/.env` when the cwd is the service root, so the typed layer works out of the box for local `bun run dev` flows.

## .env gitignore

`git check-ignore` returned 0 for both `services/games/.env` and `services/wallets/.env`, confirming the runtime files are excluded by the existing `.env` glob in the root `.gitignore` (landed in P1.1).

## Test results

`bun test packages/shared-kernel/tests/env-schema.test.ts` → **5 pass / 0 fail / 9 expect calls** in 11ms.

Cases covered:

1. Minimal valid env applies defaults (CURRENCY_*)
2. Empty env throws (DATABASE_URL + RABBITMQ_URL required)
3. Malformed DATABASE_URL throws (URL validator)
4. NODE_ENV=staging throws (enum)
5. CURRENCY_BASE="10" (string) is coerced to number 10

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Added @crash/shared-kernel and zod as dependencies on both services**
- **Found during:** Task 1
- **Issue:** `services/games/package.json` and `services/wallets/package.json` did not declare `@crash/shared-kernel` or `zod` as runtime dependencies. The first `bunx tsc --noEmit` failed with `Cannot find module '@crash/shared-kernel'` and `Cannot find module 'zod'`. Without these the entire P1.7 deliverable is unimportable.
- **Fix:** Added `"@crash/shared-kernel": "workspace:*"` and `"zod": "^3.23.0"` to the dependencies of both services. Re-ran `bun install` to refresh the workspace symlinks.
- **Files modified:** `services/games/package.json`, `services/wallets/package.json`, `bun.lock`
- **Commit:** `5a45e8b` (folded into Task 1 commit)

**2. [Rule 3 — Blocking] Import sharedEnvSchema from package root instead of subpath**
- **Found during:** Task 1
- **Issue:** The plan example used `import { sharedEnvSchema } from "@crash/shared-kernel/config/env-schema"`. Both service tsconfigs use `module: "commonjs"` (NestJS 11 default) which does not resolve package.json `exports` subpaths — tsc reported `TS2307: Cannot find module '@crash/shared-kernel/config/env-schema'`. Updating the tsconfig (e.g. to `moduleResolution: "bundler"`) is **out of plan scope** per the prompt's "Touch ONLY" list.
- **Fix:** Imported from the package root: `import { sharedEnvSchema } from "@crash/shared-kernel"`. The package's `src/index.ts` already re-exports the schema, so the public surface is identical.
- **Files modified:** `services/games/src/config/defaults.ts`, `services/wallets/src/config/defaults.ts`
- **Acceptance impact:** The acceptance criterion "imports sharedEnvSchema from @crash/shared-kernel" is satisfied; the verify-grep `grep -q sharedEnvSchema` still passes.

### Deferred Issues (out of scope)

These were observed during `bunx tsc --noEmit` but are caused by other waves' work and are out of P1.7 scope. Logged for downstream phases:

- `packages/shared-kernel/src/money/{currency,money}.ts` imports `dinero.js/bigint` (a package.json subpath export) which the games / wallets `tsconfig.json` cannot resolve under `module: "commonjs"`. This is a P1.4 follow-up, not a P1.7 deliverable. The TypeScript errors do not surface at runtime because Bun resolves package exports natively.
- `services/games/src/main.ts` and `services/wallets/src/main.ts` reference `process.env` without `@types/node`. Preexisting in the scaffold; will be addressed when the services get proper type roots (likely Phase 2 / 3 alongside `@nestjs/config` wiring).

## Threat Flags

No new threat surface introduced. The threat register (T-01.7-01 through T-01.7-05) is satisfied:

- T-01.7-01 (Tampering — malformed env): mitigated by zod fail-fast at module load.
- T-01.7-02 (Disclosure — committed `.env`): mitigated by existing `.env` gitignore; `git check-ignore` confirms.
- T-01.7-03 (Tampering — `process.env` outside config layer): mitigation lives in P1.6 ESLint rule; this plan only ships the config layer it is allowed to access.
- T-01.7-04 (Tampering — hardcoded constants): mitigated by funneling every value through the schema.
- T-01.7-05 (Disclosure — boot stack trace): accepted; dev only.

## Known Stubs

None. Every default is wired to a parsed env value; no placeholder strings, no hardcoded numbers in domain code (the domain code itself does not yet exist — Phases 3-9 will consume `env` from these files).

## TDD Gate Compliance

Task 4 was marked `tdd="true"`. The implementation it tests (`sharedEnvSchema`) was already shipped in P1.4 (Wave 2), so the test is a regression lock rather than a fresh RED-then-GREEN cycle. All 5 tests pass on first run because the schema they validate is the existing P1.4 deliverable. This is appropriate behavior for a test that locks an existing contract — no implementation needs to be added in this plan.

The gate sequence for P1.7 as a whole is:

- 3x `feat(01-07): ...` commits (Tasks 1, 2, 3)
- 1x `test(01-07): ...` commit (Task 4)

## Self-Check: PASSED

Files verified:
- `services/games/src/config/defaults.ts`: FOUND
- `services/wallets/src/config/defaults.ts`: FOUND
- `services/games/.env.example`: FOUND
- `services/wallets/.env.example`: FOUND
- `.env.example`: FOUND
- `services/games/.env`: FOUND (gitignored)
- `services/wallets/.env`: FOUND (gitignored)
- `packages/shared-kernel/tests/env-schema.test.ts`: FOUND

Commits verified:
- `5a45e8b` (Task 1 — feat(01-07): typed env layer for games)
- `54dcb32` (Task 2 — feat(01-07): typed env layer for wallets)
- `ae913a9` (Task 3 — feat(01-07): expand .env.example files)
- `d509d4f` (Task 4 — test(01-07): lock shared env schema)
