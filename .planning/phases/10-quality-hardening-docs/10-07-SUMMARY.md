---
phase: 10-quality-hardening-docs
plan: 07
subsystem: e2e-playwright
tags: [playwright, e2e, req-test-05, data-testid, storage-state, ws-sync]
requires: [10-01, 10-02, 10-06]
provides:
  - "Two REQ-TEST-05 Playwright specs pass against the live docker stack: bet-cashout (happy path) and bet-crash (bet lost)"
  - "Stable selectors via data-testid hooks on game-root, balance-pill, connection-badge, bet-amount-input, bet-place-button, cashout-button"
  - "Phase-sync helper waitForFreshBettingWindow that anchors on the server's bettingEndsAt + the FE-projected data-round-status so specs never click into a closing window"
affects: [e2e, frontend (testid hooks already shipped Task 1 @ 73cabf2)]
tech_stack_added: []
tech_stack_patterns:
  - "data-* attribute as a Playwright sync primitive: FE projects round.status + bet lastOutcome onto game-root as data-round-status / data-last-bet-outcome — Playwright page.waitForFunction reads them deterministically without text matching"
  - "Network response capture via page.waitForResponse for early-fail on bet-placement HTTP errors (server returns 202 Accepted, not 200) with the response body surfaced into the expect message"
  - "Instant-crash flake recovery via Promise.race between cashout-button visible and data-round-status=CRASHED + page.reload between attempts to reset bet-store state"
key_files_created: []
key_files_modified:
  - e2e/specs/bet-cashout.spec.ts
  - e2e/specs/bet-crash.spec.ts
  - e2e/fixtures/auth.fixture.ts
  - e2e/playwright.config.ts
  - .planning/phases/10-quality-hardening-docs/deferred-items.md
decisions:
  - "Sync on data-round-status (FE-projected) AND on server bettingEndsAt (fetched directly from Kong) — the FE-only signal is 100-300ms behind the server's actual state transition because WS events lag the round-loop, and clicking Place Bet in the last 1-2s of BETTING reliably trips the 409/410 bet-window-closed branch"
  - "Accept any 2xx status from POST /games/bet (the server returns 202 Accepted with status:PENDING) instead of hardcoding 200; the bet flips to ACTIVE asynchronously via WS bet:my_active when round transitions to RUNNING"
  - "Bet ACTIVE confirmation comes from waiting for the cashout-button to render (canCashout = status==='RUNNING' && myBet?.status==='ACTIVE') — NOT from the bet-place-button text changing to 'Bet Active', because that text only flips once myBet is set, and myBet is only set via WS bet:my_active which fires at round:running not at bet-placement time"
  - "Page reload between attempts is the cleanest reset for the bet-store: the FE never clears myBet between rounds for CASHED_OUT bets (only LOST bets clear via resolveLostForRound on round:settled), so a successful cashout leaves myBet stuck which blocks any subsequent placeBet on the same page; reload restores myBet=null via the round:snapshot fetch"
metrics:
  duration_minutes: 60
  completed_at: "2026-05-31T20:35Z"
  tasks_completed: 1
  files_changed: 5
  files_created: 1
  commits: 4
requirements: [REQ-TEST-05]
---

# Phase 10 Plan 07: REQ-TEST-05 Playwright specs against the live docker stack

Replaces the `test.skip` scaffolds from plan 10-01 with two real Playwright specs that exercise the player flow end-to-end. Task 1 (data-testid hooks) already landed at `73cabf2` before this executor wave; this plan focused on Task 2 (the specs themselves) plus three ESM/test-infrastructure fixes that unblocked them.

## What landed

### Spec A — bet-cashout (commit `f3c9ffc`)

`e2e/specs/bet-cashout.spec.ts` drives the happy-path REQ-TEST-05(a) flow:

1. Load `/`, wait for `connection-badge[data-status=live]` (WS handshake green).
2. Capture starting balance from `balance-pill`.
3. Wait for a **fresh** BETTING window (>=3.5s remaining) via the `waitForFreshBettingWindow` helper that polls the server's `/games/rounds/current` for `bettingEndsAt`.
4. Fill `5.00` into `bet-amount-input` and click `bet-place-button`, capturing the `POST /games/bet` response — fail fast with the server's body if it returns 4xx.
5. Wait for `data-round-status=RUNNING` on `game-root`.
6. Race `cashout-button.waitFor(visible)` against `data-round-status=CRASHED` — if the round crashed before the cashout button rendered (instant-crash 1/101 odds, or saga refund), reload the page and retry up to 5 times.
7. Click the cashout button.
8. Wait for `data-last-bet-outcome` on `game-root` to transition from its pre-attempt value to `CASHED_OUT`.
9. Assert the balance pill text differs from the starting balance.

### Spec B — bet-crash (commit `f3c9ffc`)

`e2e/specs/bet-crash.spec.ts` mirrors Spec A but never clicks cashout:

1. Same connection + fresh-betting-window prelude.
2. Place a 5.00 bet (same response-capture pattern).
3. Wait for `data-round-status=CRASHED` (up to 180s — the crash-point distribution can land anywhere from 1.00x to ~100x).
4. Wait for `data-last-bet-outcome` to flip to `LOST` (set by the FE's `resolveLostForRound` reaction to the `round:settled` WS event).

### ESM-loader fixes (commit `23531e4`, Rule 3)

Plan 10-01 wrote the fixture + config with CommonJS-style `__dirname` and `require.resolve("./fixtures/auth.fixture")`. Playwright 1.60 loads the config through Node's ESM loader (because the package roots resolve to `type: module`), where neither symbol exists — both threw `ReferenceError` before the first test could run. Fixed by:

- `e2e/fixtures/auth.fixture.ts` — derive the fixture directory from `dirname(fileURLToPath(import.meta.url))` and use that to compose `STORAGE_STATE_PATH`.
- `e2e/playwright.config.ts` — drop `require.resolve(...)` for a literal `path.resolve(CONFIG_DIR, "fixtures/auth.fixture.ts")` against the same `fileURLToPath(import.meta.url)` directory.

This is purely an infrastructure correction; no behavior change to the auth fixture.

### Deferred-items log (commit `8229404`)

`.planning/phases/10-quality-hardening-docs/deferred-items.md` already had a pending entry documenting the FE vitest regression (147 failing tests pre-dating 10-07). Committed as part of the closeout — Task 1 verification ran `bun test` and observed the regression, but proved Task 1's testid edits were byte-stable (identical fail count with and without the edits). Triage of the replay-store selectors that drive most of those failures is recommended for a future plan, not 10-07.

## Verification

Three back-to-back full runs (each with a fresh `.auth/` and clean `test-results/`):

| Run | bet-cashout | bet-crash | total |
|-----|-------------|-----------|-------|
| 1 | PASS (41.3s) | PASS (1.1m) | 1.8m |
| 2 | PASS (1.2m) | PASS (26.9s) | 1.6m |
| 3 | PASS (16.0s) | PASS (8.2s) | 25.2s |

Plan acceptance gates:

- `grep -c "test\.skip" e2e/specs/*.spec.ts` returns 0 (was 2 before Task 2).
- `grep -c "getByTestId" e2e/specs/*.spec.ts` returns 13 (9 cashout + 4 crash) — well over the >=4 floor.
- Both specs assert via stable `data-testid` + `data-*` attribute selectors — zero brittle text matching used for element selection.
- `bunx playwright test --config=e2e/playwright.config.ts` exits 0 against the live docker:up stack + frontend dev server, no retries needed.

## Deviations from Plan

### Rule 3 — Auto-fix blocking issues

**1. ESM `__dirname` / `require.resolve` in plan 10-01 scaffolds**
- **Found during:** Task 2 first `bunx playwright test` run.
- **Issue:** Both `e2e/fixtures/auth.fixture.ts` and `e2e/playwright.config.ts` used CommonJS-only symbols that Playwright's ESM config loader cannot resolve.
- **Fix:** Replaced with `fileURLToPath(import.meta.url)` + a literal path. Two commits each touching one file.
- **Commit:** `23531e4`

### Rule 1 — Auto-fix bugs

**2. Plan-encoded spec body expected text-based selectors and 200 status**
- **Found during:** Task 2 second + third `bunx playwright test` runs.
- **Issue:** The plan's literal spec body (per 10-RESEARCH "Code Examples") asserted on `toContainText(/live|connected/i)` for the connection badge, used `expect(placeButton).toHaveText(/bet active/i)` to detect a placed bet, and an unstated 200 assumption for POST /games/bet. All three are wrong against the live FE: the badge has `data-status="live"` not text "Live" guaranteed; the "Bet Active" text only renders after `bet:my_active` fires (which is at `round:running`, not at HTTP-200 time); and the bet endpoint returns 202 Accepted with body `{betId, status: "PENDING"}`.
- **Fix:** Switched all element-state assertions to `toHaveAttribute("data-status", "live")` / `getAttribute("data-round-status")` / `getAttribute("data-last-bet-outcome")`. Accepted any 2xx response. Anchored "bet is now active" on the cashout-button rendering, not on the place-button text.
- **Commit:** `f3c9ffc`

**3. Instant-crash race left the cashout-button never-visible**
- **Found during:** Stability runs 2 and 3 of the spec.
- **Issue:** When the round draws a 1.00x instant-crash (1-in-101 odds per the `INSTANT_CRASH_BUCKET=101` env), or when the saga refunds the bet because it landed too close to BETTING end, the cashout-button never renders during RUNNING and the spec timed out after 30s with `TimeoutError: locator.waitFor`.
- **Fix:** Wrap the cashout-button wait in `Promise.race` against a `data-round-status=CRASHED` watcher. If the round crashed first, classify as "instant-crash" and retry the whole attempt after a `page.reload()` (which forces a fresh `round:snapshot` to reset `myBet=null`, so the next attempt can place a new bet). Cap at 5 attempts.
- **Commit:** `f3c9ffc`

**4. Race between place-bet click and BETTING window close**
- **Found during:** Stability runs 1 and 2.
- **Issue:** `data-round-status="BETTING"` flips on the FE 100-300ms after the server enters BETTING because the WS event has to propagate. If the spec catches BETTING with only 500ms left on the server, the click → HTTP roundtrip races the server's BETTING→RUNNING transition; the server returns 409/410 bet-window-closed; the FE shows a toast; myBet stays null and the spec is stuck.
- **Fix:** Added `waitForFreshBettingWindow(page, minRemainingMs)` that polls `/games/rounds/current` for the server's authoritative `bettingEndsAt` and only returns when the FE sees BETTING AND the server says >=3.5s remain. If the current window is too short, wait for the next one.
- **Commit:** `f3c9ffc`

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes were introduced. The threat-model entries from the original plan (T-10-17 OIDC token disclosure via `.auth/`; T-10-18 brittle text-match selectors) are both observably mitigated — `.gitignore` excludes `.auth/`, and every element selector in both specs is `getByTestId` or attribute-based.

## Self-Check: PASSED

- `e2e/specs/bet-cashout.spec.ts` exists (180 lines).
- `e2e/specs/bet-crash.spec.ts` exists (109 lines).
- `e2e/fixtures/auth.fixture.ts` exists with ESM-correct `STORAGE_STATE_PATH`.
- `e2e/playwright.config.ts` exists with ESM-correct `globalSetup` path.
- All 4 commits present in `git log --all`: `73cabf2` (Task 1, prior wave), `23531e4` (ESM fix), `f3c9ffc` (Task 2 specs), `8229404` (deferred-items closeout).
- `grep -c "test\.skip" e2e/specs/*.spec.ts` returns 0.
- Three consecutive end-to-end runs all green (2 passed each).
