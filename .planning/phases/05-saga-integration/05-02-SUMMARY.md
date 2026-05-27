---
phase: 05-saga-integration
plan: 02
subsystem: games / application
tags: [round-loop, multiplier, cashout, server-authority, pitfall-c2]
requires:
  - Round aggregate + CrashPoint VO + Multiplier VO
  - env.GROWTH_RATE
provides:
  - "RoundLoopService.getMultiplierAt(at: Date): Multiplier — synchronous server-clock multiplier source for cashout controller (05-06) and Phase 6 WS gateway"
affects:
  - 05-06 cashout controller (will call getMultiplierAt at controller-first-line before any await)
  - Phase 6 WS gateway (will reuse same method for tick broadcast)
tech-stack:
  added: []
  patterns:
    - "Cache-on-transition: currentRound + currentCrashPoint updated in every transition helper and every recovery branch — read path is pure synchronous, no DB / await"
key-files:
  created:
    - services/games/tests/unit/round-loop.get-multiplier-at.test.ts
  modified:
    - services/games/src/application/round-loop.service.ts
decisions:
  - "Clock skew (at < startedAt) returns Multiplier(1.00) via Math.max(0, elapsedMs) rather than throwing — keeps cashout safe under monotonic-clock irregularities and matches the natural identity at t=0"
  - "Cache crashPoint separately from the Round aggregate because Round.crashPoint is null during RUNNING (set only on CRASHED). transitionToRunningUseCase returns crashPoint alongside the Round; we capture both"
metrics:
  duration_minutes: 6
  completed: 2026-05-27
  tasks: 1
---

# Phase 05 Plan 02: RoundLoopService.getMultiplierAt Summary

Pure server-clock multiplier source — `RoundLoopService.getMultiplierAt(at: Date): Multiplier` — that the Phase 5 cashout controller (and future Phase 6 WS gateway) can call synchronously at controller-first-line to defeat Pitfall C2 (client-supplied or post-await multiplier capture).

## What changed

`RoundLoopService` now caches two private fields:

- `currentRound: Round | null`
- `currentCrashPoint: CrashPoint | null`

Both are written in lockstep at every state transition (`startNewRound`, `transitionToRunning`, `crashRound`, `settleRound`) and at every reachable branch of `recoverInFlightRound` before the in-flight scheduler resumes. The read method is pure:

```
elapsedMs = max(0, at - round.startedAt)
raw       = exp(GROWTH_RATE * elapsedMs / 1000)
return    = min(raw, currentCrashPoint) wrapped in Multiplier
```

No DB read on the cashout hot path. No tick-cache (per pitfall 5). No async/await.

## Test results

`bun test tests/unit/round-loop.get-multiplier-at.test.ts` — 5 / 5 pass:

1. throws when cache holds a BETTING round (no RUNNING available)
2. RUNNING + 1s elapsed at GROWTH_RATE=0.06 → `e^0.06 ≈ 1.0618` to 4 decimals
3. caps at `crashPoint=5.00` when elapsed would yield ~8.00 by raw formula
4. clock skew (`at < startedAt`) → returns `Multiplier(1.00)`
5. after `crashRound` mutates cache to CRASHED → throws on subsequent query

Full games unit suite: 128 / 128 pass. `bunx tsc --noEmit` clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Cap source: `round.crashPoint` is null during RUNNING**

- **Found during:** Task 1 GREEN — test 3 (cap at crashPoint) failed because the cached `Round` aggregate during RUNNING phase has `crashPoint === null` (the value is only persisted on the aggregate when CRASHED).
- **Issue:** Plan action step 3 reads cap from `round.crashPoint`, but the Round aggregate doesn't carry it until after the CRASHED transition. The cap source has to come from the `TransitionToRunningUseCase` result.
- **Fix:** Added `currentCrashPoint: CrashPoint | null` cached alongside `currentRound`. Populated from `result.crashPoint` in `transitionToRunning`, from `recovered.crashPoint` in the RUNNING recovery branch, and from `open.crashPoint` for CRASHED / SETTLED recovery. Cleared to `null` in `startNewRound`.
- **Files modified:** `services/games/src/application/round-loop.service.ts`
- **Commit:** `16ac586`

## Authentication Gates

None.

## Self-Check: PASSED

Verified:
- `services/games/src/application/round-loop.service.ts` modified (contains `getMultiplierAt`, `currentRound`, `currentCrashPoint`)
- `services/games/tests/unit/round-loop.get-multiplier-at.test.ts` exists (5 tests, all passing)
- Commits in git history: `39ad8f9` (test), `16ac586` (feat)

## TDD Gate Compliance

- RED commit: `39ad8f9` `test(05-02): add failing tests for RoundLoopService.getMultiplierAt` — verified failing (`service.getMultiplierAt is not a function` × 5)
- GREEN commit: `16ac586` `feat(05-02): add pure RoundLoopService.getMultiplierAt server-clock source` — verified all 5 pass
- REFACTOR: not needed (implementation is already minimal: 12-line method, single-purpose cache fields)
