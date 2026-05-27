---
phase: 05-saga-integration
plan: 07
subsystem: games / application (background driver)
tags: [saga, timeout, sweeper, for-update-skip-locked, recursive-settimeout, req-saga-03]
requires:
  - 05-03 (BetSagaStateRepository.claimExpired + BetSagaState aggregate + BET_SAGA_REPOSITORY token)
  - 05-04 (PlaceBetUseCase produces DEBIT_PENDING sagas this sweeper expires)
  - 05-05 (WalletDebitedHandler compensation branch catches late wallet.debited after TIMED_OUT)
  - Phase 4 (BetRepository.tryTransition atomic PENDING -> REFUNDED with patch.refundReason)
  - Phase 2 (OutboxRepository.add 3-arg with txEm)
provides:
  - "SagaTimeoutSweeper: OnApplicationBootstrap + OnApplicationShutdown background driver; recursive setTimeout at SAGA_SWEEP_INTERVAL_MS"
  - "Per-tick sweep: em.transactional → sagas.claimExpired(100, now, txEm) FOR UPDATE SKIP LOCKED → per row: bet PENDING→REFUNDED (patch.refundReason='SAGA_TIMEOUT') + saga DEBIT_PENDING→TIMED_OUT + outbox bet.refunded"
  - "Race-loss + defensive-skip branches: bets.tryTransition null → continue; sagas.transition null → continue without outbox emission"
  - "SAGA_SWEEP_INTERVAL_MS env var (default 1000) typed in games zod schema and documented in root + games .env.example"
