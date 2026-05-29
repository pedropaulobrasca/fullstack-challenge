---
phase: 08-provably-fair-history-replay
plan: 03
subsystem: frontend
tags:
  - use-raf-curve
  - raf-curve-driver
  - replay-foundation
  - renderer-reuse
  - zero-diff-seam
requirements:
  - REQ-REPLAY-03
  - REQ-REPLAY-01
dependency_graph:
  requires:
    - "Phase 7 useRafCurve (live rAF loop reading useRoundStore + useMultiplierStore)"
    - "Phase 7 localMultiplier (pure server-byte-identical compute)"
    - "Phase 7 useRoundStore (RoundStatus enum)"
    - "Phase 7 useMultiplierStore (setRendered + serverOffsetMs)"
  provides:
    - "RafCurveDriver type — multiplier/status/crashValue/shouldStop sampler shape"
    - "liveDriver module-level constant — wraps the existing store-reading logic"
    - "useRafCurve(onFrame, driver=liveDriver) — additive optional driver param"
    - "isLive gate around useMultiplierStore.setRendered (replay never corrupts the live store)"
    - "Driver-path tick loop with its own shouldStop cancellation (no round-store subscribe)"
  affects:
    - "Plan 08-07 (ReplayModal supplies a deterministic time-stepper driver to the same hook)"
    - "Plan 08-08 (determinism E2E asserts driver-fed frames match the byte-identical server math)"
tech_stack:
  added: []
  patterns:
    - "Dependency-inversion seam via a typed driver object (RESEARCH Pattern 2)"
    - "Default-argument-equals-module-constant for compile-time isLive identity check"
    - "Branched rAF lifecycle: live keeps the round-store subscribe, custom driver owns its own start/stop"
key_files:
  created:
    - "frontend/src/features/curve/use-raf-curve.test.tsx"
  modified:
    - "frontend/src/features/curve/use-raf-curve.ts"
key_decisions:
  - "Default value liveDriver is a module-level constant so `driver === liveDriver` is a stable identity check — no useMemo dance at the caller, no `isLive` flag prop"
  - "The driver-path tick does NOT subscribe to useRoundStore — the replay caller owns its own lifecycle via shouldStop (T-08-10 explicitly accepted, contract locked by Test 5)"
  - "writeFrame gates setRendered behind isLive — a replay driver can never overwrite the live renderedMultiplier (T-08-09 mitigated, asserted by Test 4 via vi.spyOn)"
  - "Tests renamed to use-raf-curve.test.tsx (not .ts as the plan literally specified) because the harness component requires JSX parsing — Rule 3 alignment, documented below"
  - "driver added to the useEffect dependency list so swapping drivers at runtime correctly re-runs the effect (replay open/close)"
metrics:
  duration_minutes: ~15
  tasks_completed: 2
  files_changed: 2
  tests_added: 5
  date_completed: 2026-05-29
---

# Phase 08 Plan 03: RafCurveDriver Seam Summary

Refactored `useRafCurve` to accept an optional `driver: RafCurveDriver = liveDriver` second parameter without breaking any Phase 7 caller — `crash-curve.tsx`, `draw-curve.ts`, and `local-multiplier.ts` are byte-identical on disk (git-verified). The Replay modal in Plan 08-07 will reuse the same hook + draw function by passing a deterministic stepper driver instead of duplicating the renderer.

## What Landed

### Task 1 — useRafCurve refactor (commit 768b4b1)

Refactor of `frontend/src/features/curve/use-raf-curve.ts`:

- Exported `RafCurveDriver` type with the four-method shape from RESEARCH Pattern 2:
  - `multiplier(): number`
  - `status(): RoundStatus` (re-exported from `round.store.ts` — no string-union drift)
  - `crashValue(): number | null`
  - `shouldStop(): boolean`
