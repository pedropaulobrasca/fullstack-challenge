---
phase: 07-frontend-vertical-slice
plan: 03
subsystem: frontend
tags: [tanstack-start, vite-8, tailwind-v4, shadcn, oidc-config, zod-config, vitest, dark-casino, selective-ssr]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-01 scoped Kong CORS + @crash/contracts/ws schemas; 07-02 ratified boot mode (selective-ssr) + getRouter/type:module scaffold facts + carry-forwards"
provides:
  - "Booting selective-SSR TanStack Start app on :3000 with the dark-casino Tailwind v4 @theme (UI-SPEC hex tokens) live via CSS variables"
  - "Typed zod-parsed VITE_ config module (getConfig) — single source of truth for every FE business constant; green config.test.ts"
  - "shadcn initialized (components.json) with the UI-SPEC component set under src/components/ui"
  - "Vitest harness (jsdom + canvas stub + matchMedia mock) — first Vitest in the repo"
  - "Browser-safe @crash/contracts/multiplier + /formula subpaths; OPTIONS on every Kong route for CORS preflight"
affects: [07-04, 07-05, 07-06, frontend, kong, contracts]

# Tech tracking
tech-stack:
  added:
    - "Frontend scaffold realized: TanStack Start 1.168.14, React 19, Vite 8.0.14, Tailwind 4.3.0 (@theme), shadcn (new-york), Vitest 3.2.4 + jsdom 26 + Testing Library 16, @fontsource/fira-code + fira-sans, class-variance-authority/clsx/tailwind-merge, radix-ui (shadcn dep), tw-animate-css"
  patterns:
    - "Selective-SSR: default tanstackStart() with ssr:false on the game route — header/static SSR, game page client-only (window/WS/Canvas/OIDC)"
    - "All FE business constants flow through one zod-parsed VITE_ config module; lazy getConfig() so parsing never runs at import/SSR time"
    - "shadcn components added against a hand-authored Tailwind v4 @theme (manual components.json) so the UI-SPEC token contract is never clobbered by the CLI"

key-files:
  created:
    - frontend/vite.config.ts
    - frontend/vitest.config.ts
    - frontend/tsconfig.json
    - frontend/index.html
    - frontend/.env.example
    - frontend/components.json
    - frontend/src/router.tsx
    - frontend/src/routes/__root.tsx
    - frontend/src/routes/index.tsx
    - frontend/src/styles/globals.css
    - frontend/src/lib/config.ts
    - frontend/src/lib/config.test.ts
    - frontend/src/lib/utils.ts
    - frontend/src/test/setup.ts
    - frontend/src/components/ui/ (13 shadcn components + .gitkeep)
  modified:
    - packages/contracts/package.json
    - docker/kong/kong.yml
    - frontend/package.json

key-decisions:
  - "Surfaced VITE_REST_BASE as its own config key alongside VITE_WS_URL (11 vars, not 10) — REST hydration in 07-06 needs a base distinct from the WS url even though both point at Kong today"
  - "Made the typed config lazy via getConfig() instead of an eager module-level const — an eager parse threw at Vitest import time (import.meta.env lacks VITE_ vars) and would also break SSR; lazy parse fixes both"
  - "shadcn sonner wrapper de-coupled from next-themes (dropped the dep) since the app is dark-only — avoids needing a ThemeProvider/SSR theme handshake"
  - "vitest.config.ts uses vitest/config defineConfig with the react plugin array cast to ViteUserConfig['plugins'] to sidestep the Vite7(vitest-bundled)/Vite8 plugin-type clash"

requirements-completed: [REQ-FE-01, REQ-FE-11, REQ-FE-12]

# Metrics
duration: ~40min
completed: 2026-05-28
---

# Phase 7 Plan 03: TanStack Start Frontend Scaffold Summary

**Scaffolded the empty `frontend/` workspace slot into a booting selective-SSR TanStack Start app on :3000 with the dark-casino Tailwind v4 `@theme` (exact UI-SPEC hex), a zod-parsed `VITE_` config module as the single source of truth for every business constant, shadcn initialized with the UI-SPEC component set, and a green Vitest harness — plus the two 07-02 carry-forwards (browser-safe `@crash/contracts/multiplier` subpath + `OPTIONS` on every Kong route).**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-05-28
- **Tasks:** 2 of 2 complete (both `type=auto`)
- **Files:** 27 created in `frontend/` (incl. 13 shadcn components + generated `routeTree.gen.ts`), 3 modified (`packages/contracts/package.json`, `docker/kong/kong.yml`, plus iterative `frontend/package.json`)

