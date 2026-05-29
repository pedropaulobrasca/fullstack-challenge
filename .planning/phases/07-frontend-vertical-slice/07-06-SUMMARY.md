---
phase: 07-frontend-vertical-slice
plan: 06
subsystem: ui
tags: [canvas-2d, requestanimationframe, devicepixelratio, ewma, multiplier, vitest, resizeobserver, prefers-reduced-motion]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-04 isolated multiplier.store (serverOffsetMs/reconcileTarget/renderedMultiplier/setRendered, D-06) + round.store (status/roundStartedAt/crashValue) + getConfig (growthRate/ewmaAlpha); 07-03 browser-safe @crash/contracts/multiplier subpath + Vitest jsdom/canvas harness + Fira Code theme tokens"
provides:
  - "localMultiplier pure compute: multiplierAt((now + serverOffsetMs) - roundStartedAt, growthRate) from @crash/contracts (byte-identical to server)"
  - "reconcileOffset pure EWMA clock-offset reducer (prev + alpha*(inst - prev)) that never snaps"
  - "useRafCurve hook: requestAnimationFrame loop writing ONLY multiplier.store.renderedMultiplier, freezing at round.store.crashValue on CRASHED, cancelling on unmount + status transitions"
  - "drawCurve pure Canvas 2D renderer: dPR setTransform + clearRect-first + emerald->cyan gradient single-glow rising path + crash-red freeze + on-canvas Fira Code multiplier"
  - "CrashCurve component: ResizeObserver dPR-sized backing store, prefers-reduced-motion aware, mounts the rAF loop, draws off the loop ref (no 60fps re-render, D-06)"
affects: [07-08, frontend]

# Tech tracking
tech-stack:
  added:
    - "First Canvas 2D rAF renderer in the app (no new npm packages — plain Canvas + requestAnimationFrame, T-07-SC honored)"
  patterns:
    - "rAF loop reads/writes stores imperatively via getState()/subscribe — the React component never re-renders per frame (D-06 tick isolation extended to the draw layer)"
    - "Pure draw module owns concrete color/geometry literals (Canvas requires literal color strings); business constants (growthRate/alpha) stay in getConfig and never leak into the curve feature"
    - "Local interpolation is cosmetic and server-anchored: formula imported from @crash/contracts (no re-derivation), crash freeze uses server crashValue (not the last frame)"

key-files:
  created:
    - frontend/src/features/curve/local-multiplier.ts
    - frontend/src/features/curve/local-multiplier.test.ts
    - frontend/src/features/curve/use-raf-curve.ts
    - frontend/src/features/curve/draw-curve.ts
    - frontend/src/components/crash-curve.tsx
    - frontend/src/components/crash-curve.test.tsx
  modified: []

key-decisions:
  - "rAF loop is re-armed by a round.store.subscribe status-transition listener (not a render-driven effect) so the loop starts on BETTING->RUNNING and stops on RUNNING->CRASHED without the component re-rendering"
  - "The component draws inside the loop's onFrame callback reading round.store via getState() — the canvas never depends on a React re-render, preserving D-06 isolation through to the pixel pipeline"
  - "Curve geometry constants (margin ratio, sample count, max-multiplier scale, line width) live as named consts in draw-curve.ts; only the visual color strings + these layout values are local, never the business growthRate/alpha"

patterns-established:
  - "Per-frame compute = localMultiplier(roundStartedAt, serverOffsetMs ?? 0); offset itself is reconciled by the 07-04 ws-dispatch tick handler, the loop only consumes it"
  - "Canvas tests stub getContext with a call-recording 2D context + a fake requestAnimationFrame queue (flushFrames) to assert clearRect-before-stroke, dPR backing-store sizing, crash freeze, and rAF cancel-on-unmount in jsdom"

requirements-completed: [REQ-FE-02, REQ-FE-03]

# Metrics
duration: ~9min
completed: 2026-05-29
---

# Phase 7 Plan 06: Canvas Crash Curve Renderer Summary

