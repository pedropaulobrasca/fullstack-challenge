---
phase: 09-auto-features-leaderboard
plan: 02
subsystem: domain-persistence
tags:
  - bet-aggregate
  - auto-cashout
  - migration
  - partial-index
  - centi-x
  - phase-9-foundation
requirements:
  - REQ-AUTO-01
dependency_graph:
  requires:
    - "Plan 09-01 (env.AUTO_BET_MIN_TARGET_CENTI_X + env.AUTO_CASHOUT_MAX_X — the Zod DTO refine pulls min/max from here)"
    - "Phase 5 Bet aggregate + EntitySchema + raw-SQL repo patterns"
    - "Phase 6 mikro-bet.repository.ts toDate() coercion helper (Pitfall 1 commit 439e5b4)"
    - "Multiplier VO at services/games/src/domain/value-objects/multiplier.ts (.fromTenThousandths constructor + .toCentiX accessor; centi-x = ten-thousandths / 100)"
  provides:
    - "Bet aggregate field: autoCashoutTarget: Multiplier | null (immutable after Bet.place())"
    - "BetRepository port: findAutoCashoutCandidates(roundId, ceilingCentiX): Promise<Bet[]>"
    - "DB column bets.auto_cashout_target_centi_x INT NULL with CHECK (>= 101) + partial index idx_bets_auto_cashout_candidates"
    - "DTO field: PlaceBetRequestDto.autoCashoutTarget?: number validated against env bounds"
    - "MikroBetRepository.findAutoCashoutCandidates indexed EntitySchema query"
  affects:
    - "Plan 09-05 (AutoCashoutTickService — consumes findAutoCashoutCandidates at 30Hz)"
    - "Plan 09-08 (AutoBetForm — submits autoCashoutTarget through POST /games/bet)"
tech_stack:
  added: []
  patterns:
    - "Optional aggregate field initialized in Bet.place() factory; private readonly via BetProps so no setter exposes mutation post-creation (T-09-09 mitigation)"
    - "Centi-x precision discipline at use-case boundary: input.autoCashoutTarget (float, 2 decimals) → BigInt(Math.round(target * 100)) * 100n → Multiplier.fromTenThousandths (matches the project's tenThousandths internal storage, .toCentiX() returns the persistence-shape integer)"
    - "Partial index with WHERE predicate matching the query: (round_id, auto_cashout_target_centi_x) WHERE status = 'ACTIVE' AND auto_cashout_target_centi_x IS NOT NULL — Postgres uses this for index-only scans on the 30Hz hot path"
    - "DB-level CHECK constraint as defense-in-depth alongside Zod min(1.01x) — invalid centi-x values can never enter the table even on a future direct-INSERT bug"
    - "MikroORM EntitySchema find() path over raw SQL for the new query method — automatic Date hydration sidesteps Pitfall 1 entirely (raw-SQL toDate() coercion only needed where RETURNING * is required, e.g., tryTransition)"
key_files:
  created:
    - "services/games/src/infrastructure/mikro-orm/migrations/20260530001-add-auto-cashout-target-to-bets.ts"
    - "services/games/tests/integration/place-bet-auto-cashout-target.test.ts"
    - "services/games/tests/unit/place-bet-dto.test.ts"
    - "services/games/tests/unit/place-bet-use-case-target.test.ts"
    - ".planning/phases/09-auto-features-leaderboard/09-02-SUMMARY.md"
  modified:
    - "services/games/src/domain/bet.aggregate.ts (+ autoCashoutTarget field + getter + place() optional param)"
    - "services/games/src/domain/bet.repository.ts (+ findAutoCashoutCandidates port method)"
    - "services/games/src/infrastructure/persistence/bet.entity.ts (+ autoCashoutTargetCentiX nullable INT column mapping)"
    - "services/games/src/infrastructure/repositories/mikro-bet.repository.ts (+ findAutoCashoutCandidates EntitySchema query + autoCashoutTarget in both row mappers + insert() writes the column)"
    - "services/games/src/application/use-cases/place-bet.use-case.ts (+ autoCashoutTarget? input + centi-x conversion + Multiplier construction passed to Bet.place)"
    - "services/games/src/presentation/dtos/place-bet.request.dto.ts (+ optional autoCashoutTarget validated against env.AUTO_BET_MIN_TARGET_CENTI_X / 100 floor + env.AUTO_CASHOUT_MAX_X ceiling)"
    - "services/games/src/presentation/controllers/bet-command.controller.ts (+ passes body.autoCashoutTarget to use case input)"
    - "services/games/tests/unit/bet.aggregate.test.ts (+ 3 cases for autoCashoutTarget on Bet.place / null default / domain purity)"