affects:
  - 05-09 (live integration test: kill-9 reconciliation scenario #3 + #4 will drive the sweeper end-to-end against a real broker + DB)
  - 05-10 (Phase 6 WS gateway will consume bet.refunded emitted here; sweeper + WalletDebitRejectedHandler share envelope type)
tech-stack:
  added: []
  patterns:
    - "Recursive setTimeout (NOT setInterval) — mirrors RoundLoopService per ADR-017; avoids overlapping ticks when sweep duration > interval"
    - "OnApplicationBootstrap (NOT OnModuleInit) — guarantees other providers + AMQP topology are wired before the sweeper starts polling (PITFALLS Pitfall 5)"
    - "FOR UPDATE SKIP LOCKED LIMIT 100 — single-instance scheduling now, Phase 10 scale-out forward-compatible"
    - "scheduleAt(ms) re-fires in .finally() so a transient sweep failure doesn't halt the loop"
key-files:
  created:
    - services/games/src/application/saga-timeout-sweeper.service.ts
    - services/games/tests/unit/saga-timeout-sweeper.test.ts
  modified:
    - services/games/src/config/defaults.ts
    - services/games/.env.example
    - .env.example
    - services/games/src/application/game-core.module.ts
    - services/games/tests/setup.ts
decisions:
  - "Sweeper emits a deterministic bet.refunded envelope: same type/exchange/routingKey as WalletDebitRejectedHandler so the Phase 6 WS gateway has a single consumer path for both refund causes (timeout vs broker-rejection). The payload's reason field discriminates them ('SAGA_TIMEOUT' vs 'INSUFFICIENT_FUNDS' / 'WALLET_NOT_FOUND')."
  - "playerId added to outbox payload by reading from the refunded bet returned by tryTransition. The sweeper does NOT do a second findById call — tryTransition already returns the full aggregate, so the player identifier is free."
  - "causationId is randomUUID() since the sweep is a self-initiated periodic tick with no inbound message to chain from. correlationId reuses saga.correlationId so the original PlaceBet → Wallet.debit → timeout chain stays traceable end-to-end."
  - "transactional happens once per tick (not per row). All N refunds within a tick share one TX; if any single row's outbox write throws, the whole tick rolls back and re-runs next interval. SKIP LOCKED prevents the rollback from blocking another worker (Phase 10 carry-forward)."
  - "claimLimit hardcoded at 100 per Phase 5 plan threat model T-05-07-D — 100 refunds/sec/instance is sufficient for challenge load. Not env-promoted because no scenario in the requirements documents tuning it; promotion is a deliberate Phase 10 ADR if needed."
metrics:
  duration_minutes: 8
  completed: 2026-05-27
  tasks: 2
  files_created: 2
  files_modified: 5
  tests_added: 5
---

# Phase 05 Plan 07: SagaTimeoutSweeper Summary

REQ-SAGA-03 lands. A `bet_saga_state` row stuck in DEBIT_PENDING past its deadline (no Wallet reply within SAGA_TIMEOUT_MS=5000) now gets auto-refunded by a background sweeper that:

1. Wakes up every SAGA_SWEEP_INTERVAL_MS (default 1000ms),
2. Opens a single transaction,
3. Claims up to 100 expired DEBIT_PENDING rows via `FOR UPDATE SKIP LOCKED`,
4. For each claimed row, atomically: transitions the Bet PENDING→REFUNDED (with refundReason='SAGA_TIMEOUT'), transitions the saga DEBIT_PENDING→TIMED_OUT, and emits a `bet.refunded` outbox envelope routed at `game.events` / `bet.refunded`.

Combined with the compensation branch already shipped in plan 05-05 (`WalletDebitedHandler` catches the late `wallet.debited` arriving after TIMED_OUT and emits a compensating `wallet.credit`), the saga is closed under every Wallet-side outcome: success-in-time, broker-rejection, slow-success, or full timeout. Money cannot be lost.

## What Shipped

### Task 1 — SAGA_SWEEP_INTERVAL_MS env var

- `services/games/src/config/defaults.ts` — new `SAGA_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(1000)`, placed adjacent to `SAGA_TIMEOUT_MS`.
- `.env.example` (root) and `services/games/.env.example` — both document `SAGA_SWEEP_INTERVAL_MS=1000` with a Phase 5 inline comment.
- `services/games/tests/setup.ts` — applyDefaults() sets the env var for unit tests so importing `config/defaults` from a test process doesn't fail the zod parse.
- Wallets service env intentionally untouched — sweeper is games-only.

### Task 2 — SagaTimeoutSweeper service + tests + module wiring (TDD)

- `services/games/src/application/saga-timeout-sweeper.service.ts` (~115 lines):
  - `@Injectable()` implementing `OnApplicationBootstrap, OnApplicationShutdown`.
  - Private `timer: ReturnType<typeof setTimeout> | null`, `running: boolean` flag.
  - `onApplicationBootstrap` sets running=true and schedules first tick at SAGA_SWEEP_INTERVAL_MS.
  - `onApplicationShutdown` sets running=false and `clearTimeout` the pending timer.
  - `sweep()` is public for unit tests; opens a single `em.transactional`, claims with `claimExpired(100, new Date(), txEm)`, iterates, applies the two atomic transitions + outbox add per row.
  - `scheduleAt(ms)` is the recursive driver — uses `.catch` to swallow + log errors and `.finally` to re-schedule (so a transient DB / outbox failure does NOT stop the loop).
- `services/games/src/application/game-core.module.ts` — adds `SagaTimeoutSweeper` to providers. NOT exported (it's a singleton driver; Nest's lifecycle hooks fire it).
- `services/games/tests/unit/saga-timeout-sweeper.test.ts` — 5 tests, 36 expect calls:
  1. Happy path: 2 claimed sagas → 2 bet transitions + 2 saga transitions + 2 outbox writes; payload `{ betId, playerId, reason: 'SAGA_TIMEOUT' }`; correlationId reused from saga; route `game.events` / `bet.refunded` / aggregateType `Bet`.
  2. Race-lost (bets.tryTransition returns null on first row): saga.transition + outbox skipped for row 0; row 1 still processes.
  3. Defensive saga.transition returns null: outbox skipped, no throw.
  4. claimExpired throws: sweep propagates (logged + retried by scheduleAt.catch).
  5. onApplicationShutdown after bootstrap halts further scheduling — claimExpired call count stable across a 50ms wait.

## Verification

- `bun test tests/unit/saga-timeout-sweeper.test.ts` — **5 PASS / 0 FAIL** (36 expect calls).
- `bun test tests/unit` (full games unit suite) — **165 PASS / 0 FAIL** (548 expect calls).
- `bunx tsc --noEmit` — clean.
- Live AMQP / DB sweep verification deferred to Plan 05-09 (scenarios #3 timeout-reconciliation and #4 compensation-after-timeout).

## Commits

- `02d8fa4` chore(05-07): add SAGA_SWEEP_INTERVAL_MS env var (default 1000ms)
- `571b129` test(05-07): add failing tests for SagaTimeoutSweeper
- `b1b4d2e` feat(05-07): implement SagaTimeoutSweeper with recursive setTimeout and FOR UPDATE SKIP LOCKED claim

## Deviations from Plan

**[Rule 3 — Blocking issue] tests/setup.ts also needed SAGA_SWEEP_INTERVAL_MS**

- **Found during:** Task 1 verification — after adding the var to the zod schema, the existing unit tests that import `config/defaults` (transitively through the sweeper module under test) would crash at parse time in the bun test process unless setup.ts seeded a default.
- **Issue:** Plan listed `services/games/src/config/defaults.ts` + `.env.example` + `services/games/.env.example` but not `tests/setup.ts`.
- **Fix:** Added `process.env.SAGA_SWEEP_INTERVAL_MS ??= "1000"` in setup's `applyDefaults`.
- **Files modified:** `services/games/tests/setup.ts`.
- **Commit:** `02d8fa4` (folded into the env var commit since it's the same logical change — wiring the new env var to all consumers).

**[Plan refinement] Sweeper outbox payload carries playerId by reading the refunded bet aggregate, not a second findById**

- **Reason:** `bets.tryTransition` already returns the full Bet aggregate (per Phase 4 contract — `MikroBetRepository.tryTransition` does `RETURNING *`). The plan's `<action>` step 2 specified payload `{ betId, reason: 'SAGA_TIMEOUT' }` without playerId, but the WalletDebitRejectedHandler envelope (which Phase 6 will consume alongside the sweeper's emissions) carries playerId. Adding it here keeps both `bet.refunded` envelopes shape-equivalent.
- **Impact:** None — no extra DB roundtrip, no new dependency. Just a fuller payload that better matches the sibling handler.

No other deviations.

## Authentication Gates

None.

## Threat Surface Check

No new external surface. Sweeper runs inside games-service on the trusted broker side. Plan's threat model holds:

- **T-05-07-R (two sweepers refund same row):** `FOR UPDATE SKIP LOCKED` on `claimExpired`; single instance in Phase 5; SQL pattern is Phase 10 scale-out compatible.
- **T-05-07-RACE (sweeper + WalletDebitedHandler both refund):** `bets.tryTransition` returns null on the losing side; sweeper logs warn + skips; WalletDebitedHandler enters the TIMED_OUT branch and emits the compensating `wallet.credit`.
- **T-05-07-D (sweep blocks too long):** LIMIT 100 + 1s interval → worst-case 100 refunds/sec/instance is well within challenge load.
- **T-05-07-LOSS (money loss on slow wallet):** Compensation branch in WalletDebitedHandler (plan 05-05) is the safety net. Verified at unit level in 05-05's test 2 (TIMED_OUT saga → emits compensating wallet.credit).

## Self-Check: PASSED

Verified on disk:

- FOUND: services/games/src/application/saga-timeout-sweeper.service.ts (SagaTimeoutSweeper class with OnApplicationBootstrap + OnApplicationShutdown + sweep + scheduleAt)
- FOUND: services/games/tests/unit/saga-timeout-sweeper.test.ts (5 tests, 36 expect calls)
- FOUND: SAGA_SWEEP_INTERVAL_MS in services/games/src/config/defaults.ts (zod schema)
- FOUND: SAGA_SWEEP_INTERVAL_MS=1000 in .env.example and services/games/.env.example
- FOUND: SagaTimeoutSweeper registered as provider in services/games/src/application/game-core.module.ts
- FOUND commits in git history: 02d8fa4, 571b129, b1b4d2e

## TDD Gate Compliance

- **RED:** `571b129` `test(05-07): add failing tests for SagaTimeoutSweeper` — verified failing (`Cannot find module ../../src/application/saga-timeout-sweeper.service`).
- **GREEN:** `b1b4d2e` `feat(05-07): implement SagaTimeoutSweeper with recursive setTimeout and FOR UPDATE SKIP LOCKED claim` — verified 5/5 pass + 165/165 full unit suite + bunx tsc clean.
- **REFACTOR:** not needed. The sweep + scheduleAt pair is the minimal RoundLoopService-shape pattern — no duplication, no extracted helper would simplify it.