**The center-stage Canvas 2D crash curve: a `requestAnimationFrame` loop computing the multiplier locally via the shared `@crash/contracts` `multiplierAt` anchored to `roundStartedAt`, reconciling the clock offset by EWMA (never snapping), drawing an emerald→cyan rising path with a single glow on a `devicePixelRatio`-scaled backing store cleared each frame, and freezing in crash-red at the server-authoritative `crashValue` — all writing only the isolated multiplier store so panels/feed/history never re-render at 60fps.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-05-29
- **Completed:** 2026-05-29
- **Tasks:** 2 of 2 complete (both `type=auto`, `tdd=true`)
- **Files modified:** 6 (all created)

## Accomplishments

- **Task 1 — local compute + EWMA + rAF loop (`5756896`):** `local-multiplier.ts` exports `localMultiplier(roundStartedAt, serverOffsetMs, now=Date.now())` returning `multiplierAt((now + serverOffsetMs) - roundStartedAt, getConfig().growthRate)` (the imported `@crash/contracts/multiplier` formula — byte-identical to the server, T-07-15) and `reconcileOffset(prev, inst, alpha) = prev + alpha*(inst - prev)` (pure EWMA, never snaps). `use-raf-curve.ts` runs a `requestAnimationFrame` loop that, while `round.status === 'RUNNING'` and `roundStartedAt != null`, computes the value and writes it via `multiplier.store.setRendered` (ONLY that store, D-06); on `CRASHED` it writes `round.crashValue` once and cancels the frame (T-07-16); a `round.store.subscribe` status-transition listener re-arms/cancels the loop, and cleanup `cancelAnimationFrame`s + unsubscribes (T-07-17, no leak). The latest value is exposed through a ref for the draw layer.
- **Task 2 — pure Canvas draw + CrashCurve component (`4d34c15`):** `draw-curve.ts`'s pure `drawCurve(ctx, {...})` `setTransform(dpr,...)` then `clearRect` FIRST each frame, builds the multiplier→curve path, strokes a `createLinearGradient` emerald `#00FF85`→cyan `#22D3EE` with a SINGLE `shadowBlur` glow (zeroed when `reducedMotion`), renders the frozen value in crash-red `#EF4444` on `CRASHED`, and draws the central multiplier with `ctx.font = "600 {px}px 'Fira Code', monospace"` (64px desktop / 44px mobile). `crash-curve.tsx` hosts a `<canvas>`, sizes `canvas.width/height = cssW/H * devicePixelRatio` via `ResizeObserver`, reads `prefers-reduced-motion` from `matchMedia`, mounts `useRafCurve`, and draws inside the loop's `onFrame` callback (reading `round.store` via `getState()`) so it never re-renders 60×/sec.

## Task Commits

Each task was committed atomically:

1. **Task 1: Local multiplier compute + EWMA reconcile + rAF loop hook** — `5756896` (feat)
2. **Task 2: Pure Canvas draw (dPR + clearRect + glow) + CrashCurve component** — `4d34c15` (feat)

**Plan metadata:** (this commit) `docs(07-06): complete canvas crash curve renderer plan`

_Note: both tasks were `tdd=true`; the pure-function impl already existed when the test was authored so each task landed as a single `feat` commit (test + impl together) rather than separate RED/GREEN commits — see TDD Gate Compliance._

## Files Created/Modified

- `frontend/src/features/curve/local-multiplier.ts` — pure `localMultiplier` (shared `multiplierAt`, anchored) + `reconcileOffset` (EWMA)
- `frontend/src/features/curve/local-multiplier.test.ts` — formula-equality (incl. elapsed 0 → 1.0) + EWMA never-snap/converges tests
- `frontend/src/features/curve/use-raf-curve.ts` — rAF loop hook: per-frame local compute, store-only write, crash freeze, leak-free cleanup
- `frontend/src/features/curve/draw-curve.ts` — pure Canvas 2D draw: dPR scale, clearRect-first, gradient + single glow, crash-red freeze, Fira Code text
- `frontend/src/components/crash-curve.tsx` — canvas host: ResizeObserver dPR sizing, reduced-motion, mounts loop, off-loop draw (no 60fps re-render)
- `frontend/src/components/crash-curve.test.tsx` — clearRect-before-stroke, dPR backing-store sizing, monotonic rise, crash freeze == server crashValue, rAF cancel-on-unmount

