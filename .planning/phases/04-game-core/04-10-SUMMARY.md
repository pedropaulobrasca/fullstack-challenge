---
phase: 04-game-core
plan: 10
subsystem: games-tests-integration
tags: [integration-tests, testcontainers-style, bun-test, keycloak-password-grant, kill-9-recovery, partial-unique-index, provably-fair-determinism]
dependency-graph:
  requires:
    - Plan 04-04 (MikroORM repositories + bets_one_active_per_player partial unique index)
    - Plan 04-05 (SeedChainBootstrap + GameCoreModule wiring)
    - Plan 04-06 (RoundLoopService + lifecycle use cases + kill -9 recovery branches)
    - Plan 04-08 (RoundsController + BetsController + four READ use cases)
    - Live docker stack via `bun run docker:up` (Postgres at :5432 + Keycloak at :8080)
  provides:
    - services/games/tests/integration/_helpers/test-env.ts (setupIntegrationEnv + fetchPlayerToken + dynamic AppModule loader)
    - services/games/tests/integration/_helpers/app-factory.ts (createTestGamesApp via @nestjs/testing + truncateGamesTables + waitFor/pollRound polling helpers)
    - services/games/tests/integration/seed-chain-bootstrap.test.ts (3 sub-tests)
    - services/games/tests/integration/round-loop-autonomous.test.ts (1 sub-test covering full BETTING -> RUNNING -> CRASHED -> SETTLED -> next BETTING cycle)
    - services/games/tests/integration/kill-9-recovery.test.ts (2 sub-tests covering RUNNING -> SETTLED recovery and next-round continuity)
    - services/games/tests/integration/bet-uniqueness.test.ts (3 sub-tests: 23505 violation, cross-player allowed, REFUNDED -> PENDING allowed)
    - services/games/tests/integration/verify-round.test.ts (3 sub-tests: matches=true, 400 ROUND_NOT_YET_SETTLED, 404 ROUND_NOT_FOUND)
    - services/games/tests/integration/get-current-round.test.ts (3 sub-tests: BETTING seedHash exposure, RUNNING multiplier, post-SETTLED pivot)
    - services/games/tests/integration/get-round-history.test.ts (3 sub-tests: limit=3, limit=200 clamp, default=20)
    - services/games/tests/integration/get-player-bets.test.ts (4 sub-tests: 401 missing bearer, 401 invalid token, 200 happy path, DB insert visible to /me)
    - services/games/tsconfig.integration.json (extends base tsconfig + includes tests/integration so the suite type-checks with bun-types + reflect-metadata)
  affects:
    - services/games/package.json (added @nestjs/testing@^11.1.21 dev dep)
tech-stack:
  added:
    - "@nestjs/testing@^11.1.21 (services/games — Test.createTestingModule for the in-process app bootstrap)"
  patterns:
    - "Top-of-file process.env seeding via setupIntegrationEnv() before any AppModule import (avoids the Phase 3 W6 per-file pollution that produced 35 lint errors)"
    - "Per-suite cold-boot pattern: createTestGamesApp() -> truncate -> close -> createTestGamesApp() so each describe block exercises the OnApplicationBootstrap path (seed chain regenerated, recovery runs) against a clean schema"
    - "Keycloak password grant via fetchPlayerToken() (player/player123 against http://localhost:8080/realms/crash-game) — extracted from scripts/smoke-health.sh probe_wallets_keycloak_token"
    - "Polling helpers waitFor(predicate, timeout, interval) and pollRound(em, predicate) replace fixed sleeps; every assertion waits on a DB state predicate with a documented timeout"
    - "Raw SQL INSERT into bets to bypass the Bet aggregate and prove the Postgres bets_one_active_per_player partial unique index from the DB layer (REQ-DOM-02)"
    - "tsconfig.integration.json extends tsconfig.json and re-adds tests/integration to include — keeps the production build excluding tests while letting `bunx tsc --noEmit -p tsconfig.integration.json` type-check the suite"
key-files:
  created:
    - services/games/tests/integration/_helpers/test-env.ts
    - services/games/tests/integration/_helpers/app-factory.ts
    - services/games/tests/integration/seed-chain-bootstrap.test.ts
    - services/games/tests/integration/round-loop-autonomous.test.ts
    - services/games/tests/integration/kill-9-recovery.test.ts
    - services/games/tests/integration/bet-uniqueness.test.ts
    - services/games/tests/integration/verify-round.test.ts
    - services/games/tests/integration/get-current-round.test.ts
    - services/games/tests/integration/get-round-history.test.ts
    - services/games/tests/integration/get-player-bets.test.ts
    - services/games/tsconfig.integration.json
  modified:
    - services/games/package.json (added @nestjs/testing devDep)
    - bun.lock (lockfile sync from bun install)
