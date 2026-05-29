---
phase: 07-frontend-vertical-slice
verified: 2026-05-29T18:32:12Z
status: human_needed
score: 5/5 success criteria verified in code (static); live E2E smoke pending
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
human_verification:
  - test: "Live player loop smoke against docker:up — login as player/player123, wait for BETTING, place a bet, watch the curve climb during RUNNING, cash out, confirm balance increases; in a separate round let it crash and confirm the bet is lost."
    expected: "Unauth hit on / redirects to Keycloak; after login the game renders; bet places (202) and confirms via WS bet:my_active; cashout returns 200 with payout; BalancePill counts up; on crash the curve freezes at the server crash value with a red flash."
    why_human: "Requires a real Keycloak session, a running WS gateway, and a live autonomous round loop. jsdom has no real raster/fps; the bet→saga→wallet→WS round-trip cannot be exercised by unit tests. This is the one gate static analysis cannot cover."
  - test: "Multi-tab BroadcastChannel coordinated refresh — open three tabs of the game, wait for an access-token rotation, observe network traffic."
    expected: "All three tabs renew once per token rotation via a single coordinated refresh (oidc-spa-internal BroadcastChannel); no per-tab independent refresh storm."
    why_human: "Requires three real browser tabs and observing token rotation timing over the wire; oidc-spa's BroadcastChannel coordination is library-internal and cannot be asserted in jsdom."
  - test: "Canvas curve visual smoothness at 60fps and crash flash/freeze overlay during a live RUNNING→CRASHED transition."
    expected: "Curve climbs smoothly without jank; on crash a red flash plays then a brief freeze at the server crash value (reduced-motion users get freeze only)."
    why_human: "Perceptual fps and visual timing cannot be measured in jsdom; the canvas stub renders no real raster."
---

# Phase 7: Frontend Vertical Slice — Verification Report

**Phase Goal:** A logged-in player can complete the full Crash loop in a polished dark-casino UI — bet during the betting window, watch the multiplier climb in real time on a smooth Canvas curve, cash out (or lose), see their balance update, and view the live bet/cashout feed — fully responsive.

**Verified:** 2026-05-29T18:32:12Z
**Status:** human_needed (5/5 success criteria substantiated in code + static; live E2E smoke is a REQUIRED manual gate, NOT yet executed)
**Re-verification:** No — initial verification

---

## Verdict

**PASS (code + static evidence) — pending one REQUIRED manual gate.**

Every one of the 5 ROADMAP success criteria is backed by real, wired, non-stub code that flows live data (REST + WebSocket → Zustand stores → components). Static gates are all green:

- `bun run test` → **65/65 pass** (12 files)
- `bun run typecheck` (`tsc --noEmit`) → **exit 0, clean**
- `bun run lint` (`eslint src`) → **0 errors** (1 warning: unused eslint-disable in the generated `routeTree.gen.ts` — a regenerated artifact, not hand-edited; documented in deferred-items.md)

