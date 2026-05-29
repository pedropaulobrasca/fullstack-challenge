---
phase: 07-frontend-vertical-slice
plan: 08
subsystem: frontend
tags: [responsive-layout, d-01, skeletons, deduped-toasts, canvas-confetti, juice, prefers-reduced-motion, counter-up, vitest, testing-library]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-05 BetPanel/CashoutButton/Countdown + place-bet/cashout mutation hooks (error-key classification); 07-06 CrashCurve (rAF + crash freeze + reduced-motion); 07-07 HistoryStrip + LiveFeed; 07-04 wallet/round/bet stores + useConnectionStore + bet.store.celebrate flag + use-wallet/use-history Query hooks; 07-03 __root.tsx header slots + Toaster + shadcn badge/skeleton + dark-casino @theme tokens"
provides:
  - "Assembled responsive D-01 game route (index.tsx): history strip top, bet rail + center curve + feed rail at lg+, stacked single column with sticky-bottom controls below lg"
  - "BalancePill (counter-up tween, Fira Code tabular) + ConnectionBadge (live/reconnecting) mounted in the __root header"
  - "useReducedMotion hook + prefersReducedMotion non-hook accessor; useCountUp rAF tween that snaps under reduced-motion and renders Money"
  - "dedupedToast keyed by message (one active toast per key, cleared on dismiss/auto-close), typed helpers for the three error keys, amber warnings"
  - "celebrate() single canvas-confetti burst gated by reduced-motion; CrashFlash red flash + freeze overlay holding the crashed value, reduced-motion aware"
  - "game-skeletons (CurveSkeleton + HistorySkeleton) for the round-snapshot and history-fetch waits"
affects: [phase-verify, phase-10]

# Tech tracking
tech-stack:
  added:
    - "First runtime use of canvas-confetti@1.9.4 (already installed in 07-03 dep set; @types/canvas-confetti present) — single gated burst, no new install"
  patterns:
    - "Error-key toasts rendered at the mutation-hook seam (onError -> typed dedupedToast helper), keeping the route clean; cashout 409 stays silent (no onError path)"
    - "Juice gated two ways: React hook useReducedMotion for components (CrashFlash, counter-up), non-hook prefersReducedMotion accessor for the imperative celebrate() called outside render"
    - "Header components mounted directly in __root.tsx (the reserved data-slot divs were inert placeholders, not portals) — BalancePill returns null until balance hydrates, ConnectionBadge defaults to reconnecting"

key-files:
  created:
    - frontend/src/features/juice/use-reduced-motion.ts
    - frontend/src/features/juice/use-count-up.ts
    - frontend/src/features/juice/use-count-up.test.tsx
    - frontend/src/features/juice/celebrate.ts
    - frontend/src/features/juice/crash-flash.tsx
    - frontend/src/components/balance-pill.tsx
    - frontend/src/components/connection-badge.tsx
    - frontend/src/components/game-skeletons.tsx
    - frontend/src/lib/toast.ts
    - frontend/src/lib/toast.test.ts
    - frontend/src/routes/index.test.tsx
  modified:
    - frontend/src/routes/index.tsx
    - frontend/src/routes/__root.tsx
    - frontend/src/features/bet/use-place-bet.ts
    - frontend/src/features/bet/use-cashout.ts

key-decisions:
  - "Toast rendering moved into the 07-05 mutation hooks (onError) rather than the route — the route cannot observe child-component mutation state, and the hooks already classify the error key. Cashout-too-late (409) resolves as success in the hook, so no toast fires (silent, per UI-SPEC)"
  - "BalancePill + ConnectionBadge are rendered in __root.tsx's AppHeader (replacing the inert data-slot placeholder divs) because the 07-03 slots were never portal targets — the simplest correct wiring is to render the real components in the header"
  - "Network/WS-drop toast is fired from the route by subscribing to useConnectionStore: reconnecting -> toastNetwork(), connected -> clearToastKey('network') so it auto-clears on resync (UI-SPEC)"
  - "Mobile controls use sticky bottom-0 below lg and lg:static at lg+, so Bet/Cashout stay thumb-reachable on phones; page bottom padding (pb-28) keeps content clear of the sticky bar"

requirements-completed: [REQ-FE-12, REQ-FE-13, REQ-FE-14]