decisions:
  - "@nestjs/testing was missing from services/games — added as a dev dependency (matches services/wallets baseline). Without it, Test.createTestingModule cannot import AppModule for the in-process suite. Rule 3 auto-fix during Task 1."
  - "Created services/games/tsconfig.integration.json (extends tsconfig.json, re-adds tests/integration to include) so `bunx tsc --noEmit -p tsconfig.integration.json` exercises the suite under the same strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes flags the production code uses. Running bare `bunx tsc tests/...` without -p drops the project's `types: [bun-types, reflect-metadata]` resolution."
  - "kill-9 recovery is simulated via app.close() because bun:test cannot SIGKILL its own process without losing the harness. The test file header documents this caveat in full; the true-SIGKILL drill stays in scope for the Plan 04-11 smoke checkpoint."
  - "bet-uniqueness inserts via raw SQL on the EntityManager connection to bypass the Bet aggregate's status guard — the test is a DB-layer proof of the partial unique index (REQ-DOM-02), independent of application code. The REFUNDED -> PENDING sub-test directly verifies research §Pitfall 4's claim that the partial index does not cover REFUNDED rows."
  - "get-round-history accumulates >=5 SETTLED rounds via the autonomous loop with HASH_CHAIN_LENGTH=30 + BETTING_WINDOW_MS=200 + COOLDOWN_MS=100; wall-clock budget annotated in the file header (~3-8s depending on crashPoint draws)."
  - "get-player-bets fourth sub-test directly INSERTs a bet row for the JWT-resolved playerId because Phase 4 has no POST /games/bet — file comment explicitly notes Phase 5 will replace this with a real saga-driven flow."
metrics:
  duration_seconds: 312
  task_count: 2
  files_created: 11
  files_modified: 2
  tests_added: "22 sub-tests across 8 integration files"
  completed_at: "2026-05-26T21:44:57Z"
requirements:
  - REQ-GAME-01
  - REQ-GAME-02
  - REQ-GAME-03
  - REQ-GAME-04
  - REQ-GAME-05
  - REQ-GAME-09
  - REQ-FAIR-01
  - REQ-FAIR-02
  - REQ-FAIR-04
  - REQ-DOM-02
  - REQ-TEST-01
---

# Phase 04 Plan 10: Integration Tests for Phase 4 Surface Summary

Eight integration tests (22 sub-tests) exercising the full Phase 4 backend end-to-end against the live docker stack. Anchors REQ-GAME-09 kill -9 recovery (the headline arguição property), REQ-DOM-02 partial unique index at the Postgres layer, REQ-FAIR-02 seed-reveal gating, and the four READ endpoints (current, history, verify, bets/me) with real Keycloak JWT validation. Suite runs via `cd services/games && INTEGRATION=1 bun test tests/integration` against `bun run docker:up`. Type-checks clean under a dedicated `tsconfig.integration.json` that extends the base config and re-includes the integration directory.

## Test Inventory

| # | File | Sub-tests | REQ-IDs |
|---|------|-----------|---------|
| 1 | seed-chain-bootstrap.test.ts | 3 (population, chain integrity, idempotency) | REQ-FAIR-01 |
| 2 | round-loop-autonomous.test.ts | 1 (full BETTING -> RUNNING -> CRASHED -> SETTLED -> next cycle) | REQ-GAME-01 |
| 3 | kill-9-recovery.test.ts | 2 (RUNNING -> SETTLED via cold restart, next-round continuity) | REQ-GAME-09 |
| 4 | bet-uniqueness.test.ts | 3 (23505 on duplicate PENDING, cross-player allowed, REFUNDED -> PENDING allowed) | REQ-DOM-02 |
| 5 | verify-round.test.ts | 3 (matches=true, 400 ROUND_NOT_YET_SETTLED, 404 ROUND_NOT_FOUND) | REQ-GAME-04, REQ-FAIR-02, REQ-FAIR-04 |
| 6 | get-current-round.test.ts | 3 (BETTING seedHash exposure + serverSeed null, RUNNING multiplier, post-SETTLED pivot) | REQ-GAME-02 |
| 7 | get-round-history.test.ts | 3 (limit=3 desc, limit=200 clamp, default=20) | REQ-GAME-03 |
| 8 | get-player-bets.test.ts | 4 (missing bearer 401, invalid token 401, valid JWT 200, DB insert visible) | REQ-GAME-05 |
| Total | 8 files | 22 sub-tests | — |

