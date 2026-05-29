---
phase: 07-frontend-vertical-slice
plan: 05
subsystem: frontend
tags: [money-vo, bet-panel, cashout, countdown, zustand-selector, tanstack-mutation, cva-accent, vitest, testing-library]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-04 stores (round/multiplier-isolated/bet) + getConfig bet bounds + protectedFetch Bearer; 07-03 shadcn button/card/input/label/progress + dark-casino @theme tokens; 07-01 @crash/no-number-for-money on .tsx + Kong CORS"
provides:
  - "parseBetAmount — the single Money-VO bet-amount validator (negative/scientific/out-of-bounds rejected; bounds from config, fraction length from the currency exponent)"
  - "use-place-bet / use-cashout TanStack mutations POSTing MoneySnapshot bodies and classifying errors by key (insufficient-balance / bet-window-closed / network; cashout 409 silent)"
  - "BetPanel — neutral Place Bet button, state-aware enable + 'Bet Active' label, inline validation reason in muted-foreground"
  - "CashoutButton — accent CTA with live bet x renderedMultiplier Money payout, enabled only ACTIVE+RUNNING, subscribed to the isolated multiplier store (D-06)"
  - "Countdown — BETTING-window seconds + thin progress bar derived from round.store.bettingEndsAt (no hardcoded duration)"
affects: [07-08, frontend]

# Tech tracking
tech-stack:
  added:
    - "First @testing-library/react component render test in the app (cashout-button.test.tsx)"
  patterns:
    - "Money-VO end-to-end: bet amount + payout are Money VOs; the only number is the multiplier factor (renderedMultiplier) — never money"
    - "Zustand selector subscriptions: CashoutButton selects renderedMultiplier from the isolated multiplier store, status from round, myBet from bet — no per-frame coupling to other stores (D-06)"
    - "Config-derived bounds + currency exponent: parseBetAmount derives the decimal fraction length from CRD.exponent and bounds from config, zero literals"

key-files:
  created:
    - frontend/src/features/bet/bet-amount.ts
    - frontend/src/features/bet/bet-amount.test.ts
    - frontend/src/features/bet/use-place-bet.ts
    - frontend/src/features/bet/use-cashout.ts
    - frontend/src/components/bet-panel.tsx
    - frontend/src/components/cashout-button.tsx
    - frontend/src/components/cashout-button.test.tsx
    - frontend/src/components/countdown.tsx
  modified:
    - .planning/phases/07-frontend-vertical-slice/deferred-items.md

key-decisions:
  - "Fraction-digit length and the cents radix are derived from CRD.exponent / CRD.base, not literals — the validator stays correct if the currency exponent ever changes"
  - "HTTP status -> error-key mapping for place-bet: 402 -> insufficient-balance, 409/410 -> bet-window-closed, everything else / throw -> network (toast rendering owned by 07-08)"
  - "Cashout error surface narrowed to network only; 409 (too late) resolves silently per UI-SPEC; the authoritative bet:my_cashed_out arrives via WS"
  - "Countdown window length is captured once when BETTING first becomes visible (remaining-at-mount), so the progress fraction is derived from the live snapshot timing rather than a hardcoded betting-window constant"

requirements-completed: [REQ-FE-04, REQ-FE-05, REQ-FE-06]

# Metrics
duration: ~8min
completed: 2026-05-29
---

# Phase 7 Plan 05: Bet Panel, Cashout & Countdown Summary

**Built the left-rail money controls that make the loop playable: a pure `parseBetAmount` Money-VO validator (rejects negatives, scientific notation, and out-of-[min,max] against config bounds with the currency-exponent-derived decimal pattern), the `use-place-bet` / `use-cashout` TanStack mutations that POST `MoneySnapshot` bodies and classify failures by key, a neutral state-aware `BetPanel`, an accent `CashoutButton` whose live `Cash Out {m}x · {payout}` label is `bet × renderedMultiplier` as a Money VO subscribed to the isolated multiplier store (D-06), and a `Countdown` driven by `round.store.bettingEndsAt`.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-05-29
- **Tasks:** 2 of 2 complete (both `type=auto`, `tdd=true`)
- **Files:** 8 created, 1 modified (deferred-items.md)

