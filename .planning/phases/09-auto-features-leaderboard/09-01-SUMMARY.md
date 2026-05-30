---
phase: 09-auto-features-leaderboard
plan: 01
subsystem: config
tags:
  - env-layer
  - zod
  - typed-config
  - phase-9-gate
requirements:
  - REQ-AUTO-01
  - REQ-AUTO-02
  - REQ-AUTO-03
  - REQ-LEAD-01
  - REQ-LEAD-03
  - REQ-LEAD-04
dependency_graph:
  requires:
    - "services/games/src/config/defaults.ts (existing gamesEnvSchema, Phase 1)"
    - "frontend/src/lib/config.ts (existing zod VITE_ env schema, Phase 7 + 8)"
    - "@crash/shared-kernel sharedEnvSchema (Phase 1)"
  provides:
    - "BE: env.LEADERBOARD_UPDATE_THROTTLE_MS, env.STOP_LOSS_CENTS_MAX, env.STOP_WIN_CENTS_MAX, env.AUTO_BET_MIN_TARGET_CENTI_X (typed, Zod-validated, frozen)"
    - "FE: getConfig().autoBet.{minTarget, maxTarget}"
    - "FE: getConfig().leaderboard.{sizeN, windowHours, relativeRefreshMs, rankUpTransitionMs}"
  affects:
    - "Plan 09-02 (autoCashoutTarget Bet field — DTO reads env.AUTO_BET_MIN_TARGET_CENTI_X for the 1.01x floor)"
    - "Plan 09-04 (leaderboard_24h table — projector reads env.LEADERBOARD_UPDATE_THROTTLE_MS)"
    - "Plan 09-05 (AutoCashoutTickService — no direct read, gates plan 09-02)"
    - "Plan 09-06 (LeaderboardProjectorService — reads env.LEADERBOARD_UPDATE_THROTTLE_MS for WS emit gating)"
    - "Plan 09-07 (LeaderboardController — reads env.LEADERBOARD_TOP_N + env.LEADERBOARD_WINDOW_HOURS, already in schema)"
    - "Plan 09-08 (AutoBetForm — reads getConfig().autoBet.{minTarget,maxTarget} + stops ceilings via shared-kernel boundary)"
    - "Plan 09-09 (LeaderboardPanel — reads getConfig().leaderboard.*)"
tech_stack:
  added: []
  patterns:
    - "Zod .coerce.number().int() with default() — shared backend env schema pattern"
    - "Nested frozen namespaces in AppConfig — same shape Phase 8 used for replay/drawer/fairness"
    - "Floor enforcement at parse time (.min(101) on centi-x, .gt(1) on multiplier) so an invalid env crashes boot, not first request"
key_files:
  created:
    - "services/games/tests/unit/config-defaults-phase9.test.ts"
    - "frontend/src/lib/config.phase9.test.ts"
    - ".planning/phases/09-auto-features-leaderboard/09-01-SUMMARY.md"
  modified:
    - "services/games/src/config/defaults.ts (gamesEnvSchema gained 4 keys)"
    - "services/games/tests/setup.ts (test env defaults gained 4 keys)"
    - "services/games/.env.example (+4 lines)"
    - ".env.example (+4 lines under games section)"
    - "frontend/src/lib/config.ts (configSchema +6 keys; AppConfig +autoBet +leaderboard namespaces; buildConfig wiring)"
    - "frontend/.env.example (+6 lines)"
