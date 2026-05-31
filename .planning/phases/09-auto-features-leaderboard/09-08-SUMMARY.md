---
phase: 09-auto-features-leaderboard
plan: 08
subsystem: frontend / auto-bet (store + strategy + driver + tabbed BetPanel + 5-field form)
tags:
  - frontend
  - auto-bet
  - zustand
  - shadcn-tabs
  - shadcn-radio-group
  - ws-driver
  - tdd
requires:
  - 09-01-PLAN.md (VITE_AUTO_BET_MIN_TARGET / MAX_TARGET via getConfig().autoBet)
  - 09-02-PLAN.md (PlaceBetRequestDto.autoCashoutTarget — server-validated)
  - 09-05-PLAN.md (AutoCashoutTickService — server-enforced auto-cashout)
  - Phase 7 P07-04 Zustand slice-per-concern pattern + parseBetAmount Money VO validator
  - Phase 7 P07-05 dedupedToast amber warning surface
provides:
  - "frontend/src/features/auto-bet/strategy.ts: pure nextBetAmount(strategy, base, lastOutcome, ctx) — Martingale base = configured initial (REQ-AUTO-02)"
  - "frontend/src/features/auto-bet/auto-bet.store.ts: per-session Zustand slice (NO persist — REQ-AUTO-04) with isRunning, config, sessionPL Money, sessionPLSign, roundCount, halted reason, start/stop/recordOutcome/recordPostedBet actions"
  - "frontend/src/features/auto-bet/auto-bet-driver.ts: useAutoBetDriver hook mounted in __root.tsx; subscribes to round:started + round:settled + bet:my_cashed_out + bet:my_refunded via subscribeWsEvent; POSTs PlaceBet with autoCashoutTarget on round:started; halts on stop-win / stop-loss / insufficient-balance with deduped amber toast"
  - "frontend/src/components/bet-panel.tsx: shadcn Tabs (defaultValue='manual') wrapping ManualTabContent + AutoBetForm with Lock-icon on Manual trigger + pulsing accent dot on Auto trigger while running"
  - "frontend/src/components/auto-bet-form.tsx: 5-field form (target + strategy RadioGroup + base + stop-loss + stop-win) with Start/Stop button (accent-fill idle-valid, destructive-bordered outline when running — NO destructive fill)"
  - "frontend/src/components/auto-bet-session-panel.tsx: Mono Data Session P/L (accent positive, muted negative — NOT red) + Next bet preview via strategy.ts"
  - "frontend/src/components/manual-tab-content.tsx: wraps Phase 7 form verbatim, prepends Lock+Alert + opacity-50 + inputs disabled when isRunning"
affects:
  - frontend/src/stores/ws-dispatch.ts (subscribeWsEvent pub-sub surface introduced for the driver)
  - frontend/src/routes/__root.tsx (useAutoBetDriver mounted inside GameSession alongside useGameSocket)
tech-stack:
  added:
    - "@radix-ui/react-radio-group (transitive — via shadcn radio-group install in Task 0)"
  patterns:
    - "TDD RED → GREEN per task: failing tests committed first, GREEN follows with implementation"
    - "Driver is event-only — no setInterval anywhere in features/auto-bet/ (RESEARCH Anti-Patterns)"
    - "Store has no persist middleware (REQ-AUTO-04 — grep-gate test asserts source contains no 'persist' string)"
    - "Strategy is a pure function with no side effects; consumed by both the driver (for POST) and the session panel (for Next bet preview) — single source of truth"
    - "Money VO end-to-end: every monetary read/write uses Money.of(bigint) + Money.fromSnapshot + Money.add/subtract; ESLint custom rule never tripped"
    - "Form-vs-running config divergence: when isRunning, inputs render the LOCKED config from the store (config.target.toString() etc.) rather than the local component state — prevents stale-state flash mid-session"
key-files:
  created:
    - frontend/src/components/auto-bet-form.tsx
    - frontend/src/components/auto-bet-form.test.tsx
    - frontend/src/components/auto-bet-session-panel.tsx
    - frontend/src/components/manual-tab-content.tsx
    - frontend/src/components/bet-panel.test.tsx
    - frontend/src/components/ui/radio-group.tsx
    - frontend/src/features/auto-bet/strategy.ts
    - frontend/src/features/auto-bet/strategy.test.ts
    - frontend/src/features/auto-bet/auto-bet.store.ts
    - frontend/src/features/auto-bet/auto-bet.store.test.ts
    - frontend/src/features/auto-bet/auto-bet-driver.ts
    - frontend/src/features/auto-bet/driver-stops.test.ts
    - .planning/phases/09-auto-features-leaderboard/09-08-SUMMARY.md
  modified:
    - frontend/src/components/bet-panel.tsx
    - frontend/src/stores/ws-dispatch.ts
    - frontend/src/routes/__root.tsx
