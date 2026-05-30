---
phase: 08-provably-fair-history-replay
plan: 08
subsystem: frontend
tags:
  - determinism
  - byte-match
  - vitest
  - phase-4-oracle
  - speed-time-equivalence
  - fixed-grid-sampling
  - req-replay-01
requirements:
  - REQ-REPLAY-01
dependency_graph:
  requires:
    - "Plan 08-01 deriveCrashPointAsync + the Phase 4 2.94 oracle"
    - "Plan 08-07 sampleReplayMultiplier + makeReplayDriver"
    - "@crash/contracts/multiplier multiplierAt + crashTimeMs (Phase 7 carry-forward)"
    - "@crash/contracts/formula HEX_CHARS + TWO_POW_52 constants (for the node:crypto fallback)"
  provides:
    - "frontend/src/features/replay/__fixtures__/locked-round.fixture.ts exporting LOCKED_ROUND (Phase 4 oracle tuple + fixed-grid params)"
    - "frontend/src/features/replay/determinism.test.ts — 5-test Vitest suite locking REQ-REPLAY-01 byte-match + D-03 speed-time equivalence"
  affects:
    - "Plan 08-09 (recruiter-example README references the determinism test as the byte-match proof artifact)"
    - "Plan 08-10 (closeout consumes the REQ-REPLAY-01 Done status when rotating REQUIREMENTS)"
tech_stack:
  added: []
  patterns:
    - "Fixed-grid sampling (NOT rAF) — RESEARCH Pitfall 7 (vsync drift makes rAF sampling flaky)"
    - "Hard sync fallback (node:crypto.createHmac) instead of it.skipIf — the seed-to-crashpoint anchor is load-bearing and MUST run in every environment"
    - "Deep-equality (toEqual on arrays) over per-element loops for the byte-match centerpiece — Vitest prints the full diff on regression"
key_files:
  created:
    - "frontend/src/features/replay/__fixtures__/locked-round.fixture.ts"
    - "frontend/src/features/replay/determinism.test.ts"
  modified: []
decisions:
  - "Test 1 (seed-to-crashpoint anchor) uses a hard node:crypto.createHmac sync fallback when globalThis.crypto?.subtle is unavailable — NO it.skipIf / test.skipIf. The 2.94 oracle is the load-bearing fixture for this entire phase; silently skipping it under a future jsdom regression would rot the proof in place. node:crypto is always available in Bun + Vitest so the anchor runs every time."
  - "Grid is 60 steps × 16.6ms (≈ 1s of curve at one rAF frame interval) — Pitfall 7. The grid terminates early if a step exceeds crashTimeMs(growthRate, crashPoint), but for the locked tuple crashTimeMs(0.06, 2.94) = 17981ms so all 60 steps fall in the pre-crash region. The crash-freeze branch is covered by Test 5 (a separate single-shot at t = 2 × crashAtMs)."
  - "Deep-array equality (toEqual) over the live vs replay sample arrays in Test 2 — this surfaces the exact element index of any future drift in Vitest's diff output, which matters during the recruiter arguição."
  - "Test 3 iterates speeds {2, 4} (not just 2) and asserts strict === (not toBeCloseTo) — sampleReplayMultiplier is a pure function of (elapsedWall × speed) so identical floating-point math at the two call sites means bit-identical results; weakening the assertion would mask a real regression."
metrics:
  duration_minutes: ~10
  completed_date: 2026-05-30
  tasks_total: 1
  tasks_complete: 1
  files_created: 2
  files_modified: 0
  tests_added: 5
  tests_total_after: 168
---

# Phase 8 Plan 08: Determinism Byte-Match Test Summary

Locked Phase 8 ROADMAP success criterion 4 ("deterministic-replay E2E reproduces a captured live round and asserts the rendered multiplier values byte-match the original frame samples") with a Vitest test anchored to the Phase 4 oracle. The test proves three independent invariants in one suite: (1) the seed-to-crashpoint derivation still returns 2.94 for the locked tuple, (2) the live `multiplierAt` curve and the replay driver's `sampleReplayMultiplier` are byte-equal across a fixed time grid, (3) the D-03 speed-time equivalence holds — `sample(speed=k, t) === sample(speed=1, k*t)`.

## What landed

### `frontend/src/features/replay/__fixtures__/locked-round.fixture.ts`

A `Readonly<{...}>` constant `LOCKED_ROUND` with the Phase 4 oracle tuple plus the grid parameters:

| Field | Value | Source |
|---|---|---|
| `serverSeed` | `"0000...0001"` (64 chars) | Phase 4 locked-byte fixture |
| `clientSeed` | `"test"` | Phase 4 locked-byte fixture |
| `nonce` | `0n` | Phase 4 locked-byte fixture |
| `instantCrashBucket` | `101` | Phase 4 locked-byte fixture |
| `expectedCrashPoint` | `2.94` | Phase 4 locked-byte fixture |
| `growthRate` | `0.06` | Project env default |
| `gridSteps` | `60` | ≈ 1s of curve at 60Hz |
| `gridStepMs` | `16.6` | One rAF frame interval |

