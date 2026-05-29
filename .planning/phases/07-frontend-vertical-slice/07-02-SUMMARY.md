---
phase: 07-frontend-vertical-slice
plan: 02
subsystem: infra
tags: [tanstack-start, vite, bun, oidc-spa, keycloak, kong, cors, workspace-ts, dinero, spike]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-01 scoped Kong cors plugin + @crash/contracts/ws shared WS schemas"
provides:
  - "Boot-mode evidence: both SPA mode and default-SSR boot on Bun 1.3.11 + Vite 8; TanStack#5171 hang did NOT reproduce"
  - "Workspace-TS transpile verdict: zero Vite config additions needed, BUT @crash/contracts root barrel leaks node:crypto into the browser — needs a browser-safe subpath"
  - "oidc-spa@10.2.3 instance strategy: single react-spa instance exposes both useOidc and getOidc; no dual-instance parity concern; API drift from RESEARCH-assumed createReactOidc"
  - "Kong CORS reachability: simple/authed GET return scoped ACAO, but OPTIONS preflight 404s on every route (methods filter omits OPTIONS) — must fix in 07-03"
affects: [07-03, 07-04, frontend, websocket-client, kong]

# Tech tracking
tech-stack:
  added:
    - "Pinned FE scaffold deps installed into frontend/ (TanStack Start 1.168.14, React 19.2.6, Vite 8.0.14, oidc-spa 10.2.3, socket.io-client 4.8.3, zustand 5, Tailwind 4) — for the throwaway spike; reused by 07-03"
  patterns:
    - "Wave-0 de-risking spike: stand up throwaway boot configs + live probes to resolve the four highest-uncertainty integration points before scaffold shape is committed"

key-files:
  created:
    - frontend/spike/vite.config.spa.ts
    - frontend/spike/vite.config.ssr.ts
    - frontend/spike/workspace-import-spike.ts
    - frontend/spike/oidc-spike.ts
    - frontend/spike/SPIKE-NOTES.md
    - frontend/spike/src/router.tsx
    - frontend/spike/src/routes/__root.tsx
    - frontend/spike/src/routes/index.tsx
  modified:
    - frontend/package.json
    - bun.lock

key-decisions:
  - "boot mode: RATIFIED selective-ssr (default SSR + ssr:false on the game route); #5171 hang disproven so spa-mode was a valid alternative, but selective-ssr survives any future SPA-mode regression"
  - "workspace-TS: transpiles with zero config; add a browser-safe @crash/contracts/multiplier subpath in 07-03 (root barrel pulls node:crypto)"
  - "oidc: RATIFIED single-getOidc from the one oidc-spa@10.2.3 createUtils instance; no second createOidc(core); socket consumes the built-in getOidc()"
  - "CORS: 07-03 must add OPTIONS to every Kong route methods: list so preflights stop 404ing"

patterns-established:
  - "Spike-then-ratify: throwaway frontend/spike/ produces SPIKE-NOTES.md DECISIONs that gate the scaffold; deleted by 07-03"

requirements-completed: []  # REQ-FE-01/REQ-AUTH-01/02/03 are DE-RISKED here but COMPLETED by 07-03/07-04, not this spike

# Metrics
duration: ~50min
completed: 2026-05-28
---

# Phase 7 Plan 02: Wave-0 De-Risking Spike Summary