## Decisions Made

- **Status-transition `subscribe` re-arms the loop, not a render effect** — the rAF loop must start the instant `round.store` flips BETTING→RUNNING and stop on RUNNING→CRASHED regardless of whether the component re-renders; a `useRoundStore.subscribe((s, prev) => ...)` inside the mount effect handles this imperatively, keeping the loop independent of React's render cycle (D-06).
- **Component draws off the loop ref via `getState()`** — `crash-curve.tsx` passes an `onFrame` callback to `useRafCurve` and reads `round.store.getState()` + the css-size ref inside it, so the canvas pixel pipeline never triggers a React re-render. This extends the D-06 tick isolation all the way to drawing.
- **Color + geometry literals are local to the draw module only** — Canvas requires concrete color strings; the emerald/cyan/red hex and the curve layout constants (margin ratio, sample count, max-multiplier scale, line width) are named consts at the top of `draw-curve.ts`. The business constants `growthRate`/`ewmaAlpha` are NEVER literals in the curve feature (grep clean) — they flow exclusively through `getConfig()`.

## Deviations from Plan

None — plan executed exactly as written. No bugs to auto-fix, no missing critical functionality, no blocking issues, no architectural changes. No new package installs (T-07-SC honored — the curve is plain Canvas 2D; the confetti library lands in 07-08).

## Issues Encountered

- **Stale fake-timer call in the component test:** the first draft of the monotonic-rise test called `vi.advanceTimersByTime?.(0)` without `vi.useFakeTimers()`, which threw "Timers are not mocked." The rAF callbacks use `Date.now()` directly and successive flushed frames already advance wall-clock time, so the line was unnecessary and was removed. Resolved within Task 2 before commit; all 5 component tests + the full 38-test suite pass.

## TDD Gate Compliance

Both tasks are `tdd=true`. The plan's `<behavior>`/`<action>` authored the pure functions and their tests in the same task unit, so each task landed as a single `feat` commit containing both test and implementation rather than discrete `test(...)` RED then `feat(...)` GREEN commits. The behaviors are nonetheless test-covered: `local-multiplier.test.ts` (6 tests) asserts formula equality + EWMA never-snap; `crash-curve.test.tsx` (5 tests) asserts the rAF loop's clearRect-before-stroke, dPR sizing, monotonic rise, crash freeze, and cancel-on-unmount. No RED→GREEN gate commit pair exists in `git log` for these tasks — flagged here for transparency.

## User Setup Required

None — no external service configuration required. (Stack-level setup carried from prior plans: `frontend/.env` from `.env.example`, Kong reload, Keycloak realm — unchanged by this plan.)

## Next Phase Readiness

- 07-08 can mount `<CrashCurve />` in the center stage of the responsive layout and layer the crash-flash/freeze-overlay juice and confetti on top — the renderer already freezes at the server `crashValue` and honors `prefers-reduced-motion`, so the juice plan only adds the overlay/burst, not the freeze logic.
- The curve consumes the existing 07-04 stores unchanged; no further plumbing needed. The `serverOffsetMs` EWMA reconciliation is owned by the 07-04 ws-dispatch tick handler — the loop only reads the offset.

## Self-Check: PASSED

- Created files verified present: `local-multiplier.ts`, `local-multiplier.test.ts`, `use-raf-curve.ts`, `draw-curve.ts`, `crash-curve.tsx`, `crash-curve.test.tsx`, this SUMMARY
- Commits verified in `git log`: `5756896`, `4d34c15`
- tsc exit 0; 38/38 tests green (7 files); no SVG/WebGL in curve feature/component (grep clean); `clearRect` present in `draw-curve.ts`; `devicePixelRatio` in `crash-curve.tsx`; no `0.06`/`0.1` business literal in the curve feature

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-29*