## REQ-ID Coverage Matrix

| REQ-ID | Integration evidence |
|--------|----------------------|
| REQ-GAME-01 (autonomous loop) | round-loop-autonomous: single test observes a full BETTING -> RUNNING -> CRASHED -> SETTLED -> next BETTING cycle via DB polling, no external trigger |
| REQ-GAME-02 (GET /rounds/current) | get-current-round 3 sub-tests cover all three lifecycle states the endpoint must serve |
| REQ-GAME-03 (GET /rounds/history) | get-round-history 3 sub-tests cover the limit clamping (use-case layer) and default pagination |
| REQ-GAME-04 (GET /rounds/:id/verify) | verify-round 3 sub-tests cover the happy path + both error gates |
| REQ-GAME-05 (GET /bets/me JwtGuard) | get-player-bets 4 sub-tests cover the JwtGuard error paths and a successful Keycloak-token flow against a directly-inserted bet |
| REQ-GAME-09 (kill -9 recovery) | kill-9-recovery: app.close() during RUNNING -> next cold boot resumes the SAME round.id to SETTLED; documented SIGKILL simulation caveat (true drill in 04-11) |
| REQ-FAIR-01 (chain pre-gen + idempotent) | seed-chain-bootstrap: 20 rows after first cold boot, sha256(seed[i]) === hash[i-1] across the chain, second cold boot leaves row count unchanged |
| REQ-FAIR-02 (seed reveal gated on SETTLED) | verify-round 400 on non-SETTLED; get-current-round asserts serverSeed === null during BETTING and RUNNING |
| REQ-FAIR-04 (provably-fair pure-function shared FE/BE) | verify-round independently invokes deriveCrashPoint from @crash/contracts against the response payload and asserts byte-equality with the server's recomputedCrashPoint |
| REQ-DOM-02 (one active bet per player per round) | bet-uniqueness: raw SQL INSERT collision raises SQLSTATE 23505 on bets_one_active_per_player |
| REQ-TEST-01 (integration coverage) | 22 sub-tests across 8 files; runs via `INTEGRATION=1 bun test tests/integration` against `bun run docker:up` |

## SIGKILL Simulation Caveat (REQ-GAME-09)

The kill-9-recovery integration test simulates SIGKILL via `app.close()`. A real `kill -9` skips every NestJS lifecycle hook (OnApplicationShutdown never fires, the recursive setTimeout is never cleared, no graceful AMQP/PG drain). We cannot SIGKILL ourselves in-process without losing the bun:test harness, so the simulation is the friendliest path that still exercises the property under test: on the next cold boot, the persisted `rounds` + `seed_chain` rows are the only source of truth and `RoundLoopService.recoverInFlightRound()` must reconstruct the timer schedule from them.

The header comment in `kill-9-recovery.test.ts` documents the caveat in full and points to the Plan 04-11 smoke checkpoint where the true-SIGKILL drill runs against a live docker container (`docker kill -s 9 games`).

## Live Execution

The suite is type-checked clean but NOT executed during this plan — live runs require `bun run docker:up` (Postgres on :5432 + Keycloak on :8080 + RabbitMQ on :5672). Execution is gated to Plan 04-11 / the smoke checkpoint per the plan's `verification` block.

```bash
# Once docker:up is green:
cd services/games && INTEGRATION=1 bun test tests/integration
```

## Verification

| Check | Outcome |
|-------|---------|
| `bunx tsc --noEmit -p tsconfig.integration.json` (services/games) | clean, exit 0 |
| INTEGRATION=1 guard present in every test file | 8 / 8 |
| `setupIntegrationEnv` seeds 26 env keys (NODE_ENV + 14 game knobs + 5 messaging + 3 Keycloak + 3 currency) | confirmed in test-env.ts |
| `bet-uniqueness.test.ts` asserts `err.code === "23505"` AND `err.constraint` contains `bets_one_active_per_player` | confirmed |
| `kill-9-recovery.test.ts` header comment documents SIGKILL simulation caveat | confirmed |
| `verify-round.test.ts` independently re-invokes `deriveCrashPoint` from `@crash/contracts` against the response | confirmed |
| `get-player-bets.test.ts` fetches token via Keycloak password grant (player/player123) | confirmed |
| Live execution | deferred to Plan 04-11 (docker:up required) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] @nestjs/testing missing from services/games package**