**Stood up a throwaway TanStack Start spike on the live Bun 1.3.11 + Vite 8 stack to resolve the four highest-risk integration unknowns: SPA mode does NOT hang (#5171 disproven), workspace TS transpiles with zero config but the contracts root barrel leaks `node:crypto` to the browser, oidc-spa v10.2.3 is single-instance (one `getOidc` for the socket), and Kong CORS preflights 404 on every route until `OPTIONS` is allowed.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-28
- **Completed:** 2026-05-28 (all three tasks done; checkpoint:decision ratified by the user)
- **Tasks:** 3 of 3 complete — two auto-tasks + the checkpoint:decision (boot mode + oidc strategy ratified)
- **Files modified:** 11 (9 created, 2 modified)

## Accomplishments
- **Spike A (boot mode, HIGHEST RISK):** Booted both `tanstackStart({ spa:{ enabled:true } })` and default `tanstackStart()` on Bun 1.3.11 + Vite 8. SSR served 200 with full server-rendered content; SPA mode hydrated (client JS executed — verified by headless Chrome `--dump-dom`). **The TanStack#5171 SPA-mode hang did NOT reproduce on the pinned versions.**
- **Spike C (workspace-TS import):** `@crash/shared-kernel` Money (via `dinero.js/bigint` + bigint literals) and `@crash/contracts` `multiplierAt` both transpiled through Vite with **zero `optimizeDeps`/`ssr.noExternal` additions** (`1000.00 CRD` and `1.0618` rendered). **Critical browser-only break surfaced:** the `@crash/contracts` root barrel re-exports the provably-fair seed-chain/derive code which imports `node:crypto` → externalized in the browser → client error. Fix recorded for 07-03 (add `@crash/contracts/multiplier` browser-safe subpath).
- **Spike B (oidc parity):** Resolved from the installed `oidc-spa@10.2.3` type surface — `oidc-spa/react-spa`'s `createUtils` returns `useOidc` AND a non-React `getOidc()` from a single underlying instance, so **there is no dual-instance parity concern** (Open Q1 / A1 moot). Multi-tab single-refresh is library-built-in via core `BroadcastChannel` (Pitfall 5). Flagged API drift: the real API is `oidcSpa.createUtils`, not the RESEARCH-assumed `createReactOidc`/`beforeLoadFn`.
- **Spike D (CORS reachability):** Live curl from `Origin: http://localhost:3000` — public `GET /games/rounds/current` and authed `GET /wallets/me` (Bearer, real `player/player123` token) return **scoped** `Access-Control-Allow-Origin: http://localhost:3000` + credentials (body `balance.amount=60000 CRD`). **But every `OPTIONS` preflight 404s** because each Kong route's `methods:` filter omits `OPTIONS` — a real browser will block all credentialed/authorized calls until 07-03 adds `OPTIONS` to the route method lists.

## Task Commits

1. **Task 1: SPA-vs-SSR boot + workspace-TS import spike** - `2bd7283` (chore)
2. **Task 2: oidc instance parity + Kong CORS reachability spike** - `15bf124` (chore)
3. **Task 3: checkpoint:decision ratification** - recorded in the closeout `docs(07-02)` commit (no code; ratified DECISION lines appended to `SPIKE-NOTES.md`)

_Task 3 (the `checkpoint:decision` gate) is RESOLVED — the user ratified `selective-ssr` (boot mode) and `single-getOidc` (oidc strategy). Both are written as final `DECISION RATIFIED` lines in `SPIKE-NOTES.md`._

## Files Created/Modified
- `frontend/spike/vite.config.spa.ts` - SPA-mode (`spa:{enabled:true}`) boot config
- `frontend/spike/vite.config.ssr.ts` - default-SSR boot config (fallback path)
- `frontend/spike/src/{router.tsx,routes/__root.tsx,routes/index.tsx}` - minimal Start app; index imports the workspace packages to force Vite transpile
- `frontend/spike/workspace-import-spike.ts` - standalone Money + multiplierAt import assertion
- `frontend/spike/oidc-spike.ts` - records oidc-spa v10.2.3 single-instance finding + CORS evidence
- `frontend/spike/SPIKE-NOTES.md` - the four DECISIONs (boot mode, workspace-TS, oidc instance, CORS)
- `frontend/package.json` + `bun.lock` - pinned FE scaffold deps installed for the spike (reused by 07-03)

## Decisions Made
- **boot mode (RATIFIED):** `selective-ssr` — default SSR (`tanstackStart()`, no `spa` block) + `ssr: false` on the game route. Both modes boot and #5171 was disproven, but selective-ssr survives any future SPA-mode regression and matches CLAUDE.md §Frontend (game page needs `window` + WS + Canvas + OIDC, must be client-only). `spa-mode` was the documented alternative; not chosen.
- **oidc (RATIFIED):** `single-getOidc` — ONE `oidc-spa@10.2.3` `createUtils` instance; components use `useOidc`, the socket consumes the same instance's built-in `getOidc()`. No second `createOidc(core)`, no second refresh mechanism (core `BroadcastChannel` handles multi-tab).
- **workspace-TS:** zero Vite config needed; 07-03 must add a browser-safe `@crash/contracts/multiplier` subpath (root barrel pulls `node:crypto`).
- **CORS:** 07-03 must add `OPTIONS` to every Kong route's `methods:` list.

## Mandatory 07-03 Carry-Forwards

1. **Browser-safe `@crash/contracts/multiplier` subpath** — the `@crash/contracts` root barrel re-exports the provably-fair seed-chain/derive code which imports `node:crypto`, breaking the browser bundle. Add a granular `./multiplier` export (and `./formula` for the constants) to `packages/contracts/package.json` so the FE imports `multiplierAt` from `@crash/contracts/multiplier`, NOT the root barrel. `multiplier.ts` is pure (`Math.exp` only) — granular export, not a code change.
2. **`OPTIONS` on every Kong route's `methods:` list** — every browser-reachable route (`games-current`, `games-history`, `games-verify`, `games-bets-me`, `games-bet-place`, `games-bet-cashout`, `wallets-provision`, `wallets-me`) currently 404s on the CORS preflight because the `methods:` filter omits `OPTIONS`. Add `OPTIONS` to each; keep origins scoped to `http://localhost:3000` with `credentials: true` (never `*`). Re-probe each `OPTIONS` expecting `204`/`200` with scoped ACAO.

Plus the two Rule-3 scaffold facts (see Deviations): export `getRouter` (not `createRouter`) from `src/router.tsx`; `frontend/package.json` must declare `"type": "module"`.

## oidc-spa v10.2.3 API Note (for 07-04)
RESEARCH Pattern 7 assumed `createReactOidc` / `beforeLoadFn` named exports. The installed v10.2.3 real API is `oidcSpa` builder from `oidc-spa/react-spa` → `.createUtils({...})` → `{ useOidc, getOidc, enforceLogin, bootstrapOidc, OidcInitializationGate }`, plus a dedicated `oidc-spa/react-tanstack-start` entry point. 07-04 must wire against `oidcSpa.createUtils`, NOT `createReactOidc`/`beforeLoadFn`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TanStack Start v1 router export must be `getRouter`**
- **Found during:** Task 1 (SSR boot)
- **Issue:** Minimal app exported `createRouter`; the v1.168 server handler threw `entries.routerEntry.getRouter is not a function` (500).
- **Fix:** Renamed the export to `getRouter` in `frontend/spike/src/router.tsx`.
- **Verification:** SSR `/` returned 200 with full content. Recorded as a 07-03 scaffold requirement.
- **Committed in:** `2bd7283`

**2. [Rule 3 - Blocking] ESM config load needs `"type": "module"`**
- **Found during:** Task 1 (SSR boot)
- **Issue:** A non-default-named config (`vite.config.ssr.ts`) is bundled via `require`; the ESM-only `@tanstack/react-start/plugin/vite` failed with "This package is ESM only" until the nearest package.json declared `"type": "module"`.
- **Fix:** Added `frontend/spike/package.json` with `"type": "module"`.
- **Verification:** Both vite configs loaded and the dev servers booted.
- **Committed in:** `2bd7283`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, in throwaway spike code).
**Impact on plan:** Both are TanStack Start v1 setup facts now captured as 07-03 scaffold requirements. No scope creep.

