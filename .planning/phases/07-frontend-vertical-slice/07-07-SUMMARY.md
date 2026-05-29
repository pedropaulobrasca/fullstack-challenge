---
phase: 07-frontend-vertical-slice
plan: 07
subsystem: frontend
tags: [history-strip, live-feed, color-bands, money-vo, tailwind-theme, scroll-area, tooltip, vitest, react-testing-library]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-04 feed.store circular buffer (playerIdMasked/kind/amount/multiplier/isOwn entries) + history.store (last-N {roundId, crashPoint}) seeded by use-history Query and prepended on round:crashed; 07-03 dark-casino @theme tokens (accent/warning/destructive) + shadcn scroll-area/tooltip + Vitest harness; lib/config history.redMaxX/yellowMaxX typed thresholds"
provides:
  - "classifyBand(crashPoint) -> 'low'|'mid'|'high' — the single config-driven crash-band classifier (redMaxX/yellowMaxX, <= inclusive, zero literal thresholds)"
  - "bandChipClass band->theme-token map (destructive/warning/accent), no hex"
  - "HistoryStrip — last-20 color-banded Fira Code tabular crash-point chips with tooltip + empty state, reading history.store newest-first"
  - "LiveFeed + FeedRow — feed.store stream newest-first in a scroll-area, own-action accent rail, foreign rows muted, money via Money toString, empty state"