## Accomplishments

- **Carry-forwards landed first (`f473417`):** Added `./multiplier` and `./formula` browser-safe subpath exports to `packages/contracts/package.json` so the FE imports the pure `Math.exp` curve math without dragging `node:crypto` (provably-fair seed chain) into the browser bundle. Added `OPTIONS` to all 8 browser-reachable Kong routes' `methods:` lists so CORS preflights stop 404ing (origins stay scoped to `http://localhost:3000`, `credentials: true`).
- **Task 1 — scaffold (`bd4038e`):** Expanded `frontend/package.json` (scripts, `type:module`, font + supporting deps). `vite.config.ts` is plain `tanstackStart()` + `viteReact()` + `tailwindcss()` with `server.port: 3000` and the `@/*` alias (selective-SSR per the 07-02 ratification; the game route carries `ssr: false`). Self-contained `tsconfig.json` (no root tsconfig exists). `globals.css` carries the full UI-SPEC `@theme` token table (background `#0A0F14`, card `#111827`, popover `#1F2937`, accent `#00FF85`→cyan `#22D3EE`, destructive `#EF4444`, border `#1E3A5F`, muted-fg `#94A3B8`, fg `#F8FAFC`) plus the shadcn semantic variable layer, self-hosted Fira Code + Fira Sans, dark-by-default. `lib/config.ts` zod-parses every `VITE_` var (growth rate `.positive()`, EWMA alpha `.min(0).max(1)`, history bands, bet bounds, issuer/client/urls) into a frozen typed object; `.env.example` documents each. Deleted the throwaway `frontend/spike/`.
- **Task 2 — harness + shadcn + shell (`b6ee856`):** `vitest.config.ts` (jsdom, globals, setup) + `src/test/setup.ts` (jest-dom, canvas `getContext` stub, `matchMedia` mock for reduced-motion). `components.json` written manually (so the CLI never rewrote the hand-authored theme) then `shadcn add` installed all 13 UI-SPEC components. `__root.tsx` renders the themed header shell (logo, reserved Fairness slot, balance-pill slot, connection-badge slot, sonner `Toaster`); `index.tsx` is the `ssr:false` D-01 responsive skeleton (history strip / curve stage / bet + feed rails) with UI-SPEC empty-state copy.

## Task Commits

1. **Carry-forwards (contracts subpath + Kong OPTIONS):** `f473417` (fix)
2. **Task 1 — scaffold + theme + typed config:** `bd4038e` (feat)
3. **Task 2 — vitest harness + shadcn + layout shell:** `b6ee856` (feat)

## Verification Evidence

- `cd frontend && bunx tsc --noEmit` → exit 0 (clean)
- `cd frontend && bun run test` → 7 passed (1 file, `config.test.ts`) under jsdom
- Dev server boots on :3000; `curl /` → **HTTP 200** with the server-rendered themed shell (`<html lang="en" class="dark">`, `<title>Crash</title>`, `globals.css` linked, `<body class="...bg-background text-foreground...">`, header with `bg-card`/`border-border` + the reserved slot divs). No hydration hang. Port torn down clean after each probe.
- `grep -c '@theme' src/styles/globals.css` = 1; contains `00FF85` (×2: accent + ring) and `EF4444` (×1)
- `.env.example` lists 11 `VITE_` vars (the 10 interface vars + `VITE_REST_BASE`)
- `components.json` present; `src/components/ui/*.tsx` = 13
- `grep -rEn '#[0-9A-Fa-f]{6}' src/routes src/components --include='*.tsx'` → none (no hardcoded hex outside `globals.css`)
- `grep -c OPTIONS docker/kong/kong.yml` = 10 (8 routes + 2 plugin lists); `packages/contracts` tsc exit 0 after the exports change

## Decisions Made