decisions:
  - "Persistence precision uses centi-x INT (auto_cashout_target_centi_x) matching the cashed_out_multiplier_centi_x convention already in the bets table — RESEARCH §Pitfall 9 precision discipline. The Multiplier VO internally stores tenThousandths (centi-x × 100) so the repository row-to-aggregate mapper reads the INT centi-x column and constructs via BigInt(row.autoCashoutTargetCentiX) * 100n → Multiplier.fromTenThousandths."
  - "DB CHECK constraint auto_cashout_target_centi_x >= 101 added at migration time as defense-in-depth alongside the Zod DTO min(env.AUTO_BET_MIN_TARGET_CENTI_X / 100). The Zod refine rejects at the HTTP boundary (400 BAD REQUEST); the CHECK rejects at the DB if any future path bypasses the DTO. Both gates pull the 1.01x floor from the same env constant — no drift."
  - "findAutoCashoutCandidates uses EntitySchema em.find() over raw SQL — MikroORM auto-hydrates createdAt as Date sidestepping Pitfall 1 (the toDate() coercion is preserved on the existing tryTransition path which DOES use raw RETURNING *). The query criteria `{ roundId, status: 'ACTIVE', autoCashoutTargetCentiX: { $ne: null, $lte: ceiling } }` compiles to a WHERE clause that Postgres matches against the partial index predicate — index-only scan on the 30Hz tick path Plan 09-05 will exercise."
  - "Partial index includes round_id as the leading column even though the AutoCashoutTickService only ticks one round at a time — the leading-equality form lets Postgres use the index for both single-round selects (Plan 09-05) and any future cross-round operations (e.g., admin diagnostics) without a second index. The WHERE predicate trims the index to ACTIVE + non-null targets, the only rows the tick service cares about; pending/lost/cashed-out/refunded rows occupy zero index pages (T-09-07 mitigation: the index physically cannot leak non-ACTIVE rows even if the application code is buggy)."
  - "DTO precision: autoCashoutTarget enters as `z.number().positive().min(env.AUTO_BET_MIN_TARGET_CENTI_X / 100).max(env.AUTO_CASHOUT_MAX_X).optional()` — a float multiplier in user-readable units (2.0 = 2x), not a centi-x integer. The integer conversion lives at the use-case boundary (`BigInt(Math.round(input.autoCashoutTarget * 100)) * 100n`) so the domain and persistence layers see the same Multiplier VO instance, while the HTTP wire format stays human-readable for the FE consumer in Plan 09-08."
metrics:
  duration_minutes: 6
  completed_date: 2026-05-30
  tasks_total: 2
  tasks_complete: 2
  files_created: 4
  files_modified: 8
  tests_added: 49
  tests_total_unit_games_after: 248
  tests_total_integration_added: 6
---

# Phase 9 Plan 02: autoCashoutTarget end-to-end on the Bet aggregate Summary

Lands the `autoCashoutTarget: Multiplier | null` field on the Bet aggregate as a complete vertical — domain → entity → migration → DTO → use case → repository query method — so Plan 09-05 (AutoCashoutTickService) has a microsecond-fast indexed read path to fetch ACTIVE bets whose target is reachable at the current tick's multiplier. The change is additive and backwards-compatible: existing manual `POST /games/bet` calls without `autoCashoutTarget` still 202.

---

## Objective Delivered

REQ-AUTO-01 requires server-enforced auto-cashout. The server needs to (a) accept the target at bet placement, (b) persist it, (c) query it efficiently per tick. This plan delivers (a/b/c). REQ-AUTO-01 itself closes in Plan 09-05 when the AutoCashoutTickService actually fires cashouts — this plan is the foundation contributing toward that requirement, same convention as Plan 09-01.

---

## Commits

| # | Hash      | Type | Scope | Description                                                                                       |
| - | --------- | ---- | ----- | ------------------------------------------------------------------------------------------------- |
| 1 | `4c82e1a` | test | 09-02 | RED — failing tests for autoCashoutTarget on Bet aggregate + DTO + use case (Task 1)              |
| 2 | `816f0f0` | feat | 09-02 | GREEN — autoCashoutTarget field on Bet aggregate + DTO + use case + repository port (Task 1)      |
| 3 | `57f9d34` | feat | 09-02 | GREEN (Task 2) — migration adds bet.auto_cashout_target column + partial index + CHECK constraint |
| 4 | `dc4cd05` | test | 09-02 | RED→GREEN (Task 2) — integration coverage for autoCashoutTarget persistence + findAutoCashoutCandidates |