decisions:
  - "AUTO_BET_MIN_TARGET_CENTI_X stored as integer centi-x (101 = 1.01x) on the backend to match the existing centi-x convention used elsewhere in the schema; FE mirrors the multiplier as a float (.gt(1) default 1.01) because the FE input box reads multiplier units directly."
  - "STOP_LOSS_CENTS_MAX and STOP_WIN_CENTS_MAX defaulted to 100000 (= 1000.00 CRD) — symmetric, matches BET_MAX_CENTS ceiling, and is a generous play-money cap (RESEARCH §Assumptions Log A10)."
  - "LEADERBOARD_UPDATE_THROTTLE_MS defaults to 0 because the projector already throttles via round-settle cadence + top-N diff check (D-04). The knob exists for future per-environment cooldown tuning without code changes."
  - "FE getConfig() nests autoBet + leaderboard as frozen sub-objects mirroring the Phase 8 replay/drawer/fairness nesting precedent — consumers read getConfig().autoBet.minTarget rather than VITE_-prefixed raw env."
  - "Adding setup.ts defaults for the 4 new BE keys ensures the env-frozen const export does not break sibling tests that call `setupGamesTestEnv()` before importing from config/defaults.ts."
metrics:
  duration_minutes: 4
  completed_date: 2026-05-30
  tasks_total: 2
  tasks_complete: 2
  files_created: 2
  files_modified: 6
  tests_added: 13
  tests_total_after_be: 12
  tests_total_after_fe: 175
---

# Phase 9 Plan 01: Phase 9 env layer (4 BE + 6 FE) Summary

Surfaces the 10 new Phase 9 env vars through the existing typed-config pipelines (Zod-parsed `gamesEnvSchema` + Vite `getConfig`), establishing the single source of truth that every downstream Phase 9 plan reads from — no plan may hardcode a stop ceiling, leaderboard refresh cadence, auto-bet target bound, or rank-up transition duration.

---

## Objective Delivered

CLAUDE.md §Configuration is NON-NEGOTIABLE — "No hardcoded business constants". This plan is the gate that lets all subsequent Phase 9 work pull configuration from env without re-deriving the schema. Two atomic GREEN commits land the BE + FE schema extensions; two preceding RED commits prove the validation contracts (1.01x floor, positive stops, nonnegative throttle) by writing the tests first.

---

## Commits

| # | Hash      | Type | Scope | Description                                                                       |
| - | --------- | ---- | ----- | --------------------------------------------------------------------------------- |
| 1 | `f7cbaac` | test | 09-01 | RED — 7 failing tests for 4 BE env keys + bounds                                  |
| 2 | `e8e35ee` | feat | 09-01 | GREEN — gamesEnvSchema extended; tests/setup.ts + both BE .env.example files sync |
| 3 | `dd8b5f7` | test | 09-01 | RED — 6 failing tests for 6 FE VITE_ env keys + bounds                            |
| 4 | `b477b93` | feat | 09-01 | GREEN — configSchema + AppConfig + buildConfig extended; frontend/.env.example sync |

---

## Schema Deltas

### Backend (`services/games/src/config/defaults.ts`)

```ts
LEADERBOARD_UPDATE_THROTTLE_MS: z.coerce.number().int().nonnegative().default(0),
STOP_LOSS_CENTS_MAX:            z.coerce.number().int().positive().default(100000),
STOP_WIN_CENTS_MAX:             z.coerce.number().int().positive().default(100000),
AUTO_BET_MIN_TARGET_CENTI_X:    z.coerce.number().int().min(101).default(101),
```

Floors enforced at parse time:
- `AUTO_BET_MIN_TARGET_CENTI_X = "100"` → throws (1.00x unreachable per UI-SPEC + D-06)
- `STOP_LOSS_CENTS_MAX = "0"` / `STOP_WIN_CENTS_MAX = "0"` → throws
- `LEADERBOARD_UPDATE_THROTTLE_MS = "-1"` → throws

### Frontend (`frontend/src/lib/config.ts`)

```ts
VITE_AUTO_BET_MIN_TARGET:             z.coerce.number().gt(1).default(1.01),
VITE_AUTO_BET_MAX_TARGET:             z.coerce.number().positive().default(100),
VITE_LEADERBOARD_SIZE:                z.coerce.number().int().positive().default(10),
VITE_LEADERBOARD_WINDOW_HOURS:        z.coerce.number().int().positive().default(24),
VITE_LEADERBOARD_RELATIVE_REFRESH_MS: z.coerce.number().int().nonnegative().default(5000),
VITE_RANK_UP_TRANSITION_MS:           z.coerce.number().int().nonnegative().default(200),
```