decisions:
  - "Stop button uses variant='outline' + border-destructive + text-destructive only — NO bg-destructive. Red surface is reserved for crash flash per Phase 7 D-02 inherited; the destructive border + text + Pause icon are the single concession to using #EF4444 outside crash."
  - "Manual tab stays clickable when auto is running so the user can SEE the disabled treatment (inline Alert + opacity-50 + HTML disabled inputs). The Lock icon on the Manual trigger is the visual signal without preventing tab navigation."
  - "Driver POSTs on round:started (NOT round:settled) per RESEARCH Q3 — avoids the 409 ROUND_NOT_IN_BETTING_PHASE race window. A 409 from a stale POST is treated as transient (driver stays running), not a halt."
  - "Session P/L magnitude + sign are stored as (Money, -1|0|1) tuple rather than a signed Money. This sidesteps Money.of throwing on negatives while preserving Money VO arithmetic at every boundary; the form reconstructs the rendered sign at display time via signedSessionPLLabel."
  - "AutoBetForm reads the LOCKED store config when isRunning so the inputs show the active values (not the local component state from before Start). On Stop, the local state remains intact so a user can immediately Re-Start with the same numbers — no UI reset penalty."
  - "Strategy options 'Fixed' default + 'Martingale' second matches UI-SPEC §Surface A.1 verbatim; tooltips locked to UI-SPEC §Copywriting Contract copy."
  - "Touch-target gate ≥44px enforced via min-h-11 Tailwind class on every Input, Button, and RadioGroup row — per UI-SPEC §Accessibility CRITICAL."
metrics:
  duration: "approximately 25 minutes (Task 3 only — Tasks 0-2 landed in prior agent sessions)"
  completed: 2026-05-30
  tasks_total: 4
  tasks_complete: 4
  tests_added: 48
  commits: 7
---

# Phase 9 Plan 08: FE Auto-bet store + driver + strategy + AutoBetForm + tabbed BetPanel Summary

**One-liner:** Per-session Zustand auto-bet stack (strategy.ts + auto-bet.store.ts + auto-bet-driver.ts) wired into a shadcn-Tabs BetPanel with a 5-field AutoBetForm + cumulative Session P/L panel, driver subscribed to round:started / round:settled / bet:my_cashed_out / bet:my_refunded firing PlaceBet mutations with autoCashoutTarget — REQ-AUTO-02/03/04/05 closed.

---

## What landed

### Task 0 — shadcn radio-group install (checkpoint)

`bunx shadcn@latest add radio-group` (commit `e3f0d15`). Scaffolds `frontend/src/components/ui/radio-group.tsx` (Radix-backed via `@radix-ui/react-radio-group` transitive dep — same provenance as the existing Radix tabs/dialog primitives). Human-verified at shadcn's official registry per Task 0 gate.

### Task 1 — strategy.ts + auto-bet.store.ts (TDD)

- `nextBetAmount('fixed', base, *, *)` → base (no state).
- `nextBetAmount('martingale', base, null|'win', *)` → base (reset to BASE per REQ-AUTO-02 + CONTEXT §Specifics — base = configured initial, NOT previous bet).
- `nextBetAmount('martingale', base, 'loss', { lastBet })` → `lastBet.multiplyRounded({numerator: 2n, denominator: 1n})` (double previous bet).
- `useAutoBetStore` is a per-session Zustand slice with **NO persist middleware**. Source-grep test asserts neither `"persist"` nor `"zustand/middleware"` appears in the file (REQ-AUTO-04 gate).
- Session P/L is stored as `{ sessionPL: Money, sessionPLSign: -1 | 0 | 1 }` to keep Money VO discipline while supporting negative values; `applyDelta` is a pure helper that adds/subtracts magnitudes and flips sign when the delta crosses zero.
- `recordOutcome('refund', ...)` is a no-op (refund ≠ played round per Pitfall 8 + Q1); halted sessions ignore further `recordOutcome` calls (idempotent post-halt).

Commits: `ee38a67` RED + `d0d4f1c` GREEN.

### Task 2 — useAutoBetDriver + ws-dispatch subscribeWsEvent surface