`as const` typing preserves the `bigint` nonce and the precise numeric literals. No JS objects mutate the fixture (it's frozen by the readonly cast).

### `frontend/src/features/replay/determinism.test.ts`

Five tests, all PASS in ~3ms:

1. **Test 1 — seed-to-crashpoint anchor (never skipped).** Detects `globalThis.crypto?.subtle.importKey`. When present, calls `deriveCrashPointAsync(LOCKED_ROUND)` (Plan 08-01). When absent, falls back HARD to a local sync helper that wraps `node:crypto.createHmac("sha256", serverSeed).update("${clientSeed}:${nonce}").digest("hex")` then applies the same `bustabitCrashFromHmacHex(hmacHex, 101)` reduction the contracts package uses. Either way, the result is asserted equal to `LOCKED_ROUND.expectedCrashPoint` (2.94). NO `it.skipIf` / `test.skipIf` — the oracle is the load-bearing fixture; if it ever silently skips, the whole phase's correctness proof rots in place. `node:crypto` is always available under Bun + Vitest so this branch runs in every environment.

2. **Test 2 — byte-match centerpiece.** Builds the grid `ts = [0, 16.6, 33.2, ..., 59 × 16.6]` (terminating early if a step exceeds `crashTimeMs(0.06, 2.94) = 17981ms`, but for the locked tuple all 60 steps fit). Computes `liveSamples = ts.map(t => Math.min(multiplierAt(t, 0.06), 2.94))` (exactly what `localMultiplier` + the freeze cap in the live UI reduces to). Computes `replaySamples = ts.map(t => sampleReplayMultiplier(state@speed=1, t))`. Asserts `expect(replaySamples).toEqual(liveSamples)` — DEEP equality on the arrays. Any future drift in either path produces a Vitest diff that names the exact element index that drifted, which is the recruiter-grade diagnostic this proof was built for.

3. **Test 3 — D-03 speed-time equivalence.** Iterates `speed ∈ {2, 4}` and, for every grid point `t`, asserts `sampleReplayMultiplier(state@speed=k, t) === sampleReplayMultiplier(state@speed=1, k * t)` with strict `===` (not `toBeCloseTo`). Because `sampleReplayMultiplier` reduces to `Math.exp((growthRate * elapsedWall * speed) / 1000)` and the two call sites multiply the same operands in the same order, the IEEE-754 result is bit-identical — weakening the assertion would mask a real regression. Total assertions: `60 grid points × 2 speeds = 120` byte-equality checks per run.

4. **Test 4 — purity proof.** Two independent `ReplayDriverState` objects with identical fields produce identical sample arrays via `toEqual`. Proves `sampleReplayMultiplier` carries no hidden state across calls.

5. **Test 5 — freeze cap past the crash.** For `t = 2 × crashTimeMs(0.06, 2.94) = 35962ms`, `sampleReplayMultiplier(state@speed=1, t)` returns exactly `2.94` (the `Math.min(raw, crashPoint)` cap is enforced — no overshoot).

The file's header comment names Phase 8 ROADMAP success criterion 4, REQ-REPLAY-01, and the Pitfall 7 fixed-grid rationale in two lines so a future reader recognises the load-bearing role on first scroll.

## Verification

| Gate | Command | Result |
|---|---|---|
| New test passes | `cd frontend && bunx vitest run src/features/replay/determinism.test.ts --reporter=verbose` | 5 / 5 PASS in 381ms |
| Full FE suite | `cd frontend && bun run test` | 168 / 168 PASS across 28 files (was 163 — +5 from this plan) |
| TypeScript | `cd frontend && bunx tsc --noEmit` | exit 0 |
| Lint | `cd frontend && bun run lint` | clean (only pre-existing `routeTree.gen.ts` unused-directive warning) |
| Phase 4 oracle still locked at contracts layer | `cd packages/contracts && bun test tests/unit/provably-fair.test.ts` | (unchanged — Plan 08-01 verified) |

Vitest verbose output (Test 1 → Test 5 in order):

```
✓ Test 1 — seed-to-crashpoint anchor returns 2.94 (Phase 4 oracle, never skipped) 1ms
✓ Test 2 — live multiplierAt and sampleReplayMultiplier byte-match at speed 1x across the fixed grid 0ms
✓ Test 3 — speed-time equivalence: sample(speed=k, t) === sample(speed=1, k*t) for k in {2,4} (locks D-03) 1ms
✓ Test 4 — sampleReplayMultiplier is pure: two independent states produce identical sample arrays 0ms
✓ Test 5 — crash freeze cap: past the crash time the sample equals crashPoint exactly 0ms
```

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `f72f984` | `test(08-08): determinism byte-match proof anchored to Phase 4 oracle` |

## Deviations from Plan

### Rule 3 — Import path `./replay-driver` (not `../replay-driver`)

- **Found during:** Task 1 first `bunx vitest run`.
- **Issue:** The plan's behavior body listed `../replay-driver` as the import path. The test file lives at `frontend/src/features/replay/determinism.test.ts` (same directory as `replay-driver.ts`), so the correct relative path is `./replay-driver`. Vite rejected `../replay-driver` because it would resolve to `src/features/replay-driver` which does not exist.
- **Fix:** Changed the import to `./replay-driver`. Functionally identical to what the plan intended; the `../` was a plan-authoring typo (the fixture file lives one directory deeper under `__fixtures__/`, but the test file does not).
- **Files modified:** `frontend/src/features/replay/determinism.test.ts`.
- **Commit:** `f72f984` (folded into the Task 1 commit before staging).

### Rule 2 — Inlined the bustabit reduction for the node:crypto fallback

- **Found during:** Task 1 authoring.
- **Issue:** The plan called for a `node:crypto` sync fallback for Test 1 when `crypto.subtle` is unavailable, but did not specify which file owns the reduction from `hmacHex` → crash point. Importing the server-only `deriveCrashPoint` from `@crash/contracts/provably-fair` would re-introduce the `node:crypto` leak into the FE bundle (the entire Plan 08-01 subpath split exists to prevent that).
- **Fix:** Inlined a local `bustabitCrashFromHmacHex(hmacHex, instantCrashBucket)` helper in the test file using the same `HEX_CHARS` + `TWO_POW_52` constants from `@crash/contracts/formula` (which is the browser-safe constants subpath, by design). The helper is byte-equivalent to both the server `deriveCrashPoint` reduction and the browser `bustabitCrashFromHmacHex` inside `derive-crash-point.async.ts`. If the formula ever changes, this test would diverge from production — which is the correct failure mode for a regression gate.
- **Files modified:** `frontend/src/features/replay/determinism.test.ts`.
- **Commit:** `f72f984`.

No Rule 1 / Rule 4 deviations. The plan's acceptance criteria all pass exactly as written. Test 1 is NEVER skipped (the `Assumption A6` resolution from the plan's `<output>` section: in practice `crypto.subtle` IS available under jsdom on Node 20+, so the `await deriveCrashPointAsync(...)` branch executes; the `node:crypto` fallback branch exists as a hard safety net the next time someone swaps the test environment).