## Accomplishments

- **Task 1 — Money-VO validator + bet/cashout mutation hooks (`2917997`):** `features/bet/bet-amount.ts` exports `parseBetAmount(raw)` returning a discriminated `{ ok: true, money: Money } | { ok: false, reason: 'invalid'|'below-min'|'above-max' }`. The decimal pattern is built from `CRD.exponent` (fraction length) and the cents radix from `CRD.base` — no literal fraction count, no literal bounds. It validates the raw string against a strict `^\d+(\.\d{1,N})?$` pattern BEFORE constructing Money, so `-5`, `1e3`, `""`, and `10.001` are rejected as `invalid` before `Money.of` can throw; bounds use `Money.lessThan`/`greaterThan` against `Money.of(BigInt(config.bet.minCents/maxCents))`. `use-place-bet.ts` is a `useMutation` POSTing `{ amount: money.toSnapshot() }` to `/games/bet` via `protectedFetch`, mapping 402→`insufficient-balance`, 409/410→`bet-window-closed`, network/other→`network` (typed `PlaceBetError`), flipping `bet.store.pending` on mutate/settle and NOT optimistically setting `myBet`. `use-cashout.ts` POSTs `{ betId }` to `/games/bet/cashout`; ok or 409 resolves silently, everything else is a `CashoutError('network')`.
- **Task 2 — BetPanel + CashoutButton (live payout) + Countdown (`da4ed36`):** `components/cashout-button.tsx` selects `renderedMultiplier` from the isolated multiplier store, `myBet` from bet, `status` from round; gates `status==='RUNNING' && myBet?.status==='ACTIVE'` (returns null otherwise), computes `Money.fromSnapshot(myBet.amount).multiplyRounded(renderedMultiplier)` and renders `Cash Out {renderedMultiplier.toFixed(2)}x · {payout.toString()}` on an accent button (`bg-accent text-accent-foreground` tokens + the UI-SPEC `rgba(0,255,133,0.35)` glow), 44px touch target, onClick → `useCashout().mutate()`. `components/bet-panel.tsx` is a shadcn `card` with a labelled `input` and a NEUTRAL `secondary`+`border` Place Bet button; it runs `parseBetAmount` on the typed value, shows the reason copy in `muted-foreground` (not red, per D-02), enables iff `status==='BETTING' && !myBet && !pending && parse.ok`, and switches the label to "Bet Active" when a bet exists. `components/countdown.tsx` subscribes to `bettingEndsAt`+`status`, renders "Betting closes in {n}s" (ceil remaining) + a thin `progress` bar on a 250ms interval cleared on unmount/status-change, with the window length captured once at BETTING entry so the fraction is snapshot-derived, not hardcoded; renders null when not BETTING.

## Task Commits

1. **Task 1 — Money-VO bet-amount validator + bet/cashout mutation hooks:** `2917997` (feat)
2. **Task 2 — bet panel, live-payout cashout button, betting countdown:** `da4ed36` (feat)

## Verification Evidence

- `cd frontend && bunx tsc --noEmit` → exit 0 (clean)
- `bun run test` → 27 passed (5 files: config 7, bet-amount 7, ws-dispatch 6, oidc-guard 4, cashout-button 3)
- bet-amount test asserts the valid case `parseBetAmount("10.00").money.toSnapshot().amount === "1000"` (currency "CRD"); negative/scientific/empty/3-decimals → `invalid`; `0.50` → `below-min`; `2000.00` → `above-max` (config min 100 / max 100000 mocked)
- cashout-button test: RUNNING + myBet ACTIVE (amount 1000, multiplier 2.41) → enabled button containing `Cash Out 2.41x` and `24.10 CRD`; BETTING → no button; payout matches `/\d+\.\d{2} CRD/` (Money toString, never a bare number)
- `grep -nE "100000|[^0-9]100[^0-9]" src/features/bet/bet-amount.ts` → empty (bounds from config)
- `grep -nE ":\s*number" src/features/bet/bet-amount.ts` → only `fractionDigits: number` (a digit-count, not money)
- `grep -rE "#[0-9A-Fa-f]{6}" src/components/{bet-panel,cashout-button,countdown}.tsx` → empty (no hardcoded hex; accent via theme tokens)
- `grep -c bettingEndsAt src/components/countdown.tsx` → 7 (>= 1)
- `bunx eslint src/features/bet src/components/cashout-button.tsx src/components/bet-panel.tsx src/components/countdown.tsx` → exit 0 (money rule clean on all new files)
- `git diff --diff-filter=D HEAD~2 HEAD` → no deletions

