---
phase: 05-saga-integration
plan: 01
subsystem: games/domain
tags: [domain, fsm, aggregate, error-class, req-game-08]
requires:
  - services/games/src/domain/round.aggregate.ts (Phase 4)
  - services/games/src/domain/value-objects/round-status.ts (Phase 4)
  - DomainError base in @crash/shared-kernel (Phase 1)
provides:
  - Round.acceptBet(now): Round  — pure aggregate-boundary FSM guard
  - RoundNotInBettingPhaseError  — DomainError with readonly actual + code ROUND_NOT_IN_BETTING_PHASE
affects:
  - Unblocks plan 05-04 (PlaceBetUseCase) — the use case will invoke acceptBet and map the error to 409
  - Closes REQ-GAME-08 doc drift surfaced at end of Phase 4
tech_stack:
  added: []
  patterns:
    - "Pure FSM guard returns `this` (identity-preserving) when in valid state; throws named DomainError otherwise"
    - "Error carries actual status as readonly field for downstream controller mapping"
key_files:
  created: []
  modified:
    - services/games/src/domain/errors.ts (+ RoundNotInBettingPhaseError class, 10 lines)
    - services/games/src/domain/round.aggregate.ts (+ acceptBet method + import, 7 lines)
    - services/games/tests/unit/round.aggregate.test.ts (refactor ADR-014 test + new describe block, 67 lines net)
    - .planning/REQUIREMENTS.md (REQ-GAME-08 status cell rewrite, 1 line)
decisions:
  - "acceptBet takes Date arg (`_now`) for signature symmetry with start/crash/settle, even though it does not consume the value today. Keeps call-site shape uniform across the four lifecycle methods."
  - "Returns `this` (identity-preserving) rather than `new Round({ ...this.props })`. The plan permits either; `this` chosen because acceptBet is a read-only validation, not a state transition — callers must NOT mutate Round anyway (props is private readonly), and skipping the allocation keeps the hot path (one acceptBet per bet placement) cheap."
  - "RoundNotInBettingPhaseError.actual is typed `RoundStatus | 'NO_OPEN_ROUND'` per the plan, anticipating plan 05-04 where the PlaceBetUseCase will throw the same error with `NO_OPEN_ROUND` when there is no open BETTING round at all (covers both 'no round' and 'wrong-phase round' under a single discriminated 409 contract)."
  - "Removed the stale ADR-014 absence assertion (`expect(round.acceptBet).toBeUndefined()`); ADR-014 forbade nesting bets inside Round, not adding a pure guard method. Replaced with a narrower assertion that `round.bets` collection remains absent."
metrics:
  duration: "~1 minute (small surgical plan, two atomic tasks)"
  completed: 2026-05-27
  tasks_completed: 2
  files_changed: 4
  tests_added: 5
  total_unit_tests: 20
---

# Phase 5 Plan 01: Round.acceptBet Aggregate-Boundary FSM Guard Summary

DDD-pure FSM gate on the Round aggregate plus the named domain error it throws, closing REQ-GAME-08 at the boundary the requirement actually targets.

## What Shipped

**Domain layer**

- `RoundNotInBettingPhaseError` (DomainError subclass) — code `ROUND_NOT_IN_BETTING_PHASE`, readonly `actual: RoundStatus | "NO_OPEN_ROUND"`. Error message embeds the actual status for log readability.
- `Round.acceptBet(now: Date): Round` — pure FSM guard. Returns `this` when `status === 'BETTING'`. Throws `RoundNotInBettingPhaseError(this.props.status)` otherwise. The `now` parameter is unused today but kept for signature symmetry with `start(now)`, `crash(at, time)`, and `settle(seed, now)`.

**Tests** (services/games/tests/unit/round.aggregate.test.ts — full suite 20 PASS, 68 expect calls)

- New `describe('Round.acceptBet')` block, 5 tests:
  1. BETTING returns identity-preserving snapshot — verifies id, nonce, bettingEndsAt, seedHash, serverSeed preserved.
  2. RUNNING throws `RoundNotInBettingPhaseError`, `actual === 'RUNNING'`, `name`, `code` correct.
  3. CRASHED throws with `actual === 'CRASHED'`.
  4. SETTLED throws with `actual === 'SETTLED'`.
  5. `RoundNotInBettingPhaseError` shape — `instanceof Error`, name/code/actual/message-contains-status invariants.
- Updated stale ADR-014 absence test: now asserts only that `round.bets` collection remains absent (ADR-014's actual constraint), not that `acceptBet` is undefined.

**Docs**

- `.planning/REQUIREMENTS.md` REQ-GAME-08 row: status cell rewritten to reflect reality — P4.02 landed start/crash/settle FSM, 05-01 adds acceptBet, 05-04 will surface the 409 ConflictException. Checkbox unchanged (`[x]`), v1-complete count unchanged.

## Deviations from Plan

None of substance. Two minor in-spirit choices:

- The plan's `<action>` step 4 said "Update existing tests only if test names overlap." The pre-existing `ADR-014 absence` test asserted `round.acceptBet === undefined`, which would have started failing the moment the method landed. Rather than delete it (losing the ADR-014 reminder), the test was narrowed to assert only the `bets` collection remains absent, with a comment noting that acceptBet is a pure guard, not aggregate-internal bet ownership. This preserves the original test's intent (ADR-014: Bet is its own aggregate) under the new reality.
- The plan offered the choice between `return this` and `return new Round({ ...this.props })` for the BETTING success path. Chose `return this` — see Decisions in frontmatter.

## Verification

- `bun test tests/unit/round.aggregate.test.ts` — **20 PASS / 0 FAIL** (68 expect calls)
- `bunx tsc --noEmit` inside `services/games` — clean (no output)
- `grep -c "Round.acceptBet" .planning/REQUIREMENTS.md` — **1 match** (REQ-GAME-08 row)

## Commits

- `2c83b28` test(05-01): add failing tests for Round.acceptBet FSM guard
- `fc19b88` feat(05-01): Round.acceptBet aggregate-boundary FSM guard
- `5a6cfd0` docs(05-01): close REQ-GAME-08 doc drift — cite real Round.acceptBet

## Downstream Impact

- Plan 05-04 (PlaceBetUseCase) can now call `open.acceptBet(input.now)` inside the transactional boundary and let the error propagate up to the controller, which maps it to `409 ConflictException` with body `{ code: 'ROUND_NOT_IN_BETTING_PHASE', phase: <actual> }`.
- The `NO_OPEN_ROUND` literal in the error's `actual` type lets 05-04 use the same error class for the "no open round at all" branch, keeping the wire-level 409 contract single-typed.

## Self-Check: PASSED

Verified on disk:

- FOUND: services/games/src/domain/errors.ts (RoundNotInBettingPhaseError class)
- FOUND: services/games/src/domain/round.aggregate.ts (acceptBet method)
- FOUND: services/games/tests/unit/round.aggregate.test.ts (5 new acceptBet tests, 20 total PASS)
- FOUND: .planning/REQUIREMENTS.md REQ-GAME-08 row updated
- FOUND commits: 2c83b28, fc19b88, 5a6cfd0