- `frontend/src/stores/ws-dispatch.ts` gained a `subscribeWsEvent(event, handler)` pub-sub surface (additive; existing in-process handlers untouched). The driver registers handlers for `round:started`, `round:settled`, `bet:my_cashed_out`, `bet:my_refunded`.
- `frontend/src/features/auto-bet/auto-bet-driver.ts`:
  - On `bet:my_cashed_out`: reads the active bet from `useBetStore.myBet`, calls `recordOutcome('win', betAmount, payout)`.
  - On `bet:my_refunded`: calls `recordOutcome('refund', amount, Money.of(0n))` — no-op for P/L.
  - On `round:settled`: if the active bet status is `LOST`, calls `recordOutcome('loss', betAmount, Money.of(0n))`.
  - On `round:started`: checks stop-win first (sessionPLSign === 1 AND magnitude ≥ stopWin) → halt + amber toast. Then stop-loss (sessionPLSign === -1 AND magnitude ≥ stopLoss). Then balance + bet-cap gates. Then computes `nextBetAmount` from strategy + last outcome + last bet, and fires `placeBet.mutate({ money: next, autoCashoutTarget: config.target })`. On success, `recordPostedBet(next)` updates `lastBetAmount` BEFORE the outcome event arrives.
  - POST 409 (`bet-window-closed`) is transient — driver stays running. POST 402 (`insufficient-balance`) → halt with insufficient-balance reason + amber toast.
- `__root.tsx` mounts `useAutoBetDriver()` inside the existing `GameSession` client-only component alongside `useGameSocket()` — single mount per session.

Commits: `189317f` RED + `3ecfe28` GREEN.

### Task 3 — AutoBetForm + AutoBetSessionPanel + ManualTabContent + BetPanel Tabs refactor (TDD)

- `frontend/src/components/auto-bet-form.tsx`:
  - 5 fields stacked at `gap-4` (UI-SPEC `md` 16px): Target (Input type=number step=0.01 min/max from `getConfig().autoBet`), Strategy (shadcn RadioGroup with Fixed default + Martingale, each wrapped in a Tooltip with locked copy), Base bet (parseBetAmount Money VO), Stop-loss (parseBetAmount), Stop-win (parseBetAmount).
  - Inline validation on blur via per-field `touched` flags; errors render below the input in `text-muted-foreground` (NOT red); `aria-describedby` wires error to input.
  - Start button: `variant="default"` accent fill when valid, `disabled` (opacity-50 via shadcn default) when invalid; lucide `Play` icon.
  - Stop button (when running): `variant="outline"` + `border-destructive text-destructive` + lucide `Pause` icon — **no bg-destructive** (grep-gate green).
  - All inputs HTML-disabled + `aria-disabled` when running; reads `config` from store to render the locked values.
- `frontend/src/components/auto-bet-session-panel.tsx`:
  - Renders only when `isRunning && config !== null`.
  - Session P/L line: `+12.50 CRD` (accent-text) for positive, `-4.30 CRD` (muted-foreground) for negative, `0.00 CRD` (muted) for zero. Round-count suffix `(3 rounds)` (or `1 round` singular).
  - Next bet preview line: `Next bet: 10.00 CRD (fixed)` or `Next bet: 20.00 CRD (martingale, after loss)` — uses the same `nextBetAmount` the driver consumes.
- `frontend/src/components/manual-tab-content.tsx`:
  - Extracts the Phase 7 BetPanel form verbatim (amount Input + Place Bet button); preserves canBet status gate.
  - When `useAutoBetStore.isRunning`: wraps the form in `opacity-50`, prepends a shadcn `Alert` with lucide `Lock` icon + `border-accent` + title "Auto-bet is running" + description "Switch to the Auto tab to stop.", and forces `disabled` + `aria-disabled` on every input/button.
- `frontend/src/components/bet-panel.tsx`:
  - Card surface preserved; body becomes `<Tabs defaultValue="manual">` with a `grid grid-cols-2` TabsList (≥44px tall).
  - Manual TabsTrigger: shows lucide `Lock` 12px muted-foreground when running.
  - Auto TabsTrigger: lucide `Bot` icon 14px to the LEFT of the label; pulsing 6px accent dot to the RIGHT when running (`motion-safe:animate-pulse` so reduced-motion users get a static dot).

Tests: 13 `auto-bet-form.test.tsx` cases + 4 `bet-panel.test.tsx` cases — all green.

Commits: `156d1ab` RED + `937c4d7` GREEN.

---

## Verification

