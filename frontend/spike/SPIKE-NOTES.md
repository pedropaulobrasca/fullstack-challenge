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

---

## DECISION: oidc instance strategy

**Decision: `single-getOidc` — use ONE oidc-spa instance from `oidc-spa/react-spa` and
consume its built-in `getOidc()` accessor for the socket singleton. Do NOT create a second
`createOidc` from `oidc-spa/core`. There is no dual-instance parity concern because the
v10.2.3 react-spa API returns both the React hook AND the non-React accessor from the same
underlying instance.**

### Evidence (resolved from installed `oidc-spa@10.2.3` type surface + live discovery)

- The installed `oidc-spa@10.2.3` `react-spa` builder returns a single `OidcSpaUtils`
  object exposing, from **one** underlying core oidc instance:
  - `useOidc` — React hook (components)
  - `getOidc` — `Promise<Oidc>` accessor with `getAccessToken()` +
    `subscribeToAccessTokenRotation(next)` — the non-React surface the socket.io singleton
    consumes (Pattern 8 token-for-handshake)
  - `enforceLogin` — TanStack Router loader/route guard
  - `bootstrapOidc`, `OidcInitializationGate`
  Because `getOidc` and `useOidc` come from the same `createUtils(...)` call, they share the
  same session/storage/token by construction — **Open Question 1 / Assumption A1 is moot**:
  the "two instances pointing at the same issuer" scenario does not arise.
- Multi-tab single-refresh (Pitfall 5 / REQ-AUTH-03) is library-guaranteed: oidc-spa core
  ships `loginPropagationToOtherTabs.js` / `logoutPropagationToOtherTabs.js` using
  `BroadcastChannel` keyed by `configId` (issuer+clientId). With one shared instance, all
  tabs coordinate on that channel — do NOT add a second refresh mechanism.
- Live OIDC discovery confirms the wiring target: issuer
  `http://localhost:8080/realms/crash-game`, `code_challenge_methods_supported=['plain','S256']`,
  `authorization_code` grant present, realm `redirectUris`/`webOrigins` allow only :3000/:8080.
  A real `player/player123` token was obtained via direct-grant (expires_in 3600, confirming
  Pitfall 3's 1h lifespan) and used to drive the CORS spike below.

### API-drift flag for 07-04 (important)

RESEARCH Pattern 7 assumed `createReactOidc` / `beforeLoadFn` named exports. The installed
v10.2.3 surface is the **`oidcSpa` builder** from `oidc-spa/react-spa` →
`.createUtils({...})` → `{ useOidc, getOidc, enforceLogin, bootstrapOidc,
OidcInitializationGate }`, plus a dedicated `oidc-spa/react-tanstack-start` entry point.
07-04 must wire against this real API, not the assumed `createReactOidc`/`beforeLoadFn`.

> Interactive PKCE login (redirect to Keycloak + callback) was NOT exercised headless — it
> requires a real browser session. The instance-parity question it would have answered is
> resolved structurally above (single instance), so the login round-trip is deferred to the
> 07-04 live wiring + the phase live-smoke gate. Token issuance + backend acceptance is
> already proven by the direct-grant token returning `balance.amount=60000 CRD` from
> `/wallets/me` below.

---

## DECISION: CORS reachability

**Decision: `fix-required` — the 07-01 Kong `cors` plugin correctly returns scoped headers
on simple/non-preflighted requests, BUT every route's `methods:` filter omits `OPTIONS`, so
browser CORS preflights 404 and block all credentialed/authorized REST calls. 07-03 MUST add
`OPTIONS` to each Kong route's `methods:` list.**

### Evidence (live curl against Kong :8000 from `Origin: http://localhost:3000`)

| Probe | Result |
|-------|--------|
| `GET /games/rounds/current` (public, simple) | **200** · `Access-Control-Allow-Origin: http://localhost:3000` (scoped, not `*`) · `Access-Control-Allow-Credentials: true` · `Vary: Origin` — readable |
| `GET /wallets/me` + `Bearer` (curl, no preflight) | **200** · scoped ACAO + credentials · body `balance.amount=60000 CRD` (Money snapshot) |
| `OPTIONS /wallets/me` (preflight) | **404** |
| `OPTIONS /games/bet` (preflight for POST place) | **404** |
| `OPTIONS /games/bets/me` (preflight for authed GET) | **404** |
| `OPTIONS /games/rounds/current` (preflight) | **404** |

### Root cause + required fix for 07-03

- The 07-01 `cors` plugin lists `OPTIONS` in its `methods`, but Kong only runs a plugin
  **after a route matches**. Each route in `docker/kong/kong.yml` constrains `methods:` to
  the business verb only (`wallets-me`→`[GET]`, `games-bet-place`→`[POST]`, etc.). A preflight
  `OPTIONS` matches **no** route → Kong 404 → the cors plugin never answers the preflight →
  the browser blocks the real request.
- Today only true "simple requests" succeed (public `GET`, no `Authorization`, no
  non-safelisted headers). Every authed GET (`/wallets/me`, `/games/bets/me` — carry
  `Authorization`) and every JSON `POST` (`/games/bet`, `/games/bet/cashout`) WILL be
  preflighted by a real browser and is currently **blocked**. The curl 200s above are
  misleading because curl does not preflight.
- **Fix (07-03):** add `OPTIONS` to the `methods:` list of every browser-reachable route
  (`games-current`, `games-history`, `games-verify`, `games-bets-me`, `games-bet-place`,
  `games-bet-cashout`, `wallets-provision`, `wallets-me`). Keep origins scoped to
  `http://localhost:3000` with `credentials: true` (never `*`). Re-probe each `OPTIONS`
  expecting `204`/`200` with the scoped ACAO + `Access-Control-Allow-Methods` /
  `Access-Control-Allow-Headers` echoed.