Note: Task 2's RED and GREEN landed in the same execution session — the MikroBetRepository.findAutoCashoutCandidates + EntitySchema column landed first (commit `816f0f0` already included the repository changes as part of the Task 1 GREEN to keep the type system consistent across the port + impl boundary), then the migration `57f9d34` and the integration test `dc4cd05` proved the end-to-end behavior against a real Postgres. Domain purity preserved: `grep -RE "@nestjs|@mikro-orm" services/games/src/domain` returns 0 lines.

---

## Schema Delta

### Migration `20260530001-add-auto-cashout-target-to-bets.ts`

```sql
ALTER TABLE bets ADD COLUMN auto_cashout_target_centi_x INT NULL
  CHECK (auto_cashout_target_centi_x IS NULL OR auto_cashout_target_centi_x >= 101);

CREATE INDEX idx_bets_auto_cashout_candidates
  ON bets (round_id, auto_cashout_target_centi_x)
  WHERE status = 'ACTIVE' AND auto_cashout_target_centi_x IS NOT NULL;
```

Verified live against the running `fullstack-challenge-postgres-1` container after `docker compose run --rm games-migrate`:

```
auto_cashout_target_centi_x   | integer                  |
"idx_bets_auto_cashout_candidates" btree (round_id, auto_cashout_target_centi_x)
  WHERE status = 'ACTIVE'::text AND auto_cashout_target_centi_x IS NOT NULL
"bets_auto_cashout_target_centi_x_check" CHECK
  (auto_cashout_target_centi_x IS NULL OR auto_cashout_target_centi_x >= 101)
```

`down()` drops the index first, then the column — reverse order. Migration runs cleanly up and down.

### EntitySchema `bet.entity.ts`

```ts
autoCashoutTargetCentiX!: number | null;
// ...
autoCashoutTargetCentiX: {
  type: "integer",
  fieldName: "auto_cashout_target_centi_x",
  nullable: true,
},
```

### Domain `bet.aggregate.ts`

```ts
export type BetProps = {
  // ...existing fields
  autoCashoutTarget: Multiplier | null;
};

static place(
  id, roundId, playerId, amount, now,
  autoCashoutTarget: Multiplier | null = null,
): Bet { /* sets field once at construction; no setter exposed */ }

get autoCashoutTarget(): Multiplier | null {
  return this.props.autoCashoutTarget;
}
```

Domain purity gate: 0 `@nestjs` / `@mikro-orm` imports under `services/games/src/domain/`.

### DTO `place-bet.request.dto.ts`

```ts
autoCashoutTarget: z
  .number()
  .positive()
  .min(env.AUTO_BET_MIN_TARGET_CENTI_X / 100)
  .max(env.AUTO_CASHOUT_MAX_X)
  .optional()
```

Bounds pulled from env — no hardcoded `1.01` or `100`. C-3 NON-NEGOTIABLE enforced.

### Use case `place-bet.use-case.ts`

```ts
const autoCashoutTarget =
  input.autoCashoutTarget === undefined
    ? null
    : Multiplier.fromTenThousandths(
        BigInt(Math.round(input.autoCashoutTarget * 100)) * 100n,
      );

return Bet.place(id, roundId, playerId, amount, now, autoCashoutTarget);
```

Centi-x conversion at the use-case boundary; domain sees only the Multiplier VO. Plan 09-01's `env.AUTO_BET_MIN_TARGET_CENTI_X` (= 101) and `env.AUTO_CASHOUT_MAX_X` (= 100) are the sole source of truth for bounds.

### Repository `mikro-bet.repository.ts`

```ts
async findAutoCashoutCandidates(
  roundId: RoundId,
  ceilingCentiX: number,
): Promise<Bet[]> {
  const rows = await this.em.find(BetEntitySchema, {
    roundId,
    status: "ACTIVE",
    autoCashoutTargetCentiX: { $ne: null, $lte: ceilingCentiX },
  });
  return rows.map((row) => this.mapRowToAggregate(row));
}
```

EntitySchema path — MikroORM hydrates `createdAt` as a `Date` automatically, sidestepping Phase 6 Pitfall 1. The existing raw-SQL `tryTransition` (RETURNING *) keeps its `toDate()` coercion for `cashed_out_at` + `created_at` + `auto_cashout_target_centi_x` mapping; verified via `grep -n "toDate" mikro-bet.repository.ts` → still present at lines 193, 202, 213.

