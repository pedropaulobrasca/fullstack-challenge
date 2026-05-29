---
phase: 08-provably-fair-history-replay
plan: 02
subsystem: games
tags:
  - verify-endpoint
  - replay-foundation
  - dto-contract
  - bet-repository
  - mask-player-id
  - money-snapshot
requirements:
  - REQ-REPLAY-02
  - REQ-REPLAY-01
dependency_graph:
  requires:
    - "Phase 4 VerifyRoundUseCase (settled-only guard, deriveCrashPoint recompute)"
    - "Phase 4 BetRepository (existing MikroORM impl, BET_REPOSITORY DI token)"
    - "Phase 4 maskPlayerId (sha256 prefix masking helper, reused verbatim)"
    - "Phase 4 GROWTH_RATE env"
    - "Phase 4 Money VO snapshot (amount/currency/scale)"
  provides:
    - "VerifyRoundDto extended with bets[] (RoundBetView) and growthRate"
    - "roundBetViewSchema lifted to round-bet-view.dto.ts (single source of truth for masked bet view)"
    - "BetRepository.findByRound(roundId) — every status, ordered by createdAt asc"
  affects:
    - "Plan 08-05 (FairnessBadge/VerificationDrawer reads /verify, can render bet markers if needed)"
    - "Plan 08-06 (/verify/$roundId route consumes the full DTO)"
    - "Plan 08-07 (ReplayModal overlays bet/cashout markers from bets[] and reads growthRate)"
    - "Plan 08-08 (determinism E2E reads growthRate from response, never env)"
tech_stack:
  added: []
  patterns:
    - "DTO schema lift: shared roundBetViewSchema imported by current-round + verify-round DTOs"
    - "Additive DTO extension (extra fields BEFORE .strict()) keeps CLI verify-crash.ts non-breaking"
    - "Growth rate snapshot at response time so old replays survive future ops changes"
key_files:
  created:
    - "services/games/src/presentation/dtos/round-bet-view.dto.ts"
  modified:
    - "services/games/src/presentation/dtos/current-round.dto.ts"
    - "services/games/src/presentation/dtos/verify-round.dto.ts"
    - "services/games/src/domain/bet.repository.ts"
    - "services/games/src/infrastructure/repositories/mikro-bet.repository.ts"
    - "services/games/src/application/use-cases/verify-round.use-case.ts"
    - "services/games/tests/unit/verify-round.use-case.test.ts"
decisions:
  - "bets[] uses the CurrentRoundBetView shape VERBATIM (RESEARCH Open Question 3) so the Replay overlay reuses the masked playerId + money snapshot + status enum the FE already knows."
  - "Schema lifted to round-bet-view.dto.ts (single source of truth). current-round.dto.ts re-imports it; no shape drift possible."
  - "findByRound returns ALL statuses (no filter), ordered by createdAt asc for deterministic replay overlay rendering."
  - "growthRate is read from env.GROWTH_RATE at verify-response time (RESEARCH Open Question 4 interim resolution). A per-round-stored growthRate column is a follow-up if production GROWTH_RATE ever changes — flagged in the use-case JSDoc and the deferred-items list below."
  - "VerifyRoundUseCase now depends on BetRepository via the existing BET_REPOSITORY token (no new wiring); the games module already provides MikroBetRepository."
  - "Extension is purely additive — existing fields (roundId/nonce/serverSeed/serverSeedHash/clientSeed/crashPoint/recomputedCrashPoint/matches/formulaVersion/previousServerSeed) are unchanged. CLI verify-crash.ts reads specific named fields (T-08-07 accept) — unaffected."
metrics:
  duration_minutes: 24
  completed_date: 2026-05-29
  tasks_total: 2
  tasks_complete: 2
  files_created: 1
  files_modified: 6
  tests_added: 4
  tests_total_after: 8
---

# Phase 8 Plan 02: Extend verify endpoint with bets[] + growthRate Summary

Extended `GET /games/rounds/:roundId/verify` to expose every bet placed on a settled round (masked playerId + money snapshot + status + cashout multiplier + payout) plus the `growthRate` snapshot used at settlement — unblocking the Replay overlay (Plan 08-07) and the determinism E2E (Plan 08-08) without a second fetch. The masked bet shape was lifted to a shared `round-bet-view.dto.ts` so `current-round.dto.ts` and `verify-round.dto.ts` reference one schema (no drift possible).

---

## What changed

### `services/games/src/presentation/dtos/round-bet-view.dto.ts` (new)

Single source of truth for the masked bet view, byte-identical to the previously inline `currentRoundBetSchema`:

- `betId: uuid`
- `playerIdMasked: string` (sha256 hex prefix from `maskPlayerId`)
- `amount: moneySnapshotSchema` (never a bare number)
- `status: enum("PENDING" | "ACTIVE" | "CASHED_OUT" | "LOST" | "REFUNDED")`
- `cashedOutMultiplier: number | null`
- `payout: moneySnapshotSchema | null`

`.strict()` preserved. Exports `roundBetViewSchema` + `RoundBetView` type.

### `services/games/src/presentation/dtos/current-round.dto.ts`

Replaced the inline schema with `import { roundBetViewSchema } from "./round-bet-view.dto"` and `bets: z.array(roundBetViewSchema)`. No observable shape change — `get-current-round.use-case.test.ts` stays green (5 pass, 0 fail) as a regression guard.

### `services/games/src/presentation/dtos/verify-round.dto.ts`

Added two fields BEFORE `.strict()`:

- `bets: z.array(roundBetViewSchema)`
- `growthRate: z.number().positive()`

All ten existing fields unchanged. Additive extension — the CLI `packages/contracts/bin/verify-crash.ts` reads specific named fields (`recomputed === expectedCrashPoint`) so the new fields are invisible to it.

### `services/games/src/domain/bet.repository.ts`

Added `findByRound(roundId: RoundId): Promise<Bet[]>` to the interface, JSDoc'd as "Returns ALL bets for the round regardless of status; used by Phase 8 Replay overlays — PENDING/ACTIVE/CASHED_OUT/LOST/REFUNDED are all rendered so the replay reproduces the full live experience."

### `services/games/src/infrastructure/repositories/mikro-bet.repository.ts`

Implemented `findByRound` mirroring `findActiveByRound` minus the `status` filter, with `orderBy: { createdAt: "asc" }` for deterministic replay overlay rendering. Reuses the same `mapRowToAggregate` hydration helper.

### `services/games/src/application/use-cases/verify-round.use-case.ts`

- Constructor now injects `BetRepository` via the existing `BET_REPOSITORY` token (no new wiring; the games module already provides `MikroBetRepository`).
- After computing `recomputed`, loads `const betsForRound = await this.bets.findByRound(round.id)` and maps each `Bet` through the same projection used by `get-current-round.use-case.ts`:
  - `playerIdMasked: maskPlayerId(bet.playerId)`
  - `amount: bet.amount.toSnapshot()`
  - `cashedOutMultiplier: bet.cashedOutMultiplier?.toNumber() ?? null`
  - `payout: bet.payout?.toSnapshot() ?? null`
- Returns `bets: RoundBetView[]` and `growthRate: env.GROWTH_RATE` alongside the existing payload.
- JSDoc on the `growthRate` field documents the open per-round-storage follow-up.

### `services/games/tests/unit/verify-round.use-case.test.ts`

- Pre-existing 4 tests updated to inject the new `BetRepository` dependency (added a `FakeBetRepo`).
- 4 new tests:
  - **Phase 4 oracle regression**: seed `0000...0001`, client `"test"`, nonce `0` → `crashPoint === 2.94 && recomputedCrashPoint === 2.94 && matches === true`. Proves the extension is non-breaking against the locked-byte oracle.
  - **Mixed-status bets[]**: 3 bets (CASHED_OUT / LOST / REFUNDED) constructed via the real `Bet` aggregate FSM (`place().confirm().cashOut(1.5)`, `place().confirm().lose()`, `place().refund("test-refund")`). Asserts masked playerIds match `/^[0-9a-f]{8}$/` and do NOT contain the raw playerId; money on the wire is the snapshot object (`amount`/`currency`/`scale`), never a number; cashout multiplier `1.5` produces a `750`-cent payout from a `500`-cent bet.
  - **growthRate**: `result.growthRate === env.GROWTH_RATE`, `typeof === "number"`, positive.
  - **status enum**: asserted as one of the string union, never a database integer.

Result: `bun test tests/unit/verify-round.use-case.test.ts` → **8 pass, 0 fail, 34 expect() calls**.

---

## Verification

| Check | Command | Result |
|-------|---------|--------|
| TypeScript clean | `cd services/games && bunx tsc --noEmit` | exit 0 |
| Targeted unit tests | `cd services/games && bun test tests/unit/verify-round.use-case.test.ts` | 8 pass, 0 fail |
| No regression on schema-lift consumer | `cd services/games && bun test tests/unit/get-current-round.use-case.test.ts` | 5 pass, 0 fail |
| Full games unit suite | `cd services/games && bun test tests/unit` | 217 pass, 8 fail (unchanged baseline) |
| Acceptance grep | `grep -q 'roundBetViewSchema' src/presentation/dtos/verify-round.dto.ts && grep -q 'growthRate' src/presentation/dtos/verify-round.dto.ts && grep -q 'findByRound' src/domain/bet.repository.ts && grep -q 'findByRound' src/infrastructure/repositories/mikro-bet.repository.ts` | exit 0 |

