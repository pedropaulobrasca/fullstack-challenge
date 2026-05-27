---
phase: 05-saga-integration
plan: 03
subsystem: games / domain + infrastructure + application
tags: [saga, persistence, fsm, mikro-orm, for-update-skip-locked, req-saga-02]
requires:
  - bets table (Phase 4 — FK target for bet_saga_state.bet_id)
  - MikroORM 7 EntitySchema pattern (Phase 4)
  - em.getTransactionContext() raw-SQL bind pattern (P3.09 carry-forward)
provides:
  - "bet_saga_state table with 5-status CHECK + UNIQUE(correlation_id) + partial deadline index"
  - "BetSagaState aggregate enforcing FSM: DEBIT_PENDING -> CONFIRMED | REFUNDED | TIMED_OUT, TIMED_OUT -> COMPENSATED"
  - "BetSagaStateRepository interface + MikroBetSagaStateRepository (atomic UPDATE-RETURNING, FOR UPDATE SKIP LOCKED claim)"
  - "BET_SAGA_REPOSITORY DI token registered in GameCoreModule"
  - "IllegalBetSagaTransitionError, BetSagaNotFoundError, SagaTimeoutError domain errors"
affects:
  - 05-04 (sweeper will consume claimExpired)
  - 05-05 (handlers will consume transition + findByCorrelationId)
  - 05-07 (TIMED_OUT compensation path)
tech-stack:
  added: []
  patterns:
    - "Partial index on deadline_at filtered by status='DEBIT_PENDING' — sweeper-only index avoids bloat once rows reach terminal status"
    - "Atomic UPDATE ... WHERE bet_id=? AND status=? RETURNING bound to txEm.getTransactionContext() — mirrors MikroBetRepository.tryTransition (P4)"
    - "FOR UPDATE SKIP LOCKED single-instance now, scale-out forward-compatible"
key-files:
  created:
    - services/games/src/infrastructure/mikro-orm/migrations/20260527001-create-bet-saga-state.ts
    - services/games/src/infrastructure/persistence/bet-saga-state.entity.ts
    - services/games/src/domain/bet-saga-state.aggregate.ts
    - services/games/src/domain/bet-saga-state.repository.ts
    - services/games/src/infrastructure/repositories/mikro-bet-saga-state.repository.ts
    - services/games/tests/unit/bet-saga-state.aggregate.test.ts
  modified:
    - services/games/src/domain/errors.ts
    - services/games/src/application/tokens.ts
    - services/games/src/application/game-core.module.ts
    - services/games/mikro-orm.config.ts
decisions:
  - "Explicit CHECK constraint name bet_saga_state_status_check (forensics — match the P4.11 naming style); avoids opaque autonames"
  - "FK on bet_id is DDL-only (ON DELETE CASCADE), not in EntitySchema — mirrors bets.round_id treatment in Phase 4"
  - "Aggregate exposes only the 4 legal transitions as named methods (no generic transitionTo) — illegal target paths are unreachable from the public API"
  - "rehydrate is the only path that bypasses FSM; create() always lands in DEBIT_PENDING; updatedAt is wall-clock at construction"
metrics:
  duration_minutes: 18
  completed: 2026-05-27
  tasks: 3
---

# Phase 05 Plan 03: BetSagaState Foundation Summary

Persistent saga-state foundation for REQ-SAGA-02. Lands the new `bet_saga_state` table, the FSM aggregate, the repository contract, the Mikro implementation with atomic UPDATE-RETURNING and FOR UPDATE SKIP LOCKED, and the DI wiring — every subsequent Phase 5 plan composes on top of this.

## What changed

### Migration + EntitySchema (Task 1)

`20260527001-create-bet-saga-state.ts` creates the table with:

- `bet_id UUID PRIMARY KEY REFERENCES bets(id) ON DELETE CASCADE`
- `correlation_id TEXT NOT NULL` plus `UNIQUE INDEX bet_saga_state_correlation_id_idx`
- `status TEXT NOT NULL CONSTRAINT bet_saga_state_status_check CHECK (status IN (...))` — five legal values
- `deadline_at TIMESTAMPTZ NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Partial index `bet_saga_state_deadline_idx ON (deadline_at) WHERE status='DEBIT_PENDING'` for the sweeper

`BetSagaStateEntitySchema` mirrors the Phase 4 EntitySchema construction (no FK relationship object — FK lives in DDL only).

### Aggregate + errors + repository interface (Task 2)

`BetSagaState` is a pure aggregate:

- Private constructor + `create({ betId, correlationId, deadlineAt })` factory (always lands in `DEBIT_PENDING`)
- `rehydrate(props)` bypasses FSM for repository reads
- Four named transition methods (`confirm`, `refund`, `timeOut`, `compensate`) — each routes through one private guard that throws `IllegalBetSagaTransitionError(from, to)` when the precondition fails
- Zero infrastructure imports

`errors.ts` adds three saga errors:

- `IllegalBetSagaTransitionError` (code `ILLEGAL_BET_SAGA_TRANSITION`, carries `from` / `to`)
- `BetSagaNotFoundError` (code `BET_SAGA_NOT_FOUND`, carries `correlationId`)
- `SagaTimeoutError` (code `SAGA_TIMEOUT`)

`BetSagaStateRepository` interface documents `txEm` semantics per method (required for writes, optional for reads).

### Mikro implementation + module wiring (Task 3)

`MikroBetSagaStateRepository`:

- `create` uses `em.insert` for a single-row insert that participates in the caller TX
- `findByCorrelationId` / `findByBetId` use `em.findOne` (read path, `txEm` optional)
- `transition` runs `UPDATE bet_saga_state SET status=?, updated_at=now() WHERE bet_id=? AND status=? RETURNING ...` bound to `txEm.getTransactionContext()`. Returns `null` on losing race
- `claimExpired` runs `SELECT ... WHERE status='DEBIT_PENDING' AND deadline_at < ? ORDER BY deadline_at LIMIT ? FOR UPDATE SKIP LOCKED` — same TX bind
- All raw SQL goes through `getTransactionContext()` per the P3.09 carry-forward (otherwise the connection autocommits and the same-TX invariant breaks)

`tokens.ts` adds `BET_SAGA_REPOSITORY`. `game-core.module.ts` adds `BetSagaStateEntitySchema` to `forFeature`, provides the `useClass` binding, and exports the token. `mikro-orm.config.ts` registers the schema so the migration glob picks it up at boot.

## Test results

`bun test tests/unit/bet-saga-state.aggregate.test.ts` — 10 / 10 pass (the plan called for 8 scenarios; the implementation split scenario 6 into a positive assertion + a separate from/to introspection assertion, and added a CONFIRMED-after-CONFIRMED guard for completeness):

1. `create` lands in `DEBIT_PENDING` with supplied fields
2. `confirm()` on DEBIT_PENDING → CONFIRMED
3. `refund()` on DEBIT_PENDING → REFUNDED
4. `timeOut()` on DEBIT_PENDING → TIMED_OUT
5. `timeOut().compensate()` → COMPENSATED
6. `compensate()` on CONFIRMED throws `IllegalBetSagaTransitionError` with `from='CONFIRMED'` `to='COMPENSATED'`
7. `confirm()` on CONFIRMED throws
8. `confirm()` on REFUNDED throws
9. `confirm()` on COMPENSATED throws
10. `rehydrate(row)` reconstructs an aggregate matching the row status without firing transitions

Full games unit suite: **138 / 138 pass**. `bunx tsc --noEmit` clean.

Live migration verification deferred to Plan 05-10 smoke checkpoint (the migration will run on next `bun run docker:up`).

## Deviations from Plan

None — plan executed exactly as written.

The plan listed 8 behaviors; the test file actually contains 10 cases because the illegal-transition coverage was split into one positive `from`/`to` introspection test plus three separate "confirm() after terminal" assertions for CONFIRMED, REFUNDED, COMPENSATED. The behavior surface matches the plan; the count is higher because each terminal status got its own test case for clearer failure messages.

## Authentication Gates

None.

## Self-Check: PASSED

Verified:
- `services/games/src/infrastructure/mikro-orm/migrations/20260527001-create-bet-saga-state.ts` FOUND
- `services/games/src/infrastructure/persistence/bet-saga-state.entity.ts` FOUND
- `services/games/src/domain/bet-saga-state.aggregate.ts` FOUND
- `services/games/src/domain/bet-saga-state.repository.ts` FOUND
- `services/games/src/infrastructure/repositories/mikro-bet-saga-state.repository.ts` FOUND
- `services/games/tests/unit/bet-saga-state.aggregate.test.ts` FOUND
- Commits in git history: `4dfc226` (migration+entity), `37d68a9` (RED test), `a0e9dcd` (GREEN aggregate+repo+errors), `616517c` (Mikro repo + module wiring)

## TDD Gate Compliance

- RED commit: `37d68a9` `test(05-03): add failing tests for BetSagaState aggregate FSM` — verified failing (`Cannot find module ../../src/domain/bet-saga-state.aggregate`)
- GREEN commit: `a0e9dcd` `feat(05-03): implement BetSagaState aggregate, repository interface, and saga errors` — verified 10/10 pass
- REFACTOR: not needed (transition guard already extracted into a single private method; aggregate is 60 lines)