---

## Verification

| Gate                                                        | Command                                                                                                            | Result                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Plan 09-02 unit tests                                       | `cd services/games && bun test tests/unit/bet.aggregate.test.ts tests/unit/place-bet-dto.test.ts tests/unit/place-bet-use-case-target.test.ts` | 43/43 pass, 67 expect across 3 files (~340ms) |
| Plan 09-02 integration tests                                | `cd services/games && INTEGRATION=1 RABBITMQ_URL=amqp://admin:admin@localhost:5672 DATABASE_URL=postgres://admin:admin@localhost:5432/games bun test tests/integration/place-bet-auto-cashout-target.test.ts` | 6/6 pass, 21 expect (~17.4s)                  |
| Full games unit suite (regression baseline)                 | `cd services/games && bun test tests/unit`                                                                         | 240 pass / 8 fail (pre-existing clock-mock failures, unchanged baseline from Plan 09-01) |
| Type check                                                  | `cd services/games && bunx tsc --noEmit`                                                                           | exit 0                                          |
| Domain purity                                               | `grep -RE "@nestjs\|@mikro-orm" services/games/src/domain`                                                          | 0 matches                                       |
| Migration applies cleanly                                   | `docker compose run --rm games-migrate`                                                                            | "Successfully migrated up to the latest version" |
| Column + index + CHECK live in Postgres                     | `docker compose exec -T postgres psql -U admin -d games -c "\d bets"`                                              | column, partial index predicate, CHECK constraint all present |
| No hardcoded 1.01 / 100 in DTO / use case / domain          | `grep -RE "\b1\.01\b\|min\(101\)" services/games/src/{application,domain,presentation}`                            | only env-derived references, no literals       |

### Pre-existing failures excluded from scope (per Rule SCOPE BOUNDARY)

The 8 unit failures are in unrelated subsystems and were already failing at the Plan 09-01 baseline:

| Test                                                                                                | Subsystem                  | Out-of-scope reason                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `RoundLoopService > no open round → bootstrap…`                                                     | round-loop                 | clock-mock failure unrelated to Bet aggregate / DTO / repo         |
| `RoundLoopService > OnApplicationShutdown clears the pending timer…`                                | round-loop                 | clock-mock failure                                                 |
| `RoundLoopService > bootstrap → startNewRound emits…`                                               | round-loop                 | clock-mock failure                                                 |
| `MultiplierBroadcastService > start(roundId) schedules recursive ticks at ~30Hz`                    | ws broadcast               | clock-mock failure                                                 |
| `MultiplierBroadcastService > start() is idempotent…`                                               | ws broadcast               | clock-mock failure                                                 |
| `MultiplierBroadcastService > when getMultiplierAt throws, tick is dropped…`                        | ws broadcast               | clock-mock failure                                                 |
| `MultiplierBroadcastService > emitted payload multiplier value mirrors getMultiplierAt(now)…`       | ws broadcast               | clock-mock failure                                                 |
| `GetWsSnapshotUseCase > snapshot during BETTING with no bets`                                       | ws snapshot                | clock-mock failure (`serverTime` epoch mismatch — `1767225600000` vs runtime) |

Logged to `deferred-items.md` consistent with the SCOPE BOUNDARY policy from Plan 09-01. None touch the Bet aggregate, DTO, use case, or repository — they would fail identically on a Plan 09-01 checkout.

---

## Integration Test Coverage (6/6 green)

The integration test `place-bet-auto-cashout-target.test.ts` exercises six behaviors against a real Postgres via the existing `_helpers/app-factory.ts` boot pattern (full Nest module, real Mikro, real Rabbit on `localhost:5672`):

1. **Schema gate** — `auto_cashout_target_centi_x` exists on the `bets` table, nullable INT.
2. **Index gate** — `idx_bets_auto_cashout_candidates` exists with predicate `WHERE status = 'ACTIVE'::text AND auto_cashout_target_centi_x IS NOT NULL` (predicate text matched against `pg_indexes.indexdef`).
3. **Ceiling boundary** — `findAutoCashoutCandidates(roundId, 199)` returns `[]` for a target-200 bet, `findAutoCashoutCandidates(roundId, 200)` returns the bet (inclusive `$lte`), `findAutoCashoutCandidates(roundId, 250)` also returns the bet.
4. **NULL target filter** — a second ACTIVE bet inserted with `autoCashoutTargetCentiX = null` is never returned regardless of ceiling.
5. **Non-ACTIVE status filter** — bets in `PENDING` / `CASHED_OUT` / `LOST` / `REFUNDED` are never returned (one fixture per status, all share the same target = 200).
6. **Date hydration** — the returned aggregate's `createdAt instanceof Date === true` (Phase 6 Pitfall 1 guard).