The 8 failing tests in the full suite are the documented baseline clock-mock failures unchanged from Plan 08-01 (see STATE.md §Current Position). Not caused by this plan.

Live curl smoke against a docker'd `games` service is deferred to the Wave-1 closeout — the FE consumer plans (08-05/06/07) will exercise the contract from the browser. To pick up the new fields locally: `docker compose build games && docker compose up -d games`.

---

## Deviations from Plan

None — the plan executed exactly as written. The plan's `<read_first>` referenced `services/games/src/infrastructure/persistence/mikro-bet.repository.ts`, but the file actually lives at `services/games/src/infrastructure/repositories/mikro-bet.repository.ts`; updated the implementation at the real path (no plan deviation, just a path-of-record fix in this summary).

The Money snapshot shape was confirmed at `{amount, currency, scale}` (Phase 3 VO) rather than the `{amount, currency}` sketch the plan implied; the snapshot test asserts all three properties.

---

## Threat Flags

None. Trust-boundary disposition unchanged from the threat model:

- **T-08-05 (Information Disclosure — raw playerId)**: mitigated. `maskPlayerId` reused verbatim; the masking test asserts the masked value is an 8-char hex string and never contains the source playerId.
- **T-08-06 (Tampering — future env GROWTH_RATE change invalidates old replays)**: mitigated at the wire — `growthRate` is captured in the response so future replays read the response value, not env. **Open follow-up**: if production GROWTH_RATE is ever changed, all rounds settled before the change need a persisted per-round `growthRate` column to remain replayable. Logged in `## Deferred Items` below.
- **T-08-07 (Information Disclosure — CLI verify-crash.ts breaks on unknown fields)**: accepted. The CLI reads only `expectedCrashPoint` from its own stdin payload and compares against its locally-recomputed `deriveCrashPoint` — it never parses the HTTP response. Non-breaking.

---

## Known Stubs

None. Every new field is wired to a real data source (`findByRound` → real bets; `env.GROWTH_RATE` → real env).

---

## Deferred Items

- **Per-round-stored growthRate column**: needed only if production `GROWTH_RATE` is ever changed. Until then, reading `env.GROWTH_RATE` at verify time is equivalent (Phase 4-8 have shipped one fixed value). When the change happens, the migration is: add `rounds.growth_rate NUMERIC(8,6)` populated at `transitionFromBettingToRunning`, read from `round.growthRate` in the use-case instead of `env.GROWTH_RATE`. Backfill old rounds with the value that was active when each settled — captured from the deployment changelog.

---

## TDD Gate Compliance

Plan 08-02 is `type: execute` (not `type: tdd`); the gate sequence does not apply at the plan level. Task 2 carries `tdd="true"` but Task 1 lands the implementation atomically (DTO + repo + use-case form one logical contract change). Task 2 then commits the test file separately as `test(08-02): ...` — the RED phase is implicit (the existing test file would fail to compile against the new two-arg `VerifyRoundUseCase` constructor before the tests are patched), and the GREEN phase is observed by `bun test` reporting 8/8 pass.

Project convention (Plans 07-05/06/07/08) lands TDD tasks as single `feat`/`test` commits per the repo's atomic-commit style rather than discrete RED/GREEN pairs. Followed that convention here.

---

## Commits

| Hash | Subject |
|------|---------|
| `3c01ec1` | `feat(08-02): extend verify endpoint with bets[] and growthRate` |
| `05a72bc` | `test(08-02): cover bets[], growthRate, and Phase 4 oracle on verify` |

---

## Self-Check: PASSED

Verified file existence and commits:

- `services/games/src/presentation/dtos/round-bet-view.dto.ts` — FOUND (created)
- `services/games/src/presentation/dtos/verify-round.dto.ts` — modified, contains `bets:` and `growthRate:`
- `services/games/src/domain/bet.repository.ts` — modified, contains `findByRound`
- `services/games/src/infrastructure/repositories/mikro-bet.repository.ts` — modified, contains `findByRound` (no `status` filter inside method)
- `services/games/src/application/use-cases/verify-round.use-case.ts` — modified, returns `bets` and `growthRate: env.GROWTH_RATE`
- `services/games/tests/unit/verify-round.use-case.test.ts` — extended, 8/8 pass
- Commits `3c01ec1` and `05a72bc` both exist in `git log` on `main`