- Exported a module-level `liveDriver: RafCurveDriver` whose methods are exact translations of the previous inline reads — `multiplier()` returns `localMultiplier(roundStartedAt, serverOffsetMs ?? 0)` when `status==='RUNNING' && roundStartedAt!==null` else `BASELINE_MULTIPLIER`; `status()`/`crashValue()` are direct `getState()` accesses; `shouldStop()` returns true on `CRASHED` and on any non-`RUNNING`/null-`roundStartedAt` state.
- Changed the hook signature to `useRafCurve(onFrame?, driver: RafCurveDriver = liveDriver)`.
- Inside the effect, `const isLive = driver === liveDriver` is computed once. `writeFrame(value)` always writes the frameRef + invokes `onFrame`, but only writes `useMultiplierStore.getState().setRendered(value)` when `isLive` — the T-08-09 mitigation.
- The tick body branches at effect-setup time: `tickLive` keeps the verbatim Phase 7 CRASHED → freeze → non-RUNNING → baseline → RUNNING → localMultiplier control flow; `tickDriver` calls `driver.multiplier()` → `writeFrame` → check `driver.shouldStop()` → cancel-or-reschedule.
- The `useRoundStore.subscribe(...)` lifecycle is wired ONLY in the live path. Custom drivers run the rAF loop straight from `tick()` with no store subscription — the replay caller (Plan 08-07) owns its own start/stop entirely via `shouldStop`.
- Cleanup unconditionally cancels the rAF; the unsubscribe handle is captured only on the live branch.
- `useEffect` dependency list is `[onFrame, driver]` so a runtime driver swap (open/close replay modal) re-runs the effect cleanly.
- `nudgeOffsetTowardServer` and the `BASELINE_MULTIPLIER` constant are unchanged.

### Task 2 — Regression suite (commit cf869c0)

Created `frontend/src/features/curve/use-raf-curve.test.tsx` with 5 tests across two describe blocks:

**Live default (Phase 7 zero-diff):**

1. RUNNING produces a multiplier > 1 within 5 simulated rAF frames; `useMultiplierStore.renderedMultiplier` is updated (live default still writes through).
2. CRASHED freezes at the server crashValue (`2.94`) AND no further frames fire after the freeze (asserts both T-08-08 mitigation and the cancel — fused into one test since they share the same setup).

**Custom driver (replay seam):**

3. Stub driver returning `multiplier: () => 1.5` is invoked, and `onFrame` receives exactly `{ multiplier: 1.5 }`.
4. `vi.spyOn(useMultiplierStore.getState(), "setRendered")` records zero calls across 3 frames; `renderedMultiplier` snapshot before mount === snapshot after frames. T-08-09 mitigated.
5. `shouldStop: () => true` halts after exactly one frame (the second never fires).

Harness component pattern matches the existing `crash-curve.test.tsx`: a tiny `<Harness onFrame driver/>` that calls the hook + a manual `rafQueue` shim drained by `flushFrames(n)`. Store reset in `beforeEach` mirrors the existing curve spec.

## Threat Model Outcome

| Threat | Disposition | Verified by |
| --- | --- | --- |
| T-08-08 (caller-behavior regression) | mitigated | Tests 1+2 + the three constraint-file `git diff --quiet` checks |
| T-08-09 (replay corrupts live store) | mitigated | Test 4 (`setRendered` spy callCount === 0) + the `isLive` gate inside `writeFrame` |
| T-08-10 (rAF leak on stale driver) | accepted (caller-owned) | Test 5 locks the `shouldStop` contract |

## Verification Outcome

- `cd frontend && bunx tsc --noEmit` exit 0
- `cd frontend && bunx vitest run src/features/curve/use-raf-curve.test.tsx` 5/5 green
- `cd frontend && bun run test` 76/76 green across 13 files (Phase 7 baseline was 71; net +5 for this plan)
- `git diff --quiet frontend/src/components/crash-curve.tsx` exit 0 — Phase 7 caller unchanged
- `git diff --quiet frontend/src/features/curve/draw-curve.ts` exit 0 — D-05 honored
- `git diff --quiet frontend/src/features/curve/local-multiplier.ts` exit 0
- Grep gates: `export type RafCurveDriver` present, `driver: RafCurveDriver = liveDriver` present in the hook signature line, `const liveDriver: RafCurveDriver` declared at module scope