## TDD Gate Compliance

Per the Phase 7/8 convention (Plans 07-06 / 07-07 / 08-03 / 08-05 / 08-06 / 08-07 all landed `tdd=true` tasks as single commits shipping test + impl together), this plan's single task is a `test(08-08)` commit because the entire deliverable IS the test — there is no separate production code under change. The five tests collectively form the RED guard against any future drift in `multiplierAt`, `sampleReplayMultiplier`, or the Phase 4 oracle. They are green now; they will fail loudly the next time any of those three artifacts moves.

## Self-Check: PASSED

- `frontend/src/features/replay/__fixtures__/locked-round.fixture.ts` exists with `LOCKED_ROUND` exporting `serverSeed`, `clientSeed`, `nonce`, `instantCrashBucket`, `expectedCrashPoint`, `growthRate`, `gridSteps`, `gridStepMs`.
- `frontend/src/features/replay/determinism.test.ts` exists and references `multiplierAt`, `crashTimeMs`, `sampleReplayMultiplier`, `deriveCrashPointAsync`, `LOCKED_ROUND` (verified by `grep`).
- 5/5 tests PASS in `bunx vitest run src/features/replay/determinism.test.ts --reporter=verbose`.
- Full FE suite 168/168 PASS (`bun run test`).
- TypeScript clean (`bunx tsc --noEmit` exit 0).
- Lint clean (`bun run lint` only the pre-existing `routeTree.gen.ts` warning).
- Commit `f72f984` (test 08-08 Task 1) present on `main` (`git log --oneline | grep f72f984`).
- ROADMAP.md row `[x] 08-08-PLAN.md — Determinism E2E byte-match test (REQ-REPLAY-01)` checked.
- REQUIREMENTS.md REQ-REPLAY-01 row marked `[x]` and the traceability table updated with the P08-08 evidence (file paths + test names + crashTimeMs values).
- STATE.md Current Position updated to "8/10 plans landed" with the new Plan + Next action paragraphs.

## Threat Flags

None — the test introduces no new network surface, no auth path, no schema change, no file access. The test file is jsdom + node:crypto only; it never touches the network or the DOM beyond what the existing `src/test/setup.ts` polyfills already cover.

## Unblocks

- **Plan 08-09 (recruiter README example):** the determinism test is the byte-match proof artifact the README will reference — "Run `cd frontend && bunx vitest run src/features/replay/determinism.test.ts` to see the live curve and the replay driver produce identical samples from the seed `0000...0001`."
- **Plan 08-10 (closeout):** REQ-REPLAY-01 is now Done — the closeout's REQUIREMENTS rotation will list 8/10 Phase-8 plans as the milestone (with 08-09 + 08-10 still open), and the deferred drawer `<a>` → typed `<Link>` migration from 08-06 plus the T-08-23 dual-rAF smoke check from 08-07 remain on the closeout list.
- **Phase 8 ROADMAP success criterion 4** ("deterministic-replay E2E reproduces a captured live round and asserts the rendered multiplier values byte-match the original frame samples") — automated and green as a permanent regression gate.