## Decisions Made

- **Currency-derived decimal precision** — the validator's fraction-digit count comes from `CRD.exponent` and the integer-cents radix from `CRD.base`, so a currency-exponent change does not silently break validation; no `2`/`100`/`100000` literals appear in the file.
- **Error-key classification lives in the hooks, rendering does not** — place-bet maps HTTP status to `insufficient-balance` / `bet-window-closed` / `network`; cashout 409 is silent. The toast surface is 07-08's job; these hooks only classify (typed `PlaceBetError`/`CashoutError`).
- **Snapshot-derived countdown window** — rather than a hardcoded betting-window duration (which CLAUDE.md forbids), the window length is the remaining-ms captured the first frame BETTING is visible; the progress fraction is `remaining / window`. This is the only available derivation since the round store exposes `bettingEndsAt` but no explicit window-start field.
- **bet.store field names** — the store uses `myBet.betId` (not `id`) and statuses `PENDING|ACTIVE|CASHED_OUT|LOST|REFUNDED`; the cashout gate keys on `myBet?.status === 'ACTIVE'` and the cashout body sends `betId`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CRD.base typed as `bigint | readonly bigint[]` broke the cents conversion**
- **Found during:** Task 1 (first tsc run)
- **Issue:** `CRD.base ** fractionExponent` failed tsc (`Operator '**' cannot be applied to 'bigint | readonly bigint[]'`), and `whole` from `raw.split(".")` could be `undefined`.
- **Fix:** Narrowed the radix via `Array.isArray(CRD.base) ? CRD.base[0] : CRD.base` and defaulted the whole part (`[whole = "0", ...]`).
- **Files modified:** `frontend/src/features/bet/bet-amount.ts`
- **Commit:** `2917997`

**Total deviations:** 1 auto-fixed (Rule 1 type-narrowing). No architectural changes; no scope creep; no new package installs (threat T-07-SC honored).

## Out-of-Scope Findings (logged, not fixed)

- `bun run lint` reports 2 errors in `frontend/src/lib/config.ts:30` (`@crash/no-number-for-money` on `minCents`/`maxCents`) and 1 warning in the generated `routeTree.gen.ts`. `config.ts` is a 07-04 file untouched by this plan; the bet-amount validator consumes those cents only to build `Money.of(BigInt(...))`, so no money value is ever a `number` downstream. Logged to `deferred-items.md`. The targeted eslint run on all 07-05 files is clean.

## Known Stubs

None. All three components consume the live 07-04 stores and call the real REST mutation hooks. The error-key toasts these hooks emit are intentionally rendered in 07-08 (per the plan and UI-SPEC), and the responsive layout placement of the three components is 07-08's job — these are sequenced follow-ups, not stubs that block this plan's goal (the controls are fully wired and unit-green).

## Threat Flags

None. No new network endpoints beyond the plan's `<threat_model>` (POST /games/bet, POST /games/bet/cashout — both in the register). T-07-12 (money-as-number) mitigated: amounts are Money VOs end-to-end, only `renderedMultiplier` is a number, money rule clean on all new files. T-07-13 (client trusting its own payout) honored: the cashout label is display-only; the authoritative payout arrives via the `bet:my_cashed_out` WS snapshot (07-04). T-07-14 (bet spam) mitigated: the Place Bet button is disabled while `pending` and once `myBet` exists.

## Self-Check: PASSED

- Created files verified present: `features/bet/bet-amount.ts` + `.test.ts`, `features/bet/use-place-bet.ts`, `features/bet/use-cashout.ts`, `components/bet-panel.tsx`, `components/cashout-button.tsx` + `.test.tsx`, `components/countdown.tsx`
- Commits verified in `git log`: `2917997`, `da4ed36`
- tsc exit 0; 27/27 tests green; money rule clean on new files

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-29*