The verdict is **not** unconditional `passed` because the live player loop (real Keycloak login → bet → cashout/crash → balance) and the multi-tab + canvas-fps behaviors are inherently un-automatable here and must be confirmed by a human against `bun run docker:up`. Full Playwright E2E of this flow is **deliberately deferred to Phase 10 (REQ-TEST-05)** per `07-VALIDATION.md`, so the current expectation is a manual smoke, not an automated pass.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | Unauth → Keycloak redirect; silent renew; BroadcastChannel multi-tab (oidc-spa, not hand-rolled) | ✓ VERIFIED (code) / ? live | `routes/index.tsx:22` `beforeLoad: enforceLogin` + `ssr:false` on the game route; `auth/oidc.ts` single `oidcSpa.createUtils()` instance, `implementation:"real"`, PKCE-S256 is the library default; **zero** hand-rolled `setInterval`/`setTimeout`/`BroadcastChannel` in `auth/oidc.ts` (grep clean); `ws/socket.ts` pulls the token via `getOidc().getAccessToken()`. Guard test green (`oidc-guard.test.tsx`, 4 tests). Live login + 3-tab refresh → human gate. |
| 2 | Canvas curve rAF + devicePixelRatio + clearRect; local `multiplierAt` anchored to `roundStartedAt`, EWMA reconcile never-snap | ✓ VERIFIED (code) / ? live | `crash-curve.tsx` sizes canvas `width = cssWidth * dpr`, sets css size separately; `draw-curve.ts:39-40` `setTransform(dpr,...)` + `clearRect`; `use-raf-curve.ts` runs a `requestAnimationFrame` loop writing only the isolated multiplier store, freezes at `round.crashValue` on CRASHED, cancels leak-free; `local-multiplier.ts` uses shared `multiplierAt` from `@crash/contracts/multiplier` (`Math.exp((growthRate*elapsedMs)/1000)` = `e^(GROWTH_RATE*t/1000)`) anchored to `roundStartedAt + serverOffsetMs`; `reconcileOffset` / `multiplier.store.reconcile` apply EWMA (`prev + alpha*(inst-prev)`), never snap. 6 multiplier + 5 curve tests green. fps smoothness → human gate. |
| 3 | Bet input Money-VO validation + state-aware enable; cashout live payout enabled only ACTIVE+RUNNING; BETTING countdown | ✓ VERIFIED | `bet-amount.ts` `parseBetAmount` builds a `Money.of(BigInt(cents), CRD)` VO, rejects non-decimal/scientific/precision-overflow, enforces `bet.minCents`/`maxCents` bounds from env; `bet-panel.tsx` `canBet = BETTING && myBet===null && !pending && parsed.ok`, label flips to "Bet Active"; `cashout-button.tsx` renders only `RUNNING && myBet.status==='ACTIVE'`, live payout `Money.fromSnapshot(myBet.amount).multiplyRounded(renderedMultiplier)` subscribed to the isolated multiplier store; `countdown.tsx` reads `round.bettingEndsAt` from the snapshot (no hardcoded window). 7 bet-amount + 3 cashout tests green. |
| 4 | Live feed (own-highlight) + color-coded history (config thresholds) + balance counter-up + cashout celebration + crash flash/freeze | ✓ VERIFIED (code) / ? live | `live-feed.tsx` + `feed-row.tsx` render feed-store entries, own actions get `border-l-accent bg-accent/10` highlight (`isOwn` set in ws-dispatch by `myBet.betId` match), empty state present; `history-strip.tsx` + `history-band.ts` `classifyBand` reads `history.redMaxX`/`yellowMaxX` from env (`<=` inclusive, **no literal thresholds**); `use-count-up.ts` rAF tween + `BalancePill`; `celebrate.ts` single `canvas-confetti` burst (no setInterval) reduced-motion gated; `crash-flash.tsx` flash→freeze at `crashValue` reduced-motion gated. 4 feed + 6 history-band + 5 count-up tests green. Visual flash/freeze → human gate. |
| 5 | Responsive desktop+mobile + skeletons + deduped toasts + dark casino aesthetic | ✓ VERIFIED (code) / ? live | `routes/index.tsx` D-01 layout: history strip top, `lg:grid-cols-[320px_1fr_320px]` bet/curve/feed rails, single stacked column with `sticky bottom-0` controls below at mobile; `≥44px` touch targets (`min-h-11`); `game-skeletons.tsx` `CurveSkeleton`/`HistorySkeleton` gated on `!hasRound` / `history.isLoading`; `lib/toast.ts` `dedupedToast` keyed by message (one active per key, cleared on close/auto-close), amber warnings, wired into place-bet/cashout `onError` + network connection status; `__root.tsx` dark-by-default (`<html className="dark">`), `draw-curve.ts` uses UI-SPEC hexes (#00FF85→#22D3EE rising, #EF4444 crash). 4 toast + 8 index render tests green. Visual aesthetic → human gate. |

**Score:** 5/5 success criteria substantiated in code & static checks. 0 FAILED. 3 facets routed to the human gate (live loop, multi-tab refresh, visual fps/flash) — these were always planned as manual/Phase-10 verifications per `07-VALIDATION.md`.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `frontend/src/auth/oidc.ts` | Single oidc-spa instance + enforceLogin | ✓ VERIFIED | `createUtils()` once; exports `enforceLogin`, `getOidc`, `OidcInitializationGate`; no hand-rolled refresh |
| `frontend/src/routes/index.tsx` | Game route w/ guard + D-01 assembly | ✓ VERIFIED | `beforeLoad: enforceLogin`, `ssr:false`, mounts curve/bet/cashout/countdown/feed/history/skeletons/juice |
| `frontend/src/routes/__root.tsx` | Mounts WS session + providers | ✓ VERIFIED | `GameSession` calls `useGameSocket()`; OidcProvider + QueryClientProvider + Toaster |
| `frontend/src/features/curve/local-multiplier.ts` | Shared formula + EWMA | ✓ VERIFIED | `multiplierAt` from contracts + `reconcileOffset` EWMA |
| `frontend/src/features/curve/use-raf-curve.ts` | rAF loop + freeze | ✓ VERIFIED | rAF, CRASHED freeze, leak-free cancel, writes isolated store only |
| `frontend/src/features/curve/draw-curve.ts` | dPR + clearRect draw | ✓ VERIFIED | `setTransform(dpr)`, `clearRect`, gradient/glow/freeze |
| `frontend/src/features/bet/bet-amount.ts` | Money-VO validator | ✓ VERIFIED | `Money.of(BigInt)`, bounds, precision reject |
| `frontend/src/components/cashout-button.tsx` | Live payout, state-gated | ✓ VERIFIED | `multiplyRounded` payout, RUNNING+ACTIVE only |
| `frontend/src/stores/ws-dispatch.ts` | 11-event schema-validated dispatch | ✓ VERIFIED | zod safeParse per event → 6 stores; drops invalid payloads |
| `frontend/src/ws/socket.ts` | Auth-function socket singleton | ✓ VERIFIED | single `io()`, `getAccessToken()` in `auth` cb, path `/ws` |
| `frontend/src/lib/config.ts` | Env-parsed typed config | ✓ VERIFIED | zod schema, all business constants from `VITE_*`, frozen |
| `frontend/src/lib/toast.ts` | Deduped toasts | ✓ VERIFIED | keyed Map, cleared on dismiss/autoclose |
| `frontend/.env.example` | All FE env constants | ✓ VERIFIED | growth, EWMA, history thresholds, bet bounds, sizes |

No artifact is MISSING, STUB, or ORPHANED.

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| Socket.IO events | Zustand stores | `useGameSocket` → `dispatchWsEvent` → store setters | ✓ WIRED | All 11 events subscribed in `__root` session; each handler writes a real store |
| `multiplier.store` | `CrashCurve` | isolated store subscription + rAF | ✓ WIRED | rendered multiplier flows to draw + cashout payout |
| `BetPanel` | `POST /games/bet` | `usePlaceBet` mutation, Money snapshot body | ✓ WIRED | 202/402/409 handled with deduped toasts |
| `CashoutButton` | `POST /games/bet/cashout` | `useCashout` mutation | ✓ WIRED | 200/409 handled |
| `useWallet` | `GET /wallets/me` | TanStack Query → `wallet.store` | ✓ WIRED | balance hydrated, drives BalancePill counter-up |
| `useHistory` | `GET /games/rounds/history` | TanStack Query → `history.store` (+ `round:crashed` prepend) | ✓ WIRED | last-N seed, color-banded strip |
| `index.tsx` route | `enforceLogin` | `beforeLoad` guard | ✓ WIRED | unauth → Keycloak (oidc-spa) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `CrashCurve` | `frame.multiplier` | rAF loop ← `localMultiplier(roundStartedAt, serverOffsetMs)` ← `round.store` + `multiplier.store` (seeded by WS `round:snapshot`/`round:running`/`round:tick`) | Yes — server-anchored, EWMA reconciled | ✓ FLOWING |
| `LiveFeed` | `feed.store.entries` | WS `bet:placed`/`bet:cashed_out` → `feed.store.push` (capped at env `feedBufferSize`) | Yes | ✓ FLOWING |
| `HistoryStrip` | `history.store.entries` | `GET /games/rounds/history` seed + WS `round:crashed` prepend | Yes | ✓ FLOWING |
| `BalancePill` | `wallet.store.balance` | `GET /wallets/me` + WS `bet:my_cashed_out` credit | Yes | ✓ FLOWING |
| `CashoutButton` | `renderedMultiplier`, `myBet` | isolated multiplier store + bet store (WS `bet:my_active`) | Yes | ✓ FLOWING |
| `Countdown` | `round.bettingEndsAt` | WS snapshot/`round:started` | Yes | ✓ FLOWING |

No HOLLOW or DISCONNECTED artifacts. Money always crosses the wire as a `MoneySnapshot { amount: string, currency, scale }` (bigint-cents string), never a raw `number`.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full FE test suite | `cd frontend && bun run test` | 65/65 pass, 12 files, 2.3s | ✓ PASS |
| Type safety | `cd frontend && bun run typecheck` | exit 0, no errors | ✓ PASS |
| Lint (incl. `.tsx` money guard) | `cd frontend && bun run lint` | 0 errors, 1 benign warning | ✓ PASS |
| Money guard covers `.tsx` | `grep eslint.config.js` | `files: ["**/*.ts","**/*.tsx"]` + rule `error` (off only in tests) | ✓ PASS |
| Shared multiplier formula | read `packages/contracts/src/provably-fair/multiplier.ts` | `Math.exp((growthRate*elapsedMs)/1000)` | ✓ PASS |
| Contracts subpaths exported | `grep packages/contracts/package.json` | `./ws`, `./multiplier` present | ✓ PASS |
| Live player loop (login→bet→cashout/crash) | docker:up + browser | NOT RUN — requires live stack | ? SKIP → human gate |

---

### Probe Execution

No `scripts/*/tests/probe-*.sh` are declared for Phase 7 (frontend is a Vitest workspace, not a probe-driven migration phase). Probe execution N/A. Backend smoke probes (1-44) belong to Phases 1-6 and are out of scope for this FE verification.

---

### Requirements Coverage

All 15 Phase 7 REQ-IDs declared across the plans, cross-referenced to code:

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| REQ-FE-01 | TanStack Start + Vite + Tailwind v4 + shadcn + Zustand + Query + oidc-spa | ✓ SATISFIED | `package.json` deps + scaffold; 65 tests run on the stack |
| REQ-FE-02 | Canvas 2D 60fps rAF + dPR + clearRect | ✓ SATISFIED (code) / ? fps human | `crash-curve.tsx` + `draw-curve.ts` |
| REQ-FE-03 | Local formula + EWMA reconcile (never snap) | ✓ SATISFIED | `local-multiplier.ts` + `multiplier.store.reconcile` |
| REQ-FE-04 | Money-VO bet input + state-aware enable | ✓ SATISFIED | `bet-amount.ts` + `bet-panel.tsx` |
| REQ-FE-05 | Cashout live payout, ACTIVE+RUNNING only | ✓ SATISFIED | `cashout-button.tsx` |
| REQ-FE-06 | BETTING countdown | ✓ SATISFIED | `countdown.tsx` |
| REQ-FE-07 | Live feed, own-action highlight | ✓ SATISFIED | `live-feed.tsx`+`feed-row.tsx`+`feed.store` |
| REQ-FE-08 | History strip last-20 color-coded (env thresholds) | ✓ SATISFIED | `history-strip.tsx`+`history-band.ts` |
| REQ-FE-11 | Dark casino aesthetic | ✓ SATISFIED (code) / ? visual human | `__root` dark, UI-SPEC hexes |
| REQ-FE-12 | Responsive desktop+mobile+touch | ✓ SATISFIED (code) / ? touch human | `index.tsx` D-01 grid + sticky controls + `min-h-11` |
| REQ-FE-13 | Skeletons + deduped toasts | ✓ SATISFIED | `game-skeletons.tsx` + `lib/toast.ts` |
| REQ-FE-14 | Counter-up + celebration + crash flash/freeze | ✓ SATISFIED (code) / ? visual human | `use-count-up`, `celebrate`, `crash-flash` |
| REQ-AUTH-01 | OIDC Auth Code + PKCE S256 via oidc-spa | ✓ SATISFIED | `auth/oidc.ts` + `enforceLogin` guard |
| REQ-AUTH-02 | Token persist + silent renew | ✓ SATISFIED (lib-internal) / ? live | oidc-spa internal; no hand-rolled timer (grep clean) |
| REQ-AUTH-03 | BroadcastChannel multi-tab refresh | ✓ SATISFIED (lib-internal) / ? 3-tab human | oidc-spa internal; no hand-rolled BroadcastChannel (grep clean) |

No ORPHANED requirements. REQ-FE-09/10 + REQ-REPLAY-* correctly untouched (Phase 8). Note: `__root.tsx:59` has an empty `data-slot="fairness-badge"` `aria-hidden` placeholder div — this is a Phase-8 (REQ-FE-09) seam, not a Phase-7 stub, and renders nothing.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/routeTree.gen.ts` | 1 | Unused eslint-disable directive | ℹ️ Info | Generated artifact; documented in deferred-items.md; lint exit 0 |
| `src/lib/config.ts` | 30 | `eslint-disable @crash/no-number-for-money` | ℹ️ Info | Narrowly scoped to env-parsed integer cents bounds that are immediately wrapped in `Money.of(BigInt(...))` at the sole consumer; rule NOT weakened globally; intentional, justified inline. Resolved in 07-09 per ROADMAP. |

- **Debt markers (TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER):** NONE in `src` (grep clean). No blocker.
- **Empty handlers / `return null` stubs:** NONE (`return null` instances are legitimate conditional renders — CrashFlash idle, CashoutButton when not cashable, OidcProvider pre-bootstrap, GameSession effect-only). No blocker.

No 🛑 blocker anti-patterns.

---

### Human Verification Required

#### 1. Live player loop smoke (REQUIRED gate)

**Test:** `bun run docker:up`, open the app, get redirected to Keycloak, log in as `player / player123`, return to the game. Wait for a BETTING window, enter a valid bet (e.g. `5.00`), click Place Bet. Wait for RUNNING, watch the curve climb, click Cash Out before the crash. In a later round, let it ride past the crash.
**Expected:** Unauth redirect works; bet places (202) and flips to "Bet Active" via `bet:my_active`; Cash Out returns 200 with a payout and fires confetti; BalancePill counts up; on a crash the curve freezes at the server crash value with a red flash and the bet is marked lost.
**Why human:** Requires a live Keycloak realm, WS gateway, and autonomous round loop. The bet→saga→wallet→WS round-trip and real-time rendering cannot be exercised by jsdom unit tests.

#### 2. Multi-tab coordinated refresh

**Test:** Open three tabs, wait for an access-token rotation, watch the network panel.
**Expected:** One coordinated refresh across all tabs per rotation (oidc-spa BroadcastChannel), no per-tab refresh storm.
**Why human:** Needs three real tabs + token-rotation timing; coordination is library-internal.

#### 3. Canvas fps + crash flash/freeze visual

**Test:** Watch a RUNNING→CRASHED transition.
**Expected:** Smooth 60fps climb, no jank; red flash then brief freeze at the server crash value (reduced-motion → freeze only).
**Why human:** Perceptual fps and visual timing are not measurable in jsdom.

> **Phase 10 note:** Full Playwright E2E of the player flow (login → bet → cashout, and login → bet → crash) is **deferred to Phase 10 (REQ-TEST-05)** by design per `07-VALIDATION.md`. The above manual smoke is the interim gate, not a substitute for that automated coverage.

---

### Gaps Summary

No code gaps. All 5 success criteria, all 15 REQ-IDs, all key links, and the full data-flow trace are satisfied by substantive, wired code that flows live REST + WebSocket data into the UI. Static gates (tests 65/65, typecheck clean, lint clean) all pass. Money-VO discipline is upheld end to end — every amount crosses the wire as a bigint-cents `MoneySnapshot` string, never a raw `number`; the one `no-number-for-money` exception is a narrowly-justified env-cents bounds shape, not a wire/Money value. No business constant is hardcoded — growth rate, EWMA alpha, history color thresholds, bet bounds, buffer/history sizes all come from `VITE_*` env via the typed `config.ts`.

The phase is **PASS on code+static evidence**. Status is `human_needed` solely because three behaviors (the live end-to-end loop, multi-tab refresh, and visual fps/flash) are inherently un-automatable in this harness and must be confirmed by a human against the live stack before the phase is signed off — exactly as the phase's own validation strategy anticipated.

---

_Verified: 2026-05-29T18:32:12Z_
_Verifier: Claude (gsd-verifier)_