# Metrics
duration: ~30min
completed: 2026-05-29
---

# Phase 7 Plan 08: Responsive Game Page Assembly & Juice Summary

**Assembled the disjoint 07-05/06/07 components into one playable, responsive D-01 game page — history strip on top, bet/cashout/countdown rail + center crash curve + live feed rail at `lg+`, a single stacked column with sticky-bottom controls on mobile — then layered the cross-cutting UX: round-snapshot and history-fetch skeletons, deduped sonner error toasts keyed by message (insufficient balance, bet-window-closed, network), and the four sanctioned juice moments (balance counter-up, single gated confetti burst on cashout, red flash + freeze overlay on crash, rising-curve glow from 07-06), every motion effect honoring `prefers-reduced-motion`.**

## Performance

- **Duration:** ~30 min (one prior attempt was killed by a session limit before any commit; this run started fresh on a clean tree)
- **Completed:** 2026-05-29
- **Tasks:** 2 of 2 complete (both `type=auto`, `tdd=true`)
- **Files:** 15 (11 created, 4 modified)

## Accomplishments

- **Task 1 — header counter-up + connection badge + skeletons + deduped toast (`e661ceb`):** `features/juice/use-reduced-motion.ts` exports a `useReducedMotion()` hook (matchMedia listener) plus a non-hook `prefersReducedMotion()` accessor for imperative call-sites. `features/juice/use-count-up.ts`'s `useCountUp(targetCents: bigint)` tweens the displayed cents from the previous value to the target over ~400ms ease-out cubic via `requestAnimationFrame`, snapping immediately when reduced-motion (or no rAF), and returns a `Money` (`Money.of(cents)`) — never a bare number. `components/balance-pill.tsx` feeds the wallet-store balance cents to `useCountUp` and renders `Money.toString()` in a Fira Code tabular `badge`. `components/connection-badge.tsx` reads `useConnectionStore().status` and shows an accent "Live" dot when connected, amber "Reconnecting…" otherwise (red stays crash-only). `components/game-skeletons.tsx` exports `CurveSkeleton` (multiplier + curve placeholder) and `HistorySkeleton` (chip-row placeholders). `lib/toast.ts`'s `dedupedToast(key, message)` keeps a `Map<key, toastId>`; a key already active is a no-op, and the key clears on `onDismiss`/`onAutoClose` (plus a `clearToastKey` for the resync path); warnings use the amber `toast.warning` variant, with typed helpers for the three error keys carrying the UI-SPEC copy.
- **Task 2 — confetti + crash flash + assembled route (`9b19938`):** `features/juice/celebrate.ts`'s `celebrate()` fires a SINGLE `canvas-confetti` burst (40 particles, emerald/cyan named consts, `disableForReducedMotion: true`) and returns early under `prefersReducedMotion()` — no loop, no `setInterval`. `features/juice/crash-flash.tsx` subscribes to `round.store.status`/`crashValue`; on transition to `CRASHED` it runs a red flash (≤200ms) then a freeze overlay (~700ms) holding `Crashed @ {crashValue}x`, then clears, skipping the flash animation under reduced-motion while still showing the frozen value. `routes/index.tsx` was rewritten into the D-01 layout (history strip top → `[320px_1fr_320px]` grid at `lg+`; stacked order curve → sticky-bottom controls → feed below `lg`, ≥44px touch targets from the 07-05 controls), rendering `CurveSkeleton` until a round exists and `HistorySkeleton` while `useHistory().isLoading`, firing `celebrate()` once per `bet.store.celebrate` flag (then clearing it), and toasting `network` on WS drop / clearing it on reconnect. `routes/__root.tsx` mounts `BalancePill` + `ConnectionBadge` in the header. The 07-05 `use-place-bet`/`use-cashout` hooks gained `onError` handlers routing the classified error keys to the deduped toast helpers (cashout-too-late stays silent).

## Task Commits

1. **Task 1 — header balance counter-up, connection badge, skeletons, deduped toasts:** `e661ceb` (feat)
2. **Task 2 — assemble responsive game page with confetti and crash-flash juice:** `9b19938` (feat)

## Verification Evidence

