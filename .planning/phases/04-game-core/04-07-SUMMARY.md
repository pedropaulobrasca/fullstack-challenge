---
phase: 04-game-core
plan: 07
subsystem: auth
tags: [jwt, keycloak, guard, games-service]
requires:
  - "services/wallets/src/presentation/guards/jwt.guard.ts (template)"
  - "ADR-012 (cached JWKS pattern locked in Phase 3)"
provides:
  - "JwtGuard @Injectable in services/games for Plan 04-08 BetsController"
  - "AuthenticatedRequest + JwtGuardOptions types"
  - "KEYCLOAK_ISSUER / KEYCLOAK_JWKS_URI / KEYCLOAK_AUDIENCE env in games"
affects:
  - "services/games/src/config/defaults.ts schema"
  - "services/games/package.json (jose runtime dep)"
tech_stack:
  added: [jose@6.2.3]
  patterns: [cached-jwks, copy-not-extract]
key_files:
  created:
    - "services/games/src/presentation/guards/jwt.guard.ts"
    - "services/games/tests/unit/jwt.guard.test.ts"
    - ".planning/phases/04-game-core/deferred-items.md"
  modified:
    - "services/games/src/config/defaults.ts"
    - "services/games/.env.example"
    - "services/games/package.json"
    - "bun.lock"
decisions:
  - "Duplicate guard verbatim from wallets-service instead of extracting to packages/auth-kernel (deferred to Phase 10 per Research Open Q3)"
  - "KEYCLOAK_AUDIENCE defaults to 'account' to match Keycloak default-client-scope behavior (ADR-012 Option B)"
metrics:
  duration_minutes: 5
  tasks: 1
  completed: 2026-05-26
requirements:
  - REQ-AUTH-04
---

# Phase 04 Plan 07: Games-service JwtGuard + Keycloak env Summary

JwtGuard duplicated verbatim from wallets into games-service so Plan 04-08's `GET /games/bets/me` can validate Keycloak-issued JWTs against a cached JWKS, with the three KEYCLOAK_* env vars added to the games env schema and `.env.example`.

## What was built

- **services/games/src/presentation/guards/jwt.guard.ts** — byte-identical copy of `services/wallets/src/presentation/guards/jwt.guard.ts`. The `require("../../config/defaults")` path is unchanged because both services share the same folder depth. Exports `JwtGuard`, `JwtGuardOptions`, `AuthenticatedRequest`. Uses `jose.createRemoteJWKSet` with `cacheMaxAge: 600_000`, `cooldownDuration: 30_000`. Rejects missing/malformed bearer with `MISSING_BEARER_TOKEN`, signature/issuer/audience/expiry failures with `INVALID_TOKEN`, and on success populates `req.user = { playerId, tokenExp }`.
- **services/games/src/config/defaults.ts** — `gamesEnvSchema` extended with `KEYCLOAK_ISSUER: z.string().url()`, `KEYCLOAK_JWKS_URI: z.string().url()`, `KEYCLOAK_AUDIENCE: z.string().min(1).default("account")`. Placed after `LEADERBOARD_TOP_N` for diff-friendliness with wallets.
- **services/games/package.json** — `jose: 6.2.3` added to runtime dependencies (matches wallets pinning).
- **services/games/.env.example** — KEYCLOAK_ISSUER / JWKS_URI / AUDIENCE keys appended with the same comment block used in root `.env.example`. The root `.env.example` already exposes the KEYCLOAK_* trio in the shared section (lines 53-59) so no root change was needed.
- **services/games/tests/unit/jwt.guard.test.ts** — 7 unit tests mirroring the wallets suite:
  1. missing Authorization header → `MISSING_BEARER_TOKEN`
  2. malformed bearer (`Basic ...`) → `MISSING_BEARER_TOKEN`
  3. valid token → `req.user.playerId` + `tokenExp` populated, returns `true`
  4. mismatched `iss` → `INVALID_TOKEN`
  5. mismatched `aud` → `INVALID_TOKEN`
  6. expired token → `INVALID_TOKEN`
  7. foreign-key signature → `INVALID_TOKEN`
  Uses a real ephemeral Bun.serve JWKS host and `jose.generateKeyPair` + `SignJWT` — same pattern as wallets, no module mocking.
- **.planning/phases/04-game-core/deferred-items.md** — logged Phase 10 task to extract the guard into `packages/auth-kernel`.

## Verification

- `bun test tests/unit/jwt.guard.test.ts` from `services/games` — **7 pass / 0 fail**.
- `diff services/wallets/src/presentation/guards/jwt.guard.ts services/games/src/presentation/guards/jwt.guard.ts` — empty (byte-identical).
- `grep -c KEYCLOAK_ services/games/src/config/defaults.ts` — **3**.
- `grep -c "KEYCLOAK_ISSUER\|KEYCLOAK_AUDIENCE\|KEYCLOAK_JWKS_URI" .env.example` — **3**.
- `bunx tsc --noEmit` from `services/games` — clean.

## Deviations from Plan

- **Test count:** plan listed 6 cases in `<behavior>`, but the wallets template already shipped 7 (it splits the signature path into "expired", "foreign-key", and adds a malformed-bearer path beyond the empty-token case). I mirrored the template — 7 tests, all from real cryptography rather than module mocks. The plan's behavior list is fully covered.
- **Jose dep placement:** plan suggested devDeps, but wallets pins `jose@6.2.3` as a runtime dependency and the guard imports it at runtime. Matched wallets — runtime dep, exact version pin. No semantic difference for the test runtime; this just keeps it install-faithful to production.
- **Lockfile co-mingling:** `bun install` updated `bun.lock` with both my `jose` addition and another concurrent wave's `fast-check` additions for `packages/contracts` and `services/games` devDeps. The lockfile was staged together so it stays internally consistent; the parallel wave's source files were left unstaged for their own commit.

None of these are deviations from the plan's intent — guard parity with wallets is preserved.

## Decisions Made

- **Duplicate, do not extract.** Per Research Open Q3 and ADR-012 carry-forward, `JwtGuard` is duplicated across services to keep them deployable independently. A Phase 10 `packages/auth-kernel` extraction task is logged in `deferred-items.md`.
- **`KEYCLOAK_AUDIENCE` default = `"account"`.** Matches ADR-012 Option B (no protocol mapper on `crash-game-client`, Keycloak emits `aud=account` by default).

## Commits

- `fa2960f` — `test(04-07): add failing tests for games JwtGuard`
- `0c4029e` — `feat(04-07): add JwtGuard and KEYCLOAK env to games service`

## Self-Check: PASSED

- FOUND: services/games/src/presentation/guards/jwt.guard.ts
- FOUND: services/games/tests/unit/jwt.guard.test.ts
- FOUND: .planning/phases/04-game-core/deferred-items.md
- FOUND: commit fa2960f
- FOUND: commit 0c4029e
- DIFF with wallets/jwt.guard.ts: empty (byte-identical)
- 7/7 unit tests green; `bunx tsc --noEmit` clean