- `bunx vitest run` — **217 / 217 tests pass** in 3.12s across 34 files (was 200/200 at Plan 09-06 close; +17 from this plan).
- `bunx tsc --noEmit` exit 0 across the frontend workspace.
- `bun run lint` clean (only pre-existing `routeTree.gen.ts` auto-generated warning unrelated to this plan, carried in `deferred-items.md` from Phase 7).
- `grep "persist" frontend/src/features/auto-bet/auto-bet.store.ts` — returns 0 matches (REQ-AUTO-04 grep gate).
- `grep "setInterval" frontend/src/features/auto-bet/auto-bet-driver.ts` — returns 0 matches (RESEARCH Anti-Patterns gate).
- `grep "bg-destructive" frontend/src/components/auto-bet-form.tsx` — returns 0 matches (UI-SPEC §Color destructive-border-only gate).

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test interaction] BetPanel Tab switch via fireEvent.click did not trigger Radix Tabs state change**
- **Found during:** Task 3 GREEN run.
- **Issue:** Radix Tabs primitives in this codebase do not respond to `fireEvent.click` in jsdom (Radix `TabsTrigger` activates on `pointerDown` / `keyDown`). The test "clicking Auto reveals the auto-bet form" failed with a silent no-op state.
- **Fix:** Switched the test to `fireEvent.keyDown(autoTrigger, { key: 'ArrowRight' }) → fireEvent.keyDown(autoTrigger, { key: 'Enter' })` which exercises the same Radix keyboard nav code path the a11y testers use. No production code change.
- **Files modified:** `frontend/src/components/bet-panel.test.tsx`
- **Commit:** `937c4d7` (combined with the GREEN implementation).

**2. [Rule 1 — UI-SPEC literal compliance] Stop button initially included `hover:bg-destructive/10`**
- **Found during:** Task 3 GREEN run.
- **Issue:** UI-SPEC §Color explicitly forbids any `bg-destructive` surface on the Stop button (border + text only). The initial hover treatment violated the grep gate.
- **Fix:** Removed the hover background so the button keeps the destructive border + text but never tints its surface. The shadcn default `disabled:opacity-50` + the `motion-safe:active:scale-95` press feedback remain — the user still gets clear hover-vs-press affordance via focus ring + press scale.
- **Files modified:** `frontend/src/components/auto-bet-form.tsx`
- **Commit:** `937c4d7`.

No other deviations. Tasks 0/1/2 executed in prior agent sessions exactly as specified.

---

## Commits

| Hash | Type | Message |
|------|------|---------|
| `e3f0d15` | chore | shadcn radio-group primitive install |
| `ee38a67` | test | RED tests for auto-bet strategy + store |
| `d0d4f1c` | feat | GREEN strategy.ts + auto-bet.store.ts |
| `189317f` | test | RED tests for auto-bet driver stops + POST errors |
| `3ecfe28` | feat | GREEN auto-bet-driver.ts + ws-dispatch subscribeWsEvent + __root mount |
| `156d1ab` | test | RED tests for AutoBetForm + BetPanel tabbed refactor |
| `937c4d7` | feat | GREEN AutoBetForm + AutoBetSessionPanel + ManualTabContent + BetPanel Tabs |

---

## Threat Model Disposition

- **T-09-50 (DevTools tampering bypass stops)** — accepted; server-side BET_MAX_CENTS + balance gates + wallet refusal are the real defense.
- **T-09-51 (driver fail-loop)** — mitigated; driver only fires one POST per `round:started` event, 409 is transient (no halt), 402 halts immediately. Test coverage in `driver-stops.test.ts`.
- **T-09-52 (config persists across reload)** — mitigated; NO persist middleware. Grep-gate test in `auto-bet.store.test.ts` locks the invariant.
- **T-09-53 (form bypass via store mutation)** — mitigated; server Zod from Plan 09-02 rejects invalid target before the saga runs.
- **T-09-SC (package legitimacy)** — mitigated; Task 0 checkpoint human-verified shadcn radio-group at the official registry before install.

---

## Plan unblocks

- **Plan 09-09** (FE LeaderboardPanel) — `subscribeWsEvent` pub-sub surface on `ws-dispatch.ts` is now established; the leaderboard panel will reuse the same pattern for `leaderboard:updated`.
- **Plan 09-10** (closeout / ADRs) — locks an ADR candidate: "FE auto-bet driver architecture: event-only Zustand slice + ws-dispatch subscription, no setInterval, no persist, Martingale base = configured initial" — captures REQ-AUTO-02..05 design decisions in one ADR.

REQ-AUTO-02 + REQ-AUTO-03 + REQ-AUTO-04 + REQ-AUTO-05 closed.

---

## Self-Check: PASSED