## Issues Encountered
- **`node:crypto` leak (now a tracked 07-03 action):** importing `multiplierAt` from the `@crash/contracts` root barrel pulls the provably-fair crypto chain into the browser bundle. Documented in SPIKE-NOTES with the exact subpath fix.
- **CORS preflight 404 (now a tracked 07-03 action):** every Kong route 404s on `OPTIONS`; the 07-01 cors plugin is correct but unreachable for preflights. Documented with the exact `methods:` fix.
- **oidc-spa API drift:** the installed v10.2.3 surface differs from RESEARCH Pattern 7; the real `oidcSpa.createUtils` API is recorded for 07-04.

## User Setup Required
None - no external service configuration required for the spike.

## Next Phase Readiness
- The 07-03 scaffold has unambiguous inputs: boot mode RATIFIED `selective-ssr` (default SSR + game route `ssr:false`), the two mandatory carry-forwards above (`@crash/contracts/multiplier` subpath + Kong `OPTIONS`), the real oidc-spa v10.2.3 API + single-instance wiring (RATIFIED `single-getOidc`, consumed in 07-04), and the two Rule-3 scaffold facts (`getRouter` export + `"type":"module"`).
- The throwaway `frontend/spike/` directory is to be deleted by 07-03.
- **CHECKPOINT RESOLVED:** the user ratified (a) boot mode = `selective-ssr` and (b) oidc strategy = `single-getOidc`. Plan complete; 07-03 may proceed.

## Self-Check: PASSED

- Created files verified present: `frontend/spike/SPIKE-NOTES.md` (4 DECISION headers + 2 `DECISION RATIFIED` lines — `grep -c DECISION` = 8), `vite.config.spa.ts`, `vite.config.ssr.ts`, `oidc-spike.ts`, `workspace-import-spike.ts`, `07-02-SUMMARY.md`
- `DECISION RATIFIED` lines present in SPIKE-NOTES.md at boot-mode (`selective-ssr`) and oidc (`single-getOidc`) sections
- Commits verified in git history: `2bd7283`, `15bf124` (closeout `docs(07-02)` commit added by this finalization)

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-28*
