# Phase 7 Wave-0 De-Risking Spike Notes

Throwaway spike under `frontend/spike/`. Deleted by 07-03. Exists only to produce the
four DECISIONs below that gate the scaffold. Live environment: Bun 1.3.11, Vite 8.0.14,
TanStack Start 1.168.14, React 19.2.6, against the running docker stack (Kong :8000,
Keycloak realm `crash-game`, games + wallets up).

---

## DECISION: boot mode

**Decision: SPA mode (`spa: { enabled: true }`) is VIABLE on the pinned versions — the
Pitfall 1 / TanStack#5171 hang did NOT reproduce. Recommended scaffold shape:
selective-SSR fallback is unnecessary, but either mode boots; ratify at the checkpoint.**

### Evidence (both configs booted on Bun 1.3.11 + Vite 8)

| Config | File | Dev server | HTTP `/` | Client hydration |
|--------|------|-----------|----------|------------------|
| Default SSR + (later `ssr:false` per-route) | `vite.config.ssr.ts` | ready in ~1047ms | **200**, full server-rendered HTML | content present server-side (`1000.00 CRD`, `1.0618`) |
| Full SPA mode (`spa:{enabled:true}`) | `vite.config.spa.ts` | ready in ~825ms | **200**, empty SPA shell (`<!--$--><!--$--><!--/$-->`) | **client JS executed and hydrated** (dev error overlay rendered in-browser) |

- **Pitfall 1 verdict:** NOT reproduced. The documented #5171 symptom is "stuck on the
  loading skeleton, client pending, no console errors, never hydrates." In SPA mode the
  client entry (`virtual:tanstack-start-dev-client-entry`) loaded and React hydrated the
  shell — verified by driving headless Google Chrome (`--headless --dump-dom
  --virtual-time-budget=8000`): the body was replaced with client-rendered DOM (the dev
  error overlay), proving hydration ran. A hang would have left the empty shell untouched.
- **v1 API note (Rule 3 fix applied during spike):** TanStack Start v1.168 expects the
  router module to export **`getRouter`** (not `createRouter`). With `createRouter` the SSR
  handler threw `entries.routerEntry.getRouter is not a function` (500). Renaming to
  `getRouter` fixed it. The 07-03 scaffold must export `getRouter` from `src/router.tsx`.
- **ESM config-load note (Rule 3 fix applied):** a non-default-named config
  (`vite.config.ssr.ts`) is loaded via `require` by Vite's config bundler and fails on the
  ESM-only `@tanstack/react-start/plugin/vite` ("This package is ESM only") UNLESS the
  nearest `package.json` has `"type": "module"`. The 07-03 `frontend/package.json` must set
  `"type": "module"` (it does by convention for a Vite app; confirm).

### Recommendation for the checkpoint

Both modes are proven to boot. Two defensible paths:

- **`spa-mode`** — now verified to hydrate without the #5171 hang on the pinned versions.
  Cleanest for an auth-gated SPA; no per-route `ssr` flags; matches the RESEARCH primary
  recommendation. Risk: a future minor bump of Start/Vite could regress #5171; re-verify on
  upgrade.
- **`selective-ssr`** (default SSR + `ssr: false` on the game route) — the conservative
  fallback. Also boots; the game route renders client-only (auth + WS + Canvas + `window`).
  Marginally more route config; survives a future SPA-mode regression because it does not
  depend on the SPA-mode code path at all.

**Recommended: `selective-ssr`.** Rationale: the game page must not run on the server
(needs `window`, WS, OIDC, Canvas — CLAUDE.md §Frontend), and `ssr:false` per-route
expresses that intent explicitly while not depending on the SPA-mode build path that #5171
historically broke. SPA mode is a valid alternative now that the hang is disproven — this is
the call to ratify at the checkpoint.

---

## DECISION: workspace-TS transpile

**Decision: Vite transpiles the raw-TS workspace packages (`@crash/contracts`,
`@crash/shared-kernel`) and the `dinero.js/bigint` subpath with ZERO config additions —
BUT importing `multiplierAt` from the `@crash/contracts` ROOT barrel drags in `node:crypto`
and breaks the browser bundle. 07-03 MUST add a browser-safe contracts subpath.**

### Evidence

- `import { Money } from '@crash/shared-kernel'` and
  `import { multiplierAt } from '@crash/contracts'` both resolved and transpiled through
  Vite. Server-rendered output contained `1000.00 CRD` (Money VO, via `dinero.js/bigint` +
  bigint literals) and `1.0618` (`multiplierAt(1000, 0.06)`). The dev server served the
  workspace `.ts` file transpiled (`export class Money`) with no "invalid JS syntax" /
  "failed to parse source" error. **No `optimizeDeps.include` or `ssr.noExternal` entry was
  required** — bun's symlinked workspaces resolve and Vite/esbuild handle the TS + bigint
  target out of the box.
- **CRITICAL browser-only break:** in SPA mode (client bundle) the page threw
  `Module "node:crypto" has been externalized for browser compatibility. Cannot access
  "node:crypto.createHash" in client code.` Root cause: `@crash/contracts` root barrel
  (`src/index.ts`) does `export * from "./provably-fair"`, and `provably-fair/index.ts`
  re-exports `generate-seed-chain.ts` (`createHash`, `randomBytes` from `node:crypto`) and
  `derive-crash-point.ts` (`createHmac` from `node:crypto`). So pulling `multiplierAt` from
  the root barrel transitively imports Node-only crypto into the browser.
- `multiplier.ts` itself is **pure** (`Math.exp` only, zero crypto) — the fix is a granular
  export, not a code change to the formula.

### Required action for 07-03 (consumed by this DECISION)

Add a browser-safe subpath export to `packages/contracts/package.json`, e.g.:

```jsonc
"exports": {
  ".": "./src/index.ts",
  "./ws": "./src/ws/index.ts",
  "./multiplier": "./src/provably-fair/multiplier.ts",          // pure: multiplierAt
  "./formula": "./src/provably-fair/formulas.constants.ts"      // GROWTH_RATE, FORMULA_VERSION
}
```

The FE then imports `import { multiplierAt } from '@crash/contracts/multiplier'` (and the
formula constants from the formula subpath) — NOT from the root barrel. `@crash/shared-kernel`
`Money` from the root is fine (no `node:crypto`). The WS payload schemas at
`@crash/contracts/ws` are zod-only (browser-safe) and already a dedicated subpath from 07-01.

> This crypto break is boot-mode-independent (it is a browser-bundle issue; it surfaced in
> SPA mode because that path runs the route on the client; SSR masked it because Node has
> `node:crypto`, but the SSR client-hydration bundle would hit it too). The subpath fix is
> mandatory regardless of the boot-mode decision above.