Nested `AppConfig` exposes:
```ts
autoBet:     { minTarget, maxTarget }
leaderboard: { sizeN, windowHours, relativeRefreshMs, rankUpTransitionMs }
```

Both namespaces frozen (`Object.freeze`) per the Phase 8 precedent.

---

## Verification

| Gate                                            | Command                                                                                   | Result                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| BE Phase 9 schema tests                         | `cd services/games && bun test tests/unit/config-defaults-phase9.test.ts`                 | 7/7 pass, 13 expect                   |
| BE existing config tests still green            | `cd services/games && bun test tests/unit/config-defaults.test.ts`                        | 5/5 pass (regression-free)            |
| BE type check                                   | `cd services/games && bunx tsc --noEmit`                                                  | exit 0                                |
| FE Phase 9 schema tests                         | `cd frontend && bunx vitest run src/lib/config.phase9.test.ts`                            | 6/6 pass                              |
| FE existing config tests still green            | `cd frontend && bunx vitest run src/lib/config.test.ts`                                   | 16/16 pass (regression-free)          |
| FE full suite                                   | `cd frontend && bunx vitest run`                                                          | 175/175 pass (was 169, +6 from plan)  |
| FE type check                                   | `cd frontend && bunx tsc --noEmit`                                                        | exit 0                                |
| FE lint                                         | `cd frontend && bun run lint`                                                             | clean (pre-existing `routeTree.gen.ts` warning out of scope) |
| No phase-9 constants leaked outside env layer   | `grep -RE "100000\|1\.01x?\b" services/games/src/{application,domain} frontend/src/{components,features} \| grep -v test` | no matches                            |
| `.env.example` line additions                   | `git diff` against pre-plan                                                               | exactly 4 BE keys × 2 files + 6 FE keys |

---

## Deviations from Plan

### Path correction (Rule 3 — blocking)

**Found during:** Task 2 entry
**Issue:** Plan frontmatter `files_modified` lists `frontend/src/config.ts` and the action text references `frontend/src/config.phase9.test.ts`. The actual existing file is at `frontend/src/lib/config.ts` (the path established by Phase 7 P07-03 + Phase 8 P08-04 — same module the plan reads in `<read_first>`).
**Fix:** Used the real path `frontend/src/lib/config.ts` + colocated test `frontend/src/lib/config.phase9.test.ts`. Plan text was internally inconsistent (the `<read_first>` already pointed at the lib path); the frontmatter and action text are stale references from the planning skeleton.
**Files affected:** `frontend/src/lib/config.ts`, `frontend/src/lib/config.phase9.test.ts`
**Commits:** `dd8b5f7`, `b477b93`

### Test setup synchronization (Rule 2 — auto-add missing critical functionality)

**Found during:** Task 1 GREEN gate
**Issue:** `services/games/src/config/defaults.ts` exports a frozen `env = gamesEnvSchema.parse(process.env)` at module-load time. Any sibling test that imports from `config/defaults` after a fresh process start would parse against an unset env, so adding 4 new required-shaped keys (even with defaults present) is fine, but `tests/setup.ts` is the established convention for pre-populating env in test runners. Without sync the new defaults would silently behave correctly via the schema's `.default()` clause but the setup file would drift from the schema — a future plan adding a required key with no default would break every sibling test.
**Fix:** Mirrored the 4 new keys into `services/games/tests/setup.ts` with their default values so the test env matches the schema 1:1 (Phase 1 convention).
**Files affected:** `services/games/tests/setup.ts`
**Commits:** `e8e35ee` (bundled into GREEN — same logical change)

### TDD commit cadence (none — followed plan)