- `cd frontend && bunx tsc --noEmit` → exit 0 (clean) after each task
- `bun run test` → **65 passed** (12 files: 48 prior + 4 toast-dedupe + 5 count-up/reduced-motion + 8 route layout/juice/dedupe)
- `grep -c 'matchMedia' src/features/juice/use-reduced-motion.ts` → 4 (≥1)
- `grep -rE "#[0-9A-Fa-f]{6}" src/routes/index.tsx` → empty (no hardcoded hex; confetti colors centralized as consts in `celebrate.ts`)
- `grep -c 'setInterval' src/features/juice/celebrate.ts` → 0 (single burst, no loop — T-07-22)
- `grep -c 'confetti' src/features/juice/celebrate.ts` → 2; `grep -c 'CRASHED' src/features/juice/crash-flash.tsx` → 1
- Route tests assert: curve-skeleton shown with no round → CrashCurve mounts once `roundId` set; both `data-region="bet-rail"` and `data-region="feed-rail"` present; history skeleton while `isLoading`; `celebrate=true` fires confetti exactly once and clears the flag; reduced-motion mocked true → confetti NOT called; `CRASHED` renders the `data-slot="crash-flash"` overlay with the frozen value; same toast key twice → one `toast.warning`
- `bunx eslint` on all created/modified files (incl. `@crash/no-number-for-money`) → exit 0
- `git diff --diff-filter=D HEAD~2 HEAD` → no source-file deletions (the `index.tsx` placeholder lines were rewritten, intentional)

## Juice Moment Inventory (exactly four, D-04 budget)

| # | Moment | Implementation | Reduced-motion behavior |
|---|--------|----------------|-------------------------|
| 1 | Balance counter-up | `useCountUp` rAF ease-out tween in `BalancePill` (Fira Code tabular) | Snaps to final value instantly |
| 2 | Cashout celebration | `celebrate()` single canvas-confetti burst (≤40 particles, emerald/cyan), gated per round by `bet.store.celebrate` | No-op (early return + `disableForReducedMotion`) |
| 3 | Crash flash + freeze | `CrashFlash` red flash (≤200ms) + freeze overlay (~700ms) holding crashed value | Skips flash animation, still shows frozen value briefly |
| 4 | Rising-curve glow | Single `shadowBlur` emerald→cyan glow in `draw-curve.ts` (07-06) | Glow zeroed when reduced-motion (07-06) |

No screen shake, no particle storms (T-07-22 honored).

## Decisions Made

- **Toast rendering at the mutation-hook seam.** The plan said "wire the three error keys from the 07-05 mutation hooks to `dedupedToast`." The route cannot observe the child components' mutation state, and the hooks already classify the HTTP status into a typed error key, so the natural place to render is the hook's `onError`. `use-place-bet` maps `insufficient-balance`/`bet-window-closed`/`network` to the typed helpers; `use-cashout` only ever throws `network` (409 resolves as success), so cashout-too-late produces no toast (silent, per UI-SPEC). This is a Rule-3 alignment, not a behavior change.
- **Header components rendered in `__root.tsx`, not injected into the slots.** The 07-03 `data-slot="balance-pill"`/`"connection-badge"` divs are inert placeholders, never portal mount points. The simplest correct wiring is to render `BalancePill` + `ConnectionBadge` directly in the `AppHeader`; both are store-driven and safe outside the route guard (BalancePill returns null until balance hydrates).
- **Network toast lifecycle owned by the route via the connection store.** `reconnecting` → `toastNetwork()`, `connected` → `clearToastKey('network')`, so the "Connection lost. Reconnecting…" toast auto-clears on resync as the UI-SPEC requires, without a manual dismiss.
- **Mobile sticky-bottom controls via responsive utility flip.** The bet rail is `sticky bottom-0` below `lg` and `lg:static` at `lg+`; `pb-28` on the page keeps content clear of the sticky bar on mobile. The 07-05 controls already carry `min-h-11` (≥44px) touch targets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Header slots are inert placeholders, not portal targets**
- **Found during:** Task 2 (mounting BalancePill/ConnectionBadge)
- **Issue:** The plan implied "mount BalancePill + ConnectionBadge into the header slots reserved in `__root.tsx`," but the `data-slot` divs there are empty `<div>`s with no portal/context — there is no slot machinery to inject into.
- **Fix:** Rendered the two components directly in `__root.tsx`'s `AppHeader`, replacing the placeholder divs. No new wiring abstraction added.
- **Files modified:** `frontend/src/routes/__root.tsx`
- **Commit:** `9b19938`

