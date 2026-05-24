# ADR-004: Configuration source-of-truth shape

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 1

## Context

REQ-INFRA-05 forbids hardcoded business constants. REQUIREMENTS.md §"Open Configuration Values" enumerates 19 operator-tunables that must flow from environment variables (initial wallet balance, betting window, growth rate, instant-crash bucket, bet bounds, hash-chain length, saga timeout, delivery limits, JWKS TTL, leaderboard window, and more — see OD1-OD14 in RESEARCH §7).

NestJS's stock `@nestjs/config` returns `string | undefined` and forces every consumer to parse and validate independently. This pattern is exactly how bugs like "INITIAL_BALANCE_CENTS leaked as a `number` because someone forgot to `BigInt(value)`" reach production. The challenge cannot afford that class of bug — REQ-DOM-03 forbids float math on money, and an unparsed env value defaults to JavaScript-typed `string` arithmetic in the worst case.

The decision covers three intertwined questions: where the env contract lives, how it is parsed, and how unsanctioned access is prevented.

## Considered

- **`.env.example` per service + typed `defaults.ts` via zod (fail-fast at boot)** — each service owns a `config/defaults.ts` that imports `sharedEnvSchema` from `@crash/shared-kernel`, extends it with service-specific keys, parses `process.env` once at module load, freezes the result, and exports a typed `env`. ESLint `no-restricted-properties` bans `process.env` outside `**/src/config/**/*.ts` and `mikro-orm.config.ts`.
- **`@nestjs/config` alone** — returns untyped `string | undefined`; each consumer re-parses; allows per-call defaults that diverge across modules.
- **`convict`** — env+schema library with strong validation; introduces a second dependency that overlaps with zod's existing role in DTO validation; less ergonomic for `bigint` and discriminated unions.

## Decision

**`.env.example` per service (committed) + root superset `.env.example` + per-service `src/config/defaults.ts` parsed by zod.**

Concretely, per RESEARCH §Pattern 3:

- `packages/shared-kernel/src/config/env-schema.ts` exports `sharedEnvSchema` (NODE_ENV, DATABASE_URL, RABBITMQ_URL, CURRENCY_CODE, CURRENCY_BASE, CURRENCY_EXPONENT — keys shared by every service).
- `services/games/src/config/defaults.ts` and `services/wallets/src/config/defaults.ts` each `import { sharedEnvSchema } from "@crash/shared-kernel"`, extend with service-specific keys (PORT, BETTING_WINDOW_MS, GROWTH_RATE, INSTANT_CRASH_BUCKET, BET_MIN_CENTS, BET_MAX_CENTS, INITIAL_BALANCE_CENTS, HASH_CHAIN_LENGTH, SAGA_TIMEOUT_MS, OUTBOX_POLL_INTERVAL_MS, RMQ_DELIVERY_LIMIT_MAIN, RMQ_DELIVERY_LIMIT_DLQ, AUTO_CASHOUT_MAX_X, LEADERBOARD_WINDOW_HOURS, LEADERBOARD_TOP_N), and call `Object.freeze(schema.parse(process.env))`.
- Each service ships an `.env.example` that documents every key with a default value matching the schema defaults — this is the human-readable contract.
- A root `.env.example` lists the superset across services for the recruiter who wants a single overview.
- A root `eslint.config.js` rule `no-restricted-properties` bans `process.env` access outside `**/src/config/**/*.ts` and `mikro-orm.config.ts`. The CLI config file is exempt because it runs before NestJS bootstrap (and therefore before the typed `env` import is resolvable in the same way it is at runtime).

Rationale, per STACK.md §2.6 and RESEARCH §7: zod parses + validates at boot, fails fast on missing or malformed values, and emits typed inference for the rest of the service. `bigint` coercion uses `z.string().transform(s => BigInt(s))` because `z.coerce.bigint()` was not stable in zod 3.23 for env-from-string at planning time (see ASSUMPTION A7 in RESEARCH). The typed-export pattern means the rest of the codebase never sees `process.env.X` — every consumer imports `env` and gets the right type.

## Consequences

- **Locked in**: one place to look for the env contract per service (the schema file); one place to add a new env var (schema + `.env.example` together); fail-fast at boot when an env var is missing or malformed.
- **Foreclosed**: ad-hoc `process.env.X` access; per-consumer parsing that drifts; silent string-typed monetary defaults; `@nestjs/config` as the only env layer.
- **Exempted**: `mikro-orm.config.ts` is the only file allowed to read `process.env` directly outside the config module, because the MikroORM CLI runs before NestJS bootstraps and the typed `env` export is not resolvable in that context. The exemption is encoded in the ESLint rule's path list.
- **Adding an env var** requires touching both the schema and the `.env.example` — friction is intentional; it guarantees the contract stays self-documenting.
- **Phase 1 ships**: `packages/shared-kernel/src/config/env-schema.ts` with the shared keys, per-service `src/config/defaults.ts` stubs (game-side OD3-OD14, wallet-side OD1-OD2), updated `.env.example` files, and the ESLint `no-restricted-properties` rule.

## Alternatives Rejected

- **`@nestjs/config` alone** — returns untyped strings; per-consumer parsing is exactly the source of monetary-type drift we are blocking.
- **`convict`** — overlaps with zod (which we already need for DTO validation); a second dep for a problem zod handles fine.
- **`dotenv-safe` / `envalid`** — narrower than zod, lacks `bigint` coercion and discriminated-union support that benefits richer config later in the project.