- **Found during:** First type-check of `tests/integration/_helpers/test-env.ts` failed with `Cannot find module '@nestjs/testing'`.
- **Issue:** Phase 3 added `@nestjs/testing` to `services/wallets/package.json` but `services/games/package.json` was never updated even though its planned integration suite needs it (Test.createTestingModule is the entry point for in-process app bootstrap).
- **Fix:** Added `@nestjs/testing: ^11.1.21` to `services/games/package.json` devDependencies (matches wallets pin) and ran `bun install` to sync the lockfile.
- **Files modified:** `services/games/package.json`, `bun.lock`
- **Commit:** `cf2dfde` (Task 1 commit — fix landed inline)

**2. [Rule 3 — Blocking] Production tsconfig excludes tests/, so standalone `bunx tsc tests/...` drops bun-types and reflect-metadata**

- **Found during:** Initial `bunx tsc --noEmit tests/integration/_helpers/test-env.ts` produced `Cannot find module 'bun:test'` and `Cannot find module '@nestjs/testing'` errors because the file-list invocation does not load the project tsconfig's `types: [bun-types, reflect-metadata]` array.
- **Issue:** The plan's verification line literally passes file paths to `bunx tsc --noEmit`, which forces a default tsconfig and breaks type resolution. Both `services/wallets/tests/integration/setup.ts` and the games suite hit the same limitation when invoked that way.
- **Fix:** Created `services/games/tsconfig.integration.json` that extends the base `tsconfig.json` and re-adds `tests/integration/**/*` to `include`. The verification command becomes `bunx tsc --noEmit -p tsconfig.integration.json` which honors all strict flags + types.
- **Files modified:** `services/games/tsconfig.integration.json` (new)
- **Commit:** `cf2dfde` (Task 1 commit)

No Rule 1, 2, or 4 deviations. No checkpoints reached. No auth gates. The plan executed exactly as specified with the two auto-fixes above necessary for the verify step to compile cleanly.

## Threat Model Compliance

| Threat ID | Disposition | Mitigation in this plan |
|-----------|-------------|-------------------------|
| T-04-10-01 (test passes silently in non-INTEGRATION mode) | mitigate | Every file starts with `if (process.env.INTEGRATION !== "1") { console.log("skipping integration suite — set INTEGRATION=1"); process.exit(0); }` — visible skip signal |
| T-04-10-02 (test pollutes DB causing flaky downstream tests) | mitigate | `truncateGamesTables(em)` truncates `bets`, `rounds`, and `seed_chain` between cold-boot pairs in each describe block's beforeAll |
| T-04-10-03 (test logs leak Keycloak password) | accept | `player/player123` is the documented public dev realm credential from REQ-AUTH-05 and `scripts/smoke-health.sh` — same exposure pattern as Phase 3 |

## Threat Flags

None — no new trust boundaries or surfaces introduced. The integration tests exercise the same surface the plans 04-04 through 04-08 already shipped; they exist purely to assert observable properties.

## Known Stubs

None. Every test asserts real observable behavior against the live stack.

## Requirements Closed

This plan is the test-coverage artifact for the requirements ALREADY closed by Plans 04-04 through 04-08 (REQ-GAME-01/02/03/04/05/09, REQ-FAIR-01/02/04, REQ-DOM-02). It also closes REQ-TEST-01 (integration coverage for the Phase 4 surface) once live runs land in the Plan 04-11 smoke checkpoint.

## Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | Seed-chain bootstrap + autonomous loop + kill -9 recovery + bet uniqueness integration tests (6 files) + helpers + tsconfig + @nestjs/testing dev dep | `cf2dfde` |
| 2 | Verify-round + current-round + round-history + player-bets integration tests (4 files) | `f20fef7` |

## Self-Check: PASSED

- `services/games/tests/integration/_helpers/test-env.ts` — FOUND
- `services/games/tests/integration/_helpers/app-factory.ts` — FOUND
- `services/games/tests/integration/seed-chain-bootstrap.test.ts` — FOUND
- `services/games/tests/integration/round-loop-autonomous.test.ts` — FOUND
- `services/games/tests/integration/kill-9-recovery.test.ts` — FOUND
- `services/games/tests/integration/bet-uniqueness.test.ts` — FOUND
- `services/games/tests/integration/verify-round.test.ts` — FOUND
- `services/games/tests/integration/get-current-round.test.ts` — FOUND
- `services/games/tests/integration/get-round-history.test.ts` — FOUND
- `services/games/tests/integration/get-player-bets.test.ts` — FOUND
- `services/games/tsconfig.integration.json` — FOUND
- Commit `cf2dfde` — FOUND in git log
- Commit `f20fef7` — FOUND in git log
- `bunx tsc --noEmit -p tsconfig.integration.json` from services/games — clean, exit 0
- INTEGRATION=1 guard present in 8 / 8 test files