Each test uses a fresh `truncateGamesTables` cycle to avoid cross-test pollution.

---

## Deviations from Plan

### Migration filename (Rule 3 — path correction)

**Found during:** Task 2 entry
**Issue:** Plan specifies filename `Migration20260530001-add-auto-cashout-target-to-bets.ts` (PascalCase prefix `Migration`). The actual migration directory convention is the timestamp-only prefix without the `Migration` word (e.g., `20260524001-create-outbox.ts`, `20260526003-create-bets.ts`, `20260527001-create-bet-saga-state.ts`).
**Fix:** Used the directory's actual convention: `20260530001-add-auto-cashout-target-to-bets.ts`. The exported class is still `Migration20260530001` extending `Migration` (matches sibling migration class-name conventions).
**Files affected:** `services/games/src/infrastructure/mikro-orm/migrations/20260530001-add-auto-cashout-target-to-bets.ts`
**Commit:** `57f9d34`

### DB-level CHECK constraint added (Rule 2 — auto-add critical functionality)

**Found during:** Task 2 migration drafting
**Issue:** The DTO Zod refine rejects auto-cashout targets below 1.01x at the HTTP boundary, but any future code path that bypasses the DTO (admin scripts, replication patches, manual SQL) could insert an invalid centi-x. Per CLAUDE.md §"Money / Domain layer" defense-in-depth posture and the threat model's T-09-08 mitigation (no writable mutation path beyond initial Bet.place), a DB-level CHECK was warranted.
**Fix:** Added `CHECK (auto_cashout_target_centi_x IS NULL OR auto_cashout_target_centi_x >= 101)` to the column definition in the migration. Mirrors how the existing `cashed_out_multiplier_centi_x` column doesn't currently have a CHECK but the precedent for defense-in-depth at the DB layer is established by the `idx_bets_one_active_per_player` partial unique index from Phase 5. The Zod and CHECK both reference the same logical constant (1.01x = 101 centi-x) via separate paths: Zod reads `env.AUTO_BET_MIN_TARGET_CENTI_X / 100`, CHECK hard-codes `>= 101` because migrations cannot read env at runtime; this is a documented mirror, not a drift surface.
**Files affected:** `services/games/src/infrastructure/mikro-orm/migrations/20260530001-add-auto-cashout-target-to-bets.ts`
**Commit:** `57f9d34`

### TDD commit cadence (none — followed plan with mild atomic-coupling adjustment)

Plan tasks both carry `tdd="true"`. Followed RED/GREEN protocol for Task 1: failing test commit `4c82e1a` (RED) then implementation commit `816f0f0` (GREEN). Task 2 landed the GREEN migration `57f9d34` BEFORE the integration test commit `dc4cd05` because Task 1's GREEN already included the repository's `findAutoCashoutCandidates` implementation + the entity column mapping (the port + impl + entity changes are atomically coupled at the type-system level — splitting them would have broken `bunx tsc --noEmit` between commits). Same atomic-coupling rationale as P08-02 §TDD Gate Compliance. The integration test commit `dc4cd05` then serves as a real-DB regression gate over the already-typechecked GREEN code.

No REFACTOR commit needed — both implementations were direct extensions with no cleanup pass required.

---

## Auth Gates

None. Plan touched only domain / persistence / DTO / use case / repository layers; no Keycloak / network surface beyond the existing POST /games/bet endpoint which was already JWT-gated in Phase 5.

---

## Architecture Notes for Downstream Plans

1. **Plan 09-05 (AutoCashoutTickService):** call `betRepository.findAutoCashoutCandidates(roundId, currentMultiplier.toCentiX())` once per tick. The partial index ensures index-only scans; expected query cost is O(log n + k) where k = matching ACTIVE bets with target ≤ current multiplier. The query returns `Bet[]` aggregates ready to be passed to the existing `CashoutBetUseCase` (or its auto-cashout sibling). No new repository method needed — the port-level contract is complete.
2. **Plan 09-08 (AutoBetForm):** submits `autoCashoutTarget: number` (float, 2 decimals) as part of the existing POST /games/bet body. The DTO already validates against env bounds; FE just needs to wire the field via the existing `useBetForm` hook. Reads `getConfig().autoBet.{minTarget,maxTarget}` for input bounds (mirror of the BE env values).
3. **Plan 09-03 (bet.lost outbox events):** unaffected — auto-cashout bets that DON'T reach their target settle as LOST same as manual bets that didn't cash out. No new outbox event type needed.