**2. [Rule 3 - Blocking] Error-key toasts cannot be wired from the route**
- **Found during:** Task 2
- **Issue:** The route cannot read the place-bet/cashout mutation state that lives inside `BetPanel`/`CashoutButton`, so it cannot directly map error keys to toasts.
- **Fix:** Added `onError` handlers to the 07-05 mutation hooks (`use-place-bet`, `use-cashout`) that call the typed `dedupedToast` helpers; cashout 409 already short-circuits to success so it stays silent.
- **Files modified:** `frontend/src/features/bet/use-place-bet.ts`, `frontend/src/features/bet/use-cashout.ts`
- **Commit:** `9b19938`

**Total deviations:** 2 auto-fixed (both Rule 3 wiring alignments against the as-built surfaces). No architectural changes; no scope creep; no new package installs (T-07-SC honored — canvas-confetti was already in the 07-03 dep set).

## TDD Gate Compliance

Both tasks are `tdd="true"`. Per the established repo convention (noted across 07-04..07-07 SUMMARYs), each task landed as a single `feat` commit pairing tests + implementation rather than discrete `test(...)` RED then `feat(...)` GREEN commits. The behaviors are test-covered: `toast.test.ts` (4) asserts dedupe/clear; `use-count-up.test.tsx` (5) asserts reduced-motion read + snap vs. tween + Money rendering; `index.test.tsx` (8) asserts the layout swap, both rails, skeletons, confetti once / not-under-reduced-motion, the crash-flash overlay, and toast dedupe. No RED→GREEN gate commit pair exists in `git log` for these tasks — flagged here for transparency.

## Known Stubs

None. Every surface consumes live 07-04 stores and the real 07-05/06/07 components. The history-chip click is an intentional no-op deferred to Phase 8 (the fairness-verify drawer), as documented in 07-07. The live desktop+mobile smoke and the Playwright critical-loop E2E remain the phase verify / Phase 10 gate (unchanged by this plan).

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface beyond the plan's `<threat_model>`. T-07-21 (toast storm) mitigated by `dedupedToast` (one active toast per key, cleared on close). T-07-22 (confetti loop) mitigated: single 40-particle burst, no `setInterval` (grep == 0), gated behind reduced-motion. T-07-23 (spoofed celebration) honored: `celebrate()` fires only on the server-authoritative `bet.store.celebrate` flag set by the 07-04 `bet:my_cashed_out` WS handler, never on the optimistic cashout click. T-07-24 (red semantic spoofing) honored: warnings/connection use amber, red is reserved for the crash flash/freeze; no stray hex in `index.tsx`.

## User Setup Required

- Unchanged from prior plans: copy `frontend/.env.example` → `frontend/.env` (13 `VITE_` vars) before `bun run dev`; `docker compose restart kong` for the 07-03 `OPTIONS`/CORS additions before browser preflights; Keycloak realm `crash-game` + user `player/player123` for live login. Live login + socket handshake + the playable loop are exercised at the phase live-smoke / Phase 10 Playwright.

## Next Phase Readiness

- The Phase 7 vertical slice is assembled and unit-green: the full game page is responsive (two rails at `lg+`, stacked + sticky controls below), every async surface has a skeleton, error toasts are deduped, and the four juice moments fire with `prefers-reduced-motion` honored. The phase is ready for `/gsd:verify-phase 7` (goal-backward) and the live desktop+mobile smoke gate.
- Phase 8 will wire the history-chip click → fairness-verify drawer (header `data-slot="fairness-badge"` space is reserved).

## Self-Check: PASSED

- Created files verified present: `use-reduced-motion.ts`, `use-count-up.ts` (+ test), `celebrate.ts`, `crash-flash.tsx`, `balance-pill.tsx`, `connection-badge.tsx`, `game-skeletons.tsx`, `lib/toast.ts` (+ test), `routes/index.test.tsx`
- Modified files verified: `routes/index.tsx`, `routes/__root.tsx`, `features/bet/use-place-bet.ts`, `features/bet/use-cashout.ts`
- Commits verified in `git log`: `e661ceb`, `9b19938`
- tsc exit 0; 65/65 tests green; no hardcoded hex in `index.tsx`; no `setInterval` in `celebrate.ts`; eslint money-rule clean

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-29*