- **VITE_REST_BASE as a distinct key** — split from `VITE_WS_URL` (11 config vars). Both target Kong today, but 07-06 REST hydration deserves its own base so a future split needs no schema churn.
- **Lazy `getConfig()` over an eager `config` const** — the eager parse threw at Vitest collection time (`import.meta.env` has no `VITE_` vars there) and would equally break the SSR pass; `getConfig()` parses on first runtime access and caches.
- **shadcn sonner wrapper de-next-themes'd** — app is dark-only, so the wrapper hardcodes `theme="dark"` and the `next-themes` dep was removed rather than introduce a ThemeProvider/SSR theme handshake for no benefit.
- **Manual `components.json` + `shadcn add`** — the installed CLI is template-based (`--template start`) and would rewrite `globals.css`/`tsconfig`, clobbering the load-bearing UI-SPEC theme. Writing `components.json` by hand and only running `add` preserved the theme contract (the plan's sanctioned fallback).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Eager config parse crashed Vitest collection**
- **Found during:** Task 2 (first `bun run test`)
- **Issue:** `export const config = parseConfig(import.meta.env)` ran at module import; in the jsdom test env `import.meta.env` lacks the `VITE_` vars, so importing `config.test.ts` threw before any test ran (and the same eager parse would crash the SSR render pass).
- **Fix:** Replaced the eager const with a lazy, cached `getConfig()` accessor.
- **Verification:** `bun run test` → 7 passed; tsc clean.
- **Commit:** `b6ee856`

**2. [Rule 3 - Blocking] vitest/Vite dual-version plugin type clash**
- **Found during:** Task 2 (tsc on `vitest.config.ts`)
- **Issue:** `vitest/config` bundles Vite 7 types; the project resolves `@vitejs/plugin-react` against Vite 8 → `Plugin<any>` rolldown/rollup `this`-type incompatibility, tsc error TS2769.
- **Fix:** Kept `defineConfig` from `vitest/config` (needed for the `test` field) and cast the plugin array to `ViteUserConfig['plugins']`.
- **Verification:** tsc exit 0.
- **Commit:** `b6ee856`

**3. [Rule 3 - Blocking] shadcn CLI added next-themes the dark-only app cannot use**
- **Found during:** Task 2 (post `shadcn add`)
- **Issue:** Generated `sonner.tsx` imported `useTheme` from `next-themes`, which returns undefined without a ThemeProvider and adds an unused runtime dep.
- **Fix:** Simplified the wrapper to fixed `theme="dark"`, removed `next-themes` from `package.json`, reinstalled.
- **Verification:** tsc clean; dev boots; Toaster wired in `__root.tsx`.
- **Commit:** `b6ee856`

**Total deviations:** 3 auto-fixed (all Rule 3 - blocking scaffold-integration issues). No architectural changes; no scope creep. The `radix-ui` + `tw-animate-css` deps the shadcn CLI pulled in are legitimate official-registry transitive deps (UI-SPEC Registry Safety: official registry only) and were kept.

## Known Stubs

The `__root.tsx` header slots (`data-slot="balance-pill"`, `connection-badge`, `fairness-badge`) and the `index.tsx` regions (history strip, curve stage, bet/feed rails) are intentional empty placeholders — this plan's objective is a themed, env-driven, test-capable shell with no game logic. They are filled by later plans: connection badge (07-04), history/curve/feed live data (07-05), balance pill + bet/cashout (07-06). The fairness-badge slot is reserved for Phase 8 (drawer not implemented per UI-SPEC). No stub blocks this plan's goal (a booting styled shell).

## User Setup Required

- **Kong reload:** the `OPTIONS`-method additions to `docker/kong/kong.yml` require a Kong reload/restart (`bun run docker:up` or `docker compose restart kong`) to take effect; not performed by this plan. Re-probe each `OPTIONS` expecting `204`/`200` with the scoped `Access-Control-Allow-Origin` at the phase live-smoke.
- **`frontend/.env`:** copy `frontend/.env.example` to `frontend/.env` before `bun run dev` for real OIDC/REST/WS wiring (07-04+); the scaffold boots without it (the lazy `getConfig()` is only invoked once consumers exist).

## Next Phase Readiness

- 07-04 (auth + socket) wires `oidcSpa.createUtils` (the real v10.2.3 API per 07-02) consuming `getConfig().keycloak`, fills the connection-badge slot, and imports curve math from `@crash/contracts/multiplier`.
- The theme, `@/*` alias, workspace-TS transpile, and Vitest harness are all proven and ready to extend.

## Self-Check: PASSED

- Created files verified present: `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/tsconfig.json`, `frontend/components.json`, `frontend/src/styles/globals.css`, `frontend/src/lib/config.ts`, `frontend/src/lib/config.test.ts`, `frontend/src/routes/__root.tsx`, `frontend/src/routes/index.tsx`, `frontend/src/test/setup.ts`, 13 × `frontend/src/components/ui/*.tsx`, this SUMMARY
- Commits verified in `git log`: `f473417`, `bd4038e`, `b6ee856`
- `frontend/spike/` confirmed deleted

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-28*