Plan tasks both carry `tdd="true"`. Followed the RED/GREEN/(REFACTOR) protocol: failing test commit (RED) then implementation commit (GREEN) per task. No REFACTOR commit needed — both implementations were direct schema extensions with no cleanup pass required.

---

## Auth Gates

None. Plan touched only typed env layers; no Keycloak/network surface.

---

## Architecture Notes for Downstream Plans

1. **Plan 09-02 (autoCashoutTarget DTO):** read `env.AUTO_BET_MIN_TARGET_CENTI_X` for the Zod refinement on `PlaceBetRequestDto.autoCashoutTarget` — the value is integer centi-x (101 = 1.01x), so the DTO refinement compares `Math.round(autoCashoutTarget * 100) >= env.AUTO_BET_MIN_TARGET_CENTI_X` and `autoCashoutTarget <= env.AUTO_CASHOUT_MAX_X` (latter already in the schema since Phase 4 prep).
2. **Plan 09-06 (LeaderboardProjector):** the `LEADERBOARD_UPDATE_THROTTLE_MS = 0` default means "no extra cooldown — fire on every round-settle that shifts the top-N". The knob is in place for ops to dial up cooldown without code changes if production telemetry shows projector pressure.
3. **Plan 09-08 (AutoBetForm):** `getConfig().autoBet.minTarget` (FE float, 1.01) governs the input min attribute / Zod refine; the BE Zod still authoritatively rejects below 1.01x via `AUTO_BET_MIN_TARGET_CENTI_X` (defense in depth — FE config can be tampered in DevTools but the server has no awareness of FE config, per threat T-09-03 mitigation).
4. **Plan 09-09 (LeaderboardPanel):** `getConfig().leaderboard.relativeRefreshMs` powers the "updated Ns ago" footer tick; `rankUpTransitionMs` is the `border-color` CSS transition duration on the rank chip (must be reduced-motion gated at the consumer — config does not enforce that).

---

## Threat Surface Scan

No new threat surface introduced. The 10 new env values are tunables (bounds + cadences) — never secrets. The Zod parse fails closed at boot (BE) / build (FE) on out-of-bound values, satisfying threat T-09-01 mitigation from the plan's `<threat_model>`.

VITE_ keys ship in the browser bundle by design (Vite convention) — same provenance as the 17 existing VITE_ keys already in `frontend/.env.example`. T-09-02 disposition stands at `accept`.

---

## Self-Check: PASSED

| Claim                                                                     | Verification                                  | Status |
| ------------------------------------------------------------------------- | --------------------------------------------- | ------ |
| Backend schema has 4 new keys with locked defaults                        | `bun test tests/unit/config-defaults-phase9.test.ts` 7/7 pass | FOUND  |
| Frontend schema has 6 new keys + autoBet/leaderboard namespaces           | `bunx vitest run src/lib/config.phase9.test.ts` 6/6 pass     | FOUND  |
| Both .env.example files contain the new BE keys                           | `grep STOP_LOSS_CENTS_MAX services/games/.env.example .env.example` matches both | FOUND  |
| frontend/.env.example contains the 6 new FE keys                          | `grep VITE_AUTO_BET_MIN_TARGET frontend/.env.example` matches    | FOUND  |
| No regression in BE existing config-defaults.test.ts                      | 5/5 pass                                       | FOUND  |
| No regression in FE existing suite                                        | 175/175 pass (was 169, +6 from this plan)      | FOUND  |
| RED commit `f7cbaac` exists                                               | `git log --oneline \| grep f7cbaac` matches    | FOUND  |
| GREEN commit `e8e35ee` exists                                             | `git log --oneline \| grep e8e35ee` matches    | FOUND  |
| RED commit `dd8b5f7` exists                                               | `git log --oneline \| grep dd8b5f7` matches    | FOUND  |
| GREEN commit `b477b93` exists                                             | `git log --oneline \| grep b477b93` matches    | FOUND  |
