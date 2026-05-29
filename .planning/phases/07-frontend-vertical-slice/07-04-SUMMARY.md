---
phase: 07-frontend-vertical-slice
plan: 04
subsystem: frontend
tags: [oidc-spa, keycloak, pkce, socket-io, zustand, tanstack-query, ws-dispatch, ewma, money-vo, vitest]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-03 booting TanStack Start scaffold (getConfig, @/* alias, Vitest harness, themed shell with reserved slots); 07-02 ratified single-getOidc + real oidc-spa v10.2.3 API; 07-01 @crash/contracts/ws schemas + Kong CORS"
provides:
  - "OIDC auth wiring: single oidcSpa.createUtils() instance exporting useOidc/getOidc/enforceLogin/OidcInitializationGate/bootstrapAuth (single-getOidc strategy)"
  - "Game route guarded by enforceLogin (Authorization Code + PKCE S256 via library; silent renew + multi-tab BroadcastChannel are library-internal, zero hand-rolled code)"
  - "socket.io singleton with an auth FUNCTION reading getAccessToken() per (re)connect — fresh token every reconnect"
  - "Bearer protectedFetch + public apiFetch REST wrappers (never logs the token)"
  - "Five slice-per-concern Zustand stores + isolated multiplier store (D-06) + history store"
  - "ws-dispatch: single validated mapping from the full WS event catalog to slices; round:tick → multiplier store only"
  - "use-wallet / use-history TanStack Query hydration; connection-badge status store; useGameSocket mounted once in __root"
affects: [07-05, 07-06, frontend]

# Tech tracking
tech-stack:
  added:
    - "First runtime use of oidc-spa@10.2.3 (oidcSpa.createUtils), socket.io-client@4.8.3, zustand@5 stores, and @tanstack/react-query@5 hydration in the app"
  patterns:
    - "single-getOidc: one react-spa createUtils instance feeds both useOidc (components) and getOidc (socket/api); no second core instance"
    - "WS dispatch gate: dispatchWsEvent safeParses against @crash/contracts/ws once at the entry, drops+warns on failure, then routes to exactly one slice"
    - "D-06 tick isolation: round:tick mutates only the multiplier store via EWMA clock-offset reconcile (never snaps)"

key-files:
  created:
    - frontend/src/auth/oidc.ts
    - frontend/src/auth/oidc-provider.tsx
    - frontend/src/auth/oidc-guard.test.tsx
    - frontend/src/ws/socket.ts
    - frontend/src/ws/use-game-socket.ts
    - frontend/src/lib/api.ts
    - frontend/src/lib/ws-payloads.ts
    - frontend/src/stores/round.store.ts
    - frontend/src/stores/multiplier.store.ts
    - frontend/src/stores/wallet.store.ts
    - frontend/src/stores/feed.store.ts
    - frontend/src/stores/bet.store.ts
    - frontend/src/stores/history.store.ts
    - frontend/src/stores/ws-dispatch.ts
    - frontend/src/stores/ws-dispatch.test.ts
    - frontend/src/features/wallet/use-wallet.ts
    - frontend/src/features/history/use-history.ts
  modified:
    - frontend/src/routes/index.tsx
    - frontend/src/routes/__root.tsx
    - frontend/src/lib/config.ts
    - frontend/src/lib/config.test.ts
    - frontend/.env.example

key-decisions:
  - "Used the real oidc-spa v10.2.3 API (oidcSpa.createUtils → enforceLogin guard + getOidc with getAccessToken), NOT the RESEARCH-assumed createReactOidc/beforeLoadFn/getTokens — drift was flagged in 07-02"
  - "bet:my_cashed_out CREDITS the wallet by the payout (Money.add) instead of overwriting balance with the payout amount — overwriting would be a balance-corruption bug; authoritative balance still comes from GET /wallets/me"
  - "Added VITE_FEED_BUFFER_SIZE + VITE_HISTORY_SIZE to the typed config (no hardcoded buffer/history caps, per CLAUDE.md §Configuration)"
  - "History kept in a small zustand history.store seeded by the Query hook and prepended by round:crashed, decoupling the dispatch from React Query"

requirements-completed: [REQ-AUTH-01, REQ-AUTH-02, REQ-AUTH-03, REQ-FE-07, REQ-FE-08]

# Metrics
duration: ~6min
completed: 2026-05-29
---

# Phase 7 Plan 04: Auth, Socket & State Plumbing Summary

**Wired the data plumbing the game UI consumes: a single oidc-spa v10.2.3 `createUtils` instance (PKCE S256 login + library-internal silent renew + multi-tab BroadcastChannel, zero hand-rolled token code), the game route guarded by `enforceLogin`, a socket.io singleton whose auth FUNCTION reads `getAccessToken()` fresh on every reconnect, five slice-per-concern Zustand stores plus the isolated multiplier store (D-06), a single schema-validated WS-event dispatch (round:tick touches only the multiplier store), and TanStack Query hydration for balance + history.**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-05-29
- **Tasks:** 2 of 2 complete (both `type=auto`, `tdd=true`)
- **Files:** 22 (17 created, 5 modified)

## Accomplishments

- **Task 1 — auth + guard + socket + Bearer api (`2d2611e`):** `auth/oidc.ts` exports one `oidcSpa.createUtils()` instance's `useOidc`/`getOidc`/`enforceLogin`/`OidcInitializationGate` plus a `bootstrapAuth()` that lazily calls `bootstrapOidc({ implementation:"real", issuerUri, clientId, scopes:["profile","email"] })` from `getConfig().keycloak`. The game route (`routes/index.tsx`) gets `beforeLoad: enforceLogin` while keeping the 07-03 `ssr:false`. `ws/socket.ts` is a lazy `getSocket()` singleton: `io(ws.url, { path:"/ws", transports:["websocket"], auth:(cb)=>resolveAuthToken().then(cb) })` where `resolveAuthToken` awaits `getOidc()` and reads `getAccessToken()` (auto-refreshing) per call — fresh token every reconnect, never cached. `lib/api.ts` provides `apiFetch` (public) + `protectedFetch` (Authorization Bearer from `getAccessToken`, never logged). `auth/oidc-provider.tsx` bootstraps then renders the `OidcInitializationGate`.
- **Task 2 — stores + dispatch + Query (`9f265c3`):** `lib/ws-payloads.ts` re-exports the eleven `@crash/contracts/ws` schemas/types as the FE's single import surface. Five stores (`round`, `multiplier` [isolated, D-06], `wallet`, `feed` [circular buffer], `bet`) plus a small `history` store. `stores/ws-dispatch.ts` is the single mapper: `dispatchWsEvent` `safeParse`s the matching schema once at the gate (drop + `console.warn` on failure), then routes to exactly one slice. `round:tick` runs the EWMA clock-offset reducer (`VITE_EWMA_ALPHA`) updating ONLY the multiplier store. `bet:my_cashed_out` flags a celebration on the bet store and credits the wallet from the `payout` `MoneySnapshot` via `Money.fromSnapshot(...).add(...)`. `ws/use-game-socket.ts` (mounted once in `__root.tsx` inside the authed `OidcProvider` tree) registers the full event catalog, wires the connection-badge status store from socket lifecycle events, and tears down on unmount. `features/wallet/use-wallet.ts` and `features/history/use-history.ts` are TanStack Query hooks hydrating balance (cents-string → Money snapshot) and the last-N history (filtering null crash points), the latter exposing `prependCrash`.

## Task Commits

1. **Task 1 — oidc-spa auth, route guard, socket.io singleton, Bearer api:** `2d2611e` (feat)
2. **Task 2 — zustand slices, WS-event dispatch, TanStack Query hydration:** `9f265c3` (feat)

## Verification Evidence

- `cd frontend && bunx tsc --noEmit` → exit 0 (clean)
- `cd frontend && bun run test` → 17 passed (3 files: `config.test.ts` 7, `ws-dispatch.test.ts` 6, `oidc-guard.test.tsx` 4)
- `grep -E "setInterval|setTimeout|BroadcastChannel" src/auth/oidc.ts` → NONE (REQ-AUTH-02/03 are library-internal, no hand-rolled refresh/broadcast)
- `socket.ts` line 22 `auth: (cb) => ...` is the FUNCTION form reading `getAccessToken()` (proven re-invocable in the guard test: token-1 then token-2 across two `auth()` calls)
- `ws-dispatch.ts` `round:tick` branch references `useMultiplierStore` only; the tick test asserts round/feed/bet/wallet stores are referentially untouched (D-06)
- dispatch test: two ticks converge (offset 0 → ~100 toward a 1000ms instantaneous offset at alpha 0.1, never snaps); `round:crashed` freezes `crashValue = payload.crashPoint` + history prepend; feed caps at 3 (configured) marking own; invalid payload (`crashPoint:-5`) dropped + warned, stores untouched; `bet:my_cashed_out` credits 60000 → 60250
- `useGameSocket` referenced once (functionally) in `__root.tsx`
- `git diff --diff-filter=D HEAD~2 HEAD` → no deletions

## Decisions Made

- **Real oidc-spa v10.2.3 API over RESEARCH assumptions** — the installed surface is `oidcSpa.createUtils()` → `{ bootstrapOidc, useOidc, getOidc, OidcInitializationGate, enforceLogin }`; the logged-in `getOidc()` exposes `getAccessToken(): Promise<string>` (auto-refreshing), NOT `getTokens()`; the guard is `enforceLogin` used directly as `beforeLoad`, NOT a `beforeLoadFn({...})` factory. This matches the 07-02 single-getOidc ratification and the API-drift note.
- **Credit, not overwrite, on cashout** — the plan text said "update wallet from the payout snapshot". Overwriting the balance with the payout (winnings only) would corrupt the displayed balance; instead `credit()` adds the payout to the current mirror and the authoritative value still comes from `GET /wallets/me` (server-authoritative, T-07-11).
- **Two new typed config keys** — `VITE_FEED_BUFFER_SIZE` (50) and `VITE_HISTORY_SIZE` (20) were added to `config.ts` + `.env.example` rather than hardcoding the buffer caps, honoring CLAUDE.md §Configuration. The 07-03 `config.test.ts` fixture was updated for the new required keys.
- **history.store decouples dispatch from Query** — `round:crashed` prepends to a small zustand history store that the `use-history` Query hook seeds, so the dispatch never imports React Query.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical correctness] bet:my_cashed_out credits rather than overwrites the wallet balance**
- **Found during:** Task 2
- **Issue:** Literally "update balance from the payout snapshot" would set the balance to just the winnings, corrupting the mirror.
- **Fix:** Added `useWalletStore.credit()` (`Money.add`) and called it with the payout; balance now increments. Authoritative balance still re-hydrates via `GET /wallets/me`.
- **Files modified:** `frontend/src/stores/wallet.store.ts`, `frontend/src/stores/ws-dispatch.ts`
- **Commit:** `9f265c3`

**2. [Rule 3 - Blocking] New required config keys broke the 07-03 config test fixture**
- **Found during:** Task 2 (adding `VITE_FEED_BUFFER_SIZE`/`VITE_HISTORY_SIZE` to avoid hardcoded caps)
- **Issue:** `config.test.ts`'s `validEnv` omitted the two new required keys, so `configSchema.parse(validEnv)` would throw.
- **Fix:** Added both keys to the test fixture.
- **Files modified:** `frontend/src/lib/config.test.ts`
- **Commit:** `9f265c3`

**Total deviations:** 2 auto-fixed (one Rule 2 correctness, one Rule 3 blocking). No architectural changes; no scope creep; no new package installs (threat T-07-SC honored).

## Known Stubs

None that block this plan's goal. The stores and hooks are fully wired and unit-tested; what remains is purely the *visual* consumption of these stores by 07-05 (curve, reading the multiplier store + roundStartedAt) and 07-06 (bet/cashout/balance/feed/history rails, reading bet/wallet/feed/history stores and calling the REST hooks). The connection-badge status store exists but its visual badge is rendered in a later plan; the `__root.tsx` `data-slot="connection-badge"` div remains an empty placeholder until then.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface beyond the plan's `<threat_model>`. All inbound WS payloads are schema-validated before mutating state (T-07-10); the token is never logged (T-07-08); silent renew/multi-tab are library-internal with no second refresh path (T-07-09); the crash freeze uses the server `crashPoint` and the cashout balance is server-authoritative (T-07-11).

## User Setup Required

- **`frontend/.env`:** copy `frontend/.env.example` → `frontend/.env` (now 13 `VITE_` vars incl. the two new caps) before `bun run dev` for real OIDC/REST/WS wiring.
- **Kong reload:** the 07-03 `OPTIONS` route additions still require a Kong reload (`docker compose restart kong`) before browser CORS preflights (and thus the `protectedFetch` balance/history calls) succeed at live-smoke.
- **Stack up:** Keycloak realm `crash-game`, client `crash-game-client`, user `player/player123` per the locked facts; live login + socket handshake is exercised at the phase live-smoke / Phase 10 Playwright.

## Next Phase Readiness

- 07-05 (curve) reads `multiplier.store` (`serverOffsetMs`/`reconcileTarget`/`renderedMultiplier`) + `round.store.roundStartedAt` and imports `multiplierAt` from `@crash/contracts/multiplier`; the rAF loop writes `renderedMultiplier` via `setRendered`.
- 07-06 (rails) reads `bet`/`wallet`/`feed`/`history` stores and calls `useWallet`/`useHistory`; the bet/cashout POST flow plugs into `protectedFetch`.
- All five WS-driven slices + Query hydration are live and unit-green; no further plumbing needed for the rendering plans.

## Self-Check: PASSED

- Created files verified present: `auth/oidc.ts`, `auth/oidc-provider.tsx`, `auth/oidc-guard.test.tsx`, `ws/socket.ts`, `ws/use-game-socket.ts`, `lib/api.ts`, `lib/ws-payloads.ts`, the five stores + `history.store.ts` + `ws-dispatch.ts` + `ws-dispatch.test.ts`, `features/wallet/use-wallet.ts`, `features/history/use-history.ts`
- Commits verified in `git log`: `2d2611e`, `9f265c3`
- tsc exit 0; 17/17 tests green

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-29*