## Deviations from Plan

### Rule 3 — Test file extension corrected

- **Found during:** Task 2, first vitest run
- **Issue:** Plan specified `frontend/src/features/curve/use-raf-curve.test.ts`, but the harness component contains JSX. esbuild's `.ts` parser rejected the file with `Expected ">" but found "onFrame"`.
- **Fix:** Renamed to `use-raf-curve.test.tsx`. Matches the project convention (`crash-curve.test.tsx`, `cashout-button.test.tsx`, `live-feed.test.tsx`, etc. — every React-component test in this repo uses `.tsx`).
- **Files modified:** Test file extension only — the artifact path in this plan's `must_haves.artifacts` is `.ts` but the on-disk path of record is `.tsx`. Source content matches the spec.
- **Commit:** cf869c0

### Rule 3 — Test 4 noUncheckedIndexedAccess narrowing

- **Found during:** Task 2 tsc pass
- **Issue:** `frames[0].multiplier` fails TS narrowing under the repo's strict tsconfig.
- **Fix:** Wrote `frames[0]?.multiplier` (the surrounding `expect(frames.length).toBe(1)` is the real guard; `?.` is a one-character formalization).
- **Commit:** cf869c0

No Rule 1 / Rule 2 / Rule 4 deviations. The plan's acceptance grep gates all pass.

## TDD Gate Compliance

Per the Phase 7 convention recorded in STATE.md (both `tdd=true` tasks in plans 07-06 / 07-07 / 07-08 landed as single `feat` commits with test+impl together), this plan followed the same shape: Task 1 is a single `feat(08-03)` commit shipping the refactor (existing Phase 7 tests + the constraint-file `git diff --quiet` checks act as the RED guard — they would have failed loudly if Phase 7 behavior had regressed), Task 2 is a single `test(08-03)` commit shipping the seam-specific regression suite (5 tests, all green on first run against the already-shipped Task 1 implementation). No discrete RED→GREEN commit pair. The existing 65→71 Phase 7 test count was preserved across Task 1, and the +5 driver tests bring the total to 76 — net green throughout, zero in-between failing-test commits.

## Test Layout

```text
frontend/src/features/curve/
├── use-raf-curve.ts            ← refactored (Task 1)
├── use-raf-curve.test.tsx      ← new (Task 2, 5 tests)
├── local-multiplier.ts         ← untouched
├── local-multiplier.test.ts    ← untouched (6 tests, still green)
└── draw-curve.ts               ← untouched (D-05)

frontend/src/components/
├── crash-curve.tsx             ← untouched (Phase 7 caller, zero-diff)
└── crash-curve.test.tsx        ← untouched (5 tests, still green)
```

The `crash-curve.test.tsx` suite is the strongest Phase-7-zero-diff guard in the repo because it drives the hook through its real Phase 7 caller. All 5 of those tests stayed green, which is the operational proof that `crash-curve.tsx` still composes correctly against the refactored hook.

## Unblocks

- **Plan 08-07 (ReplayModal):** can supply a deterministic stepper driver to the SAME `useRafCurve` + `draw-curve.ts`, exactly per RESEARCH Pattern 2. The driver only needs to expose the four sampler methods; no React wiring changes, no draw changes.
- **Plan 08-08 (determinism E2E):** can assert the byte-for-byte equality between a replay driver's `multiplier()` samples and the server's `multiplierAt` formula by hammering both through the same `localMultiplier` math reachable from this seam.

## Self-Check: PASSED

- `frontend/src/features/curve/use-raf-curve.ts` exists and exports `RafCurveDriver`, `liveDriver`, `useRafCurve`, `CurveFrame`, `nudgeOffsetTowardServer`.
- `frontend/src/features/curve/use-raf-curve.test.tsx` exists (5 tests, all green).
- Commit `768b4b1` (feat 08-03 seam) present on main.
- Commit `cf869c0` (test 08-03 regressions) present on main.
- Constraint files (`crash-curve.tsx`, `draw-curve.ts`, `local-multiplier.ts`) byte-unchanged on disk.