affects: [07-08, frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure config-driven band classifier separated from the rendering component (single source for chip color, unit-testable without DOM)"
    - "Presentational FeedRow takes one store entry; LiveFeed owns the store selector + scroll-area + empty state (container/presentational split)"
    - "Band->token map binds to @theme semantic colors; no hardcoded hex in any component (theming discipline)"

key-files:
  created:
    - frontend/src/features/history/history-band.ts
    - frontend/src/features/history/history-band.test.ts
    - frontend/src/components/history-strip.tsx
    - frontend/src/components/live-feed.tsx
    - frontend/src/components/feed-row.tsx
    - frontend/src/components/live-feed.test.tsx
  modified: []

key-decisions:
  - "Rendered the feed from the ACTUAL landed 07-04 feed.store shape (playerIdMasked / amount / multiplier / isOwn) rather than the plan's interface sketch (playerMasked / payout / at) — the store carries amount+multiplier on cashed_out, no separate payout field, so the cashed_out row shows multiplier + amount"
  - "HistoryStrip subscribes directly to useHistoryStore().entries (last-20, newest-first) rather than a points: number[] hook — that is the real state surface use-history seeds and round:crashed prepends; entries already capped to historySize in the store"
  - "Band->token map uses destructive (low/red, shares the crash hue per UI-SPEC), warning (mid/amber), accent (high/emerald) — semantic theme classes, no component hex"

requirements-completed: [REQ-FE-07, REQ-FE-08]

# Metrics
duration: ~2min
completed: 2026-05-29
---

# Phase 7 Plan 07: Live Feed & History Strip UI Summary

**Built the two streaming-list surfaces on top of the 07-04 state plumbing: a pure config-driven `classifyBand` (low/mid/high from `history.redMaxX`/`yellowMaxX`, `<=` inclusive, zero literal thresholds) feeding a `HistoryStrip` of last-20 color-banded Fira Code tabular crash chips (theme tokens, tooltip, empty state), and a `LiveFeed`/`FeedRow` pair that streams `feed.store` entries newest-first in a scroll-area with the player's own actions on an emerald accent rail, foreign rows muted, money rendered via `Money.fromSnapshot(...).toString()`, and the UI-SPEC empty state.**

## Performance

- **Duration:** ~2 min
- **Completed:** 2026-05-29
- **Tasks:** 2 of 2 complete (both `type=auto`, `tdd=true`)
- **Files:** 6 created, 0 modified

## Accomplishments

- **Task 1 — band classifier + HistoryStrip (`ea3cc0e`):** `features/history/history-band.ts` exports `classifyBand(crashPoint): 'low'|'mid'|'high'` reading `getConfig().history.redMaxX`/`yellowMaxX` with `<=` inclusive boundaries (low if `<= redMaxX`, mid if `<= yellowMaxX`, else high) and a `bandChipClass` band->theme-token map (`destructive` / `warning` / `accent`, no hex, no literal thresholds). `components/history-strip.tsx` subscribes to `useHistoryStore().entries` (last-20, newest-first), renders a horizontally-scrollable row of `tooltip`-wrapped chips each showing `{crashPoint.toFixed(2)}x` in Fira Code 14px tabular with the band color class and a `min-h-11` touch-friendly hit area; chip is a no-op `button` (the verify drawer is Phase 8). When `entries.length === 0` it renders the UI-SPEC empty state ("No rounds yet" / body copy).
- **Task 2 — LiveFeed + FeedRow (`2562fdb`):** `components/feed-row.tsx` is a presentational row taking one `feed.store` entry: `playerIdMasked` in `muted-foreground`, the `cashed_out` multiplier as `{multiplier.toFixed(2)}x` (the only `number`), and the bet amount via `Money.fromSnapshot(entry.amount).toString()`; `isOwn` applies the `border-l-accent` rail + `bg-accent/10` tint, foreign rows stay neutral. `components/live-feed.tsx` selects `feed.store.entries`, maps them newest-first into `FeedRow` inside a shadcn `scroll-area` on the `#111827` card surface with the `#1E3A5F` hairline (theme classes), and renders the UI-SPEC empty state ("No bets yet this round" + body) when there are none.

## Task Commits

1. **Task 1 — config-driven classifier + history strip:** `ea3cc0e` (feat)
2. **Task 2 — live feed + feed row + own-highlight:** `2562fdb` (feat)

## Verification Evidence

- `cd frontend && bunx tsc --noEmit` -> exit 0 (clean) on both tasks
- `bun run test src/features/history/history-band.test.ts` -> 6/6 green (all six behavior cases incl. boundary inclusivity at 1.5/2.0 and config-driven boundary move at custom 3.0/5.0 thresholds)
- `bun run test src/components/live-feed.test.tsx` -> 4/4 green (own row `data-own="true"` / foreign `data-own="false"`; cashed_out money matches `/\d+\.\d{2} CRD/` + `2.50x`; empty-state copy; rows newest-first matching store order)
- Full suite `bun run test` -> **48/48 green** (38 prior + 6 history-band + 4 live-feed), 9 files, no regressions
- `grep -cE '1\.5|2\.0' src/features/history/history-band.ts` -> 0 (no literal thresholds)
- `grep -rcE '#[0-9A-Fa-f]{6}'` on `history-strip.tsx`, `live-feed.tsx`, `feed-row.tsx` -> 0 each (no hardcoded hex)
- `bunx eslint` on the three new tsx (incl. `@crash/no-number-for-money`) -> exit 0 (only the multiplier is a number; all money is Money toString)
- `git diff --diff-filter=D HEAD~2 HEAD` -> no deletions

## Decisions Made

- **Render from the real 07-04 store shape, not the plan's interface sketch.** The plan `<interfaces>` block described feed entries as `{ playerMasked, payout, at }` and history as a `points: number[]` hook. The actually-landed 07-04 `feed.store` entry is `{ id, roundId, betId, playerIdMasked, kind, amount?, multiplier?, isOwn }` (no `payout`, no `at`), and history lives in `useHistoryStore().entries: { roundId, crashPoint }[]`. I rendered the genuine surface: cashed_out rows show `multiplier` + `amount` (Money toString), and the strip subscribes to the store's `entries` (already capped to `historySize`, prepended on `round:crashed`). This is a Rule-3 alignment, not a behavior change — the goal (own-highlighted feed + config-banded history) is met against the real state.
- **Band tokens map low->destructive / mid->warning / high->accent.** Per UI-SPEC the low band intentionally shares the crash red hue (semantically "bad outcome"); mid uses the amber `warning` token, high uses the emerald `accent` ramp. All via `@theme` semantic classes so no hex leaks into components.
- **Chip is a no-op button at `min-h-11`.** The chip-click verify drawer is Phase 8; the chip is a touch-friendly (>=44px) button placeholder wrapped in a tooltip showing `Crashed @ {x}x`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan interface sketch drifted from the landed 07-04 store shape**
- **Found during:** Tasks 1 and 2 (reading `feed.store.ts` / `history.store.ts` / `use-history.ts`)
- **Issue:** The plan's `<interfaces>` named `playerMasked` / `payout` / `at` on feed entries and a `points: number[]` history hook, none of which exist on the actual 07-04 stores (`playerIdMasked` / `amount` / `multiplier` / `isOwn`; `useHistoryStore().entries: {roundId, crashPoint}[]`).
- **Fix:** Implemented against the real store surfaces — FeedRow renders `amount` (Money toString) + `multiplier`, HistoryStrip reads `useHistoryStore().entries`. No store changes needed; the feed/history plumbing from 07-04 is consumed as-built.
- **Files modified:** (rendering components only — no store edits) `frontend/src/components/feed-row.tsx`, `frontend/src/components/live-feed.tsx`, `frontend/src/components/history-strip.tsx`
- **Commit:** `ea3cc0e`, `2562fdb`

**Total deviations:** 1 auto-fixed (Rule 3 interface alignment). No architectural changes; no scope creep; no new package installs (threat T-07-SC honored — scroll-area/tooltip landed in 07-03).

## TDD Gate Compliance

Both `tdd="true"` tasks followed RED -> GREEN: the failing test was written and run first (Task 1 classifier: "no tests / module missing"; Task 2 feed: "no tests / module missing"), then the implementation made it green. Per the established repo convention (noted across 07-04/05/06 SUMMARYs), each task landed as a single `feat` commit pairing test + implementation rather than discrete RED/GREEN commits. No REFACTOR commit was needed.

## Known Stubs

- **History chip click is an intentional no-op** — the chip-detail / fairness-verify drawer is Phase 8 (UI-SPEC reserves it explicitly). The chip is a real `button` with the tooltip; wiring the click is out of scope for this plan and tracked for P8.
- No data stubs: both surfaces read live store state landed and unit-tested in 07-04. 07-08 mounts them into the responsive layout with no further wiring.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface. The feed renders only `playerIdMasked` (server-masked, T-07-18, no raw id consumed); feed/history money is rendered via `Money.fromSnapshot(...).toString()` with only the multiplier as a number (T-07-19, `@crash/no-number-for-money` clean); history thresholds are read from config with no literal 1.5/2.0 (T-07-20, grep clean).

## Next Phase Readiness

- 07-08 places `<HistoryStrip />` along the top of the center stage and `<LiveFeed />` into the right rail of the D-01 responsive layout — both are self-contained, read their own stores, and need no props.
- The feed's own-action accent rail + the cashout-win celebration flag (07-04 `bet.store.celebrate`) are both ready for the 07-08 confetti/glow juice layer.

## Self-Check: PASSED

- Created files verified present: `features/history/history-band.ts`, `features/history/history-band.test.ts`, `components/history-strip.tsx`, `components/live-feed.tsx`, `components/feed-row.tsx`, `components/live-feed.test.tsx`
- Commits verified in `git log`: `ea3cc0e`, `2562fdb`
- tsc exit 0; 48/48 tests green; no literal thresholds; no hex in components; eslint money-rule clean

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-29*