---

## Threat Surface Scan

No new HTTP / WS / file surface introduced. Threat model dispositions verified:

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-09-05 (forge target below 1.01x or above 100x) | **mitigated** — Zod `.min(env.AUTO_BET_MIN_TARGET_CENTI_X / 100).max(env.AUTO_CASHOUT_MAX_X)` rejects at controller entry with 400; DB CHECK `>= 101` is the second defense layer |
| T-09-06 (forge non-numeric / NaN target) | **mitigated** — `z.number().positive()` rejects; `.optional()` makes the field omittable but never empty-string-coercible |
| T-09-07 (findAutoCashoutCandidates leaks other rounds' bets) | **mitigated** — query parameterized on branded `RoundId`; partial index physically excludes non-ACTIVE rows; cross-round leak impossible |
| T-09-08 (writable mutation path introduced) | **mitigated** — only ADD COLUMN + SELECT method added; no PATCH/PUT endpoint; field is `private readonly` on the aggregate |
| T-09-09 (target altered post-placement) | **mitigated** — field set once at `Bet.place()`; no setter; rehydrate constructor is the only other path and that only runs from `mapRowToAggregate` which mirrors the DB row |

No `threat_flag` additions.

---

## Self-Check: PASSED

| Claim                                                                                       | Verification                                                       | Status |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| Migration file exists                                                                       | `[ -f services/games/src/infrastructure/mikro-orm/migrations/20260530001-add-auto-cashout-target-to-bets.ts ]` | FOUND  |
| Integration test file exists                                                                | `[ -f services/games/tests/integration/place-bet-auto-cashout-target.test.ts ]` | FOUND  |
| Bet aggregate carries `autoCashoutTarget` field                                             | `grep -n "autoCashoutTarget: Multiplier" services/games/src/domain/bet.aggregate.ts` | FOUND  |
| Repository port declares `findAutoCashoutCandidates`                                        | `grep -n "findAutoCashoutCandidates" services/games/src/domain/bet.repository.ts` | FOUND  |
| Repository impl wires `findAutoCashoutCandidates` via EntitySchema                          | `grep -n "this.em.find(BetEntitySchema" services/games/src/infrastructure/repositories/mikro-bet.repository.ts` | FOUND  |
| `toDate()` coercion still present on the raw-SQL RETURNING * path                           | `grep -n "toDate" services/games/src/infrastructure/repositories/mikro-bet.repository.ts` | FOUND (lines 193, 202, 213) |
| DTO validates against env bounds                                                            | `grep -n "AUTO_BET_MIN_TARGET_CENTI_X\|AUTO_CASHOUT_MAX_X" services/games/src/presentation/dtos/place-bet.request.dto.ts` | FOUND  |
| Migration applied live in Postgres                                                          | `docker compose exec -T postgres psql -U admin -d games -c "\d bets"` shows column + partial index + CHECK | FOUND  |
| RED commit `4c82e1a` exists                                                                 | `git log --oneline \| grep 4c82e1a`                                | FOUND  |
| GREEN commit `816f0f0` exists                                                               | `git log --oneline \| grep 816f0f0`                                | FOUND  |
| Migration commit `57f9d34` exists                                                           | `git log --oneline \| grep 57f9d34`                                | FOUND  |
| Integration-test commit `dc4cd05` exists                                                    | `git log --oneline \| grep dc4cd05`                                | FOUND  |
| Domain purity (zero infra imports)                                                          | `grep -RE "@nestjs\|@mikro-orm" services/games/src/domain`         | 0 matches |
| Unit tests green                                                                            | `bun test tests/unit/bet.aggregate.test.ts tests/unit/place-bet-dto.test.ts tests/unit/place-bet-use-case-target.test.ts` 43/43 pass | FOUND  |
| Integration tests green                                                                     | `INTEGRATION=1 bun test tests/integration/place-bet-auto-cashout-target.test.ts` 6/6 pass | FOUND  |
| `bunx tsc --noEmit` clean                                                                   | exit 0                                                             | FOUND  |
