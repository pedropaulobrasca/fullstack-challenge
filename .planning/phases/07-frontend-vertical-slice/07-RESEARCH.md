# Phase 7: Frontend Vertical Slice - Research

**Researched:** 2026-05-28
**Domain:** Real-time gambling SPA — TanStack Start v1 (SPA mode) + OIDC (oidc-spa/Keycloak) + socket.io-client 4.8 + Canvas 60fps interpolation + Zustand 5 slice-per-concern + Money VO on the wire
**Confidence:** HIGH (stack versions, oidc-spa v10 API, socket.io auth, TanStack SPA mode, workspace package shapes all verified against registry/official docs/codebase this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Layout):** Center-stage Canvas curve with side rails (Stake/Aviator pattern). Left rail = bet panel + cashout button; right rail = live feed; history strip across the top. Collapses to a single stacked column on mobile (curve → controls → feed → history).
- **D-02 (Visual identity):** Dark casino base (deep blacks) with **emerald/cyan neon** accent for the rising multiplier and cashout wins; **red reserved exclusively for crash** state. High contrast on black.
- **D-03 (Design source):** Source the visual system via the **ui-ux-pro MCP first** — pull design-system tokens, real-time/casino UI component patterns, references to ground the UI-SPEC, then theme shadcn/ui on top. (Already done — see 07-UI-SPEC.md, `ui_ux_pro_grounded: true`.) Also use impeccable / taste / emil-design skills during build.
- **D-04 (Animation/juice):** Tasteful, restrained polish: balance counter-up, subtle cashout glow + small confetti burst, crash = red flash + brief freeze overlay. No screen shake, no heavy particle storms. Senior-polished, not arcade-loud.
- **D-05 (Multiplier rendering, carried from ADR-022):** Client computes the multiplier locally each frame via `e^(GROWTH_RATE * t / 1000)` anchored to `roundStartedAt` from the WS snapshot; reconciles toward server `round:tick` via EWMA clock-offset tween — never snap. Canvas 2D only (rAF + devicePixelRatio + clearRect).
- **D-06 (State management, carried from ADR-021):** Zustand slice-per-concern; the multiplier rAF loop lives in its own isolated store so the high-frequency tick does not re-render the bet panel / feed / history components.

### Claude's Discretion

Exact shadcn component set, Tailwind v4 theme token names, file/route tree under `frontend/`, EWMA alpha constant (must be env/config-driven, not hardcoded — confirm value during planning), confetti library choice, skeleton component composition.

### Deferred Ideas (OUT OF SCOPE)

- **Provably-fair badge + `/verify/:roundId` route (REQ-FE-09/10)** — Phase 8. Verify endpoint exists backend-side; FE verification drawer + in-browser `crypto.subtle` ships in Phase 8 alongside replay.
- **Deterministic replay (REQ-REPLAY-*)** — Phase 8, reuses this phase's Canvas renderer.
- **Auto-bet / auto-cashout + leaderboard UI** — Phase 9, extends the bet panel.
- **Multi-bet** — stretch only, not in v1 vertical slice.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-FE-01 | Scaffold TanStack Start v1 + Vite + Tailwind v4 + shadcn CLI v4 + Zustand 5 + TanStack Query 5 + oidc-spa | §Standard Stack (verified versions), §Pattern 1 (SPA-mode scaffold under Bun monorepo), §Pitfall 1 (Bun+Vite SPA-mode hang), §Pitfall 8 (TS-source workspace import) |
| REQ-FE-02 | Canvas 2D curve @ 60fps via rAF, devicePixelRatio scaling, clearRect | §Pattern 4 (Canvas renderer), §Don't Hand-Roll (rAF loop), §Code Examples |
| REQ-FE-03 | Local multiplier formula `e^(GROWTH_RATE*t/1000)` anchored to `roundStartedAt`; EWMA clock-offset reconciliation (tween, never snap) | §Pattern 5 (EWMA reconciliation), uses `multiplierAt()` from `@crash/contracts`; §Pitfall 4 (anchor time source); §Open Question (alpha constant) |
| REQ-FE-04 | Bet input with Money-VO validation (min/max, no scientific notation, no negative); Bet button enabled only during BETTING + disabled with active bet | §Pattern 6 (Money on the wire), §Don't Hand-Roll (money parsing), §Pitfall 7 (eslint money rule scope) |
| REQ-FE-05 | Cashout button with live `bet × current multiplier` payout; enabled only ACTIVE+RUNNING | §Pattern 6, §State Matrix (UI-SPEC), reads `renderedMultiplier` slice |
| REQ-FE-06 | BETTING countdown timer | §Architecture (Zustand `round` slice + `bettingEndsAt` from snapshot/round:started) |
| REQ-FE-07 | Live bet/cashout feed; own actions highlighted | §Pattern 3 (WS event → store mapping), circular-buffer feed slice |
| REQ-FE-08 | History strip last 20 color-coded (env-tunable thresholds) | §Architecture (`GET /games/rounds/history` via TanStack Query + WS crash prepend), §Open Configuration Values (`VITE_HISTORY_*`) |
| REQ-FE-11 | Dark casino aesthetic | 07-UI-SPEC.md (approved contract) + §Pattern 2 (Tailwind v4 @theme) |
| REQ-FE-12 | Responsive desktop + mobile + touch | 07-UI-SPEC.md Layout Contract, §Architecture (responsive shell) |
| REQ-FE-13 | Loading skeletons + deduped toast errors | §Don't Hand-Roll (toast dedupe via sonner `id`), §Standard Stack (sonner, skeleton) |
| REQ-FE-14 | Balance counter-up, cashout celebration, crash flash/freeze | §Pattern 4 + §Standard Stack (canvas-confetti), §Pitfall 6 (reduced-motion) |
| REQ-AUTH-01 | OIDC Authorization Code + PKCE (S256) via oidc-spa against Keycloak | §Pattern 7 (oidc-spa v10 createReactOidc + beforeLoadFn), §Code Examples; realm already PKCE-S256 |
| REQ-AUTH-02 | Token persistence + silent renewal | §Pattern 7 (oidc-spa auto silent renew — built-in), §Pitfall 3 (token lifespan 3600s) |
| REQ-AUTH-03 | BroadcastChannel multi-tab refresh coordination | §Pattern 7 (oidc-spa BroadcastChannel — built-in, zero hand-roll), §Don't Hand-Roll |
</phase_requirements>

## Summary

The frontend is a **client-only SPA** (no meaningful SSR value — it is a live, auth-gated, WebSocket-driven game) that must be scaffolded from an empty `frontend/` workspace slot inside an existing Bun 1.3.11 monorepo. The entire locked stack was verified live on npm this session: TanStack Start `1.168.14`, oidc-spa `10.2.3`, socket.io-client `4.8.3`, Zustand `5.0.14`, Tailwind `4.3.0`, TanStack Query `5.100.14`, React `19.2.6`, Vite `8.0.14`, sonner `2.0.7`, canvas-confetti `1.9.4`, lucide-react `1.17.0`. Three of these differ materially from the months-old STACK.md assumptions and must be flagged to the planner: **Vite is v8** (STACK.md said v5; TanStack Start requires `vite >=7.0.0` and Tailwind v4 plugin supports v8 — fine), **lucide-react is v1.17** (major bump from the implied 0.x — API is the named-export icon components, still compatible with shadcn), and **oidc-spa is a mature v10** with a clean, well-documented API that handles PKCE, silent renewal, and multi-tab BroadcastChannel **automatically with zero hand-rolling**.

The four hardest integration points each have a concrete, verified answer. (1) **OIDC**: `createReactOidc` from `oidc-spa/react-spa` gives `useOidc()` + a `beforeLoadFn` TanStack Router guard; `createOidc` from `oidc-spa/core` gives a promise-based non-React `getOidc()` accessor that the socket singleton uses to read a fresh token via `oidc.getTokens()` — which auto-refreshes when near expiry. (2) **socket.io auth**: pass `auth: (cb) => getOidc().then(o => o.getTokens()).then(t => cb({ token: t.accessToken }))` — the function form re-runs on every (re)connect, so a refreshed token flows into the next handshake with no manual re-auth wiring (the backend `JwtIoAdapter` does handshake-only auth, no mid-connection re-auth, per CLAUDE.md). (3) **Canvas multiplier**: the FE imports `multiplierAt(elapsedMs, growthRate)` directly from `@crash/contracts` so the curve math is byte-identical to the server; the rAF loop computes `elapsedMs = (Date.now() + serverOffsetMs) − roundStartedAt` and the EWMA reconciler updates `serverOffsetMs` on each `round:tick` (`t` field) with a config-driven alpha. (4) **State**: Zustand slice-per-concern with the rAF multiplier in its OWN store so 30Hz writes only re-render `CrashCurve`.

The single highest-risk finding is a **known upstream bug**: TanStack Start `spa: { enabled: true }` **hangs on the loading skeleton under Bun + Vite 7/8** (TanStack/router#5171). This is a direct collision with this project's Bun 1.3.11 + Vite 8 environment and must be the first thing de-risked in a Wave-0 smoke before any UI is built.

**Primary recommendation:** Scaffold via the official TanStack Start manual setup (NOT `spa: { enabled: true }` until #5171 is confirmed fixed on the pinned versions — verify in a Wave-0 spike; fall back to default SSR + client-only route components / `ssr: false` selective SSR if SPA mode hangs). Wire `@crash/contracts` (multiplier formula + WS payload zod schemas) and `@crash/shared-kernel` (Money VO) as `workspace:*` TS-source imports — Vite transpiles them, no build step. Use oidc-spa v10's built-in PKCE + silent-renew + BroadcastChannel (zero hand-roll for REQ-AUTH-02/03). Make every business constant (`GROWTH_RATE`, EWMA alpha, history color thresholds, bet bounds, issuer/client) a `VITE_`-prefixed env var surfaced through a typed config module.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OIDC login / PKCE / token storage / silent renew / multi-tab | Browser / Client | Keycloak (IdP) | oidc-spa is a browser SPA library; tokens live in-memory + the library's storage; Keycloak is the authority. No FE server tier involved. |
| Route guard (redirect unauth → Keycloak) | Browser / Client (TanStack Router `beforeLoad`) | — | SPA mode disables server-side `beforeLoad`; auth gate runs client-side via `beforeLoadFn`. |
| Multiplier curve compute + 60fps render | Browser / Client (Canvas rAF) | API (server tick reconciliation) | Client interpolates locally for smoothness; server `round:tick` is the reconciliation authority (Gambetta pattern). |
| Bet placement / cashout (money mutations) | API (games-service via Kong) | Browser (optimistic UI + validation) | Server is authoritative for money + cashout race (ADR-023). FE validates input client-side, server re-validates. |
| Balance read + live balance push | API REST (`GET /wallets/me`) + WS push | Browser (Zustand mirror) | Hydrate via TanStack Query; live update via WS `bet:my_cashed_out` payout → recompute/refetch. |
| Live feed / history / round state | API (WS events + REST history) | Browser (Zustand live + Query paginated) | WS owns live stream; REST owns paginated history hydration. |
| Visual theme / responsive layout | Browser / CDN (static assets) | — | Pure client rendering; Tailwind v4 CSS-first tokens compiled at build. |

## Standard Stack

### Core
| Library | Version (verified npm 2026-05-28) | Purpose | Why Standard |
|---------|-----------------------------------|---------|--------------|
| `@tanstack/react-start` | `1.168.14` [VERIFIED: npm registry] | App framework (routing, SPA/SSR, Vite) | Locked by spec; v1 GA; pairs natively with Router + Query. |
| `@tanstack/react-router` | `1.170.8` [VERIFIED: npm registry] | File-based routing + type-safe loaders + `beforeLoad` guards | Bundled with Start; oidc-spa ships a Router guard helper. |
| `@tanstack/react-query` | `5.100.14` [VERIFIED: npm registry] | Server-state for REST hydration (history, balance, bets/me) | Locked; cache + dedupe + retry for REST surfaces. |
| `react` / `react-dom` | `19.2.6` [VERIFIED: npm registry] | UI runtime | TanStack Start v1 peer `>=18 || >=19`; project standard React 19. |
| `vite` | `8.0.14` [VERIFIED: npm registry] | Build/dev server | TanStack Start peer `vite >=7.0.0`; **NOTE: STACK.md said v5 — superseded.** |
| `tailwindcss` + `@tailwindcss/vite` | `4.3.0` [VERIFIED: npm registry] | Styling, CSS-first `@theme` tokens | Locked v4; vite plugin peer supports `^8`. |
| `oidc-spa` | `10.2.3` [VERIFIED: npm registry] | Keycloak OIDC Authorization Code + PKCE (S256), silent renew, BroadcastChannel | Locked; purpose-built SPA OIDC; keycloakify-authored; handles REQ-AUTH-01/02/03 with near-zero code. |
| `socket.io-client` | `4.8.3` [VERIFIED: npm registry] | WS client to Kong `/ws` (websocket-only transport) | Matches backend `socket.io@4.8`; auth-function handshake + auto-reconnect. |
| `zustand` | `5.0.14` [VERIFIED: npm registry] | Client state, slice-per-concern, isolated rAF store (D-06) | Locked; selector-based granular re-render. |

### Supporting
| Library | Version (verified) | Purpose | When to Use |
|---------|--------------------|---------|-------------|
| `@crash/contracts` | `workspace:*` (TS source) | `multiplierAt()`, `crashTimeMs()`, `FORMULA_VERSION`, `GROWTH_RATE` constants, provably-fair; **also home for WS payload zod schemas** | Curve math (REQ-FE-03) + runtime-validate WS payloads. **See Pitfall 8 + Open Question 3.** |
| `@crash/shared-kernel` | `workspace:*` (TS source) | `Money` VO (`Money.of`, `fromSnapshot`, `multiplyRounded`, `toSnapshot`, `toString`), `CRD` currency | Bet validation + payout display (REQ-FE-04/05). |
| `sonner` | `2.0.7` [VERIFIED: npm registry] | Toast notifications with dedupe via stable `id` | Error toasts (REQ-FE-13); shadcn-recommended. |
| `canvas-confetti` | `1.9.4` [VERIFIED: npm registry, 13.5M wk dl] | Cashout celebration burst (REQ-FE-14) | Single gated burst; lightweight, MIT, no postinstall. |
| `lucide-react` | `1.17.0` [VERIFIED: npm registry, 77M wk dl] | Icons (TrendingUp/Down, Wallet) | shadcn default; **NOTE: now v1.x — named-export icon API unchanged, still shadcn-compatible.** |
| `zod` | `^3.23` (`workspace:*` peer alignment) | Validate WS payloads + parse env config | Already a contracts/shared-kernel dep; align FE to same major to avoid drift. |
| `class-variance-authority`, `clsx`, `tailwind-merge` | shadcn-managed | cva variants + `cn()` | Installed by shadcn init. |

### shadcn/ui components (install on demand, official registry)
`button card dialog input label tabs sonner tooltip skeleton badge separator scroll-area progress` (per 07-UI-SPEC.md Component Inventory + Registry Safety table — all official registry, no vetting gate).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `canvas-confetti` | `react-confetti`, `tsparticles` | react-confetti is a full-screen component (heavier, harder to gate per-event); tsparticles is overkill ("heavy particle storm" — explicitly rejected by D-04). canvas-confetti's imperative single-burst API fits the restrained budget. |
| TanStack Start SPA mode | Default SSR + `ssr: false` selective SSR per route | SPA mode is cleaner for an auth SPA BUT collides with Bun+Vite hang (#5171). Selective SSR (`ssr: false` on the game route) is the documented fallback. **Decide in Wave-0 spike.** |
| oidc-spa | `oidc-client-ts` raw, hand-rolled PKCE | Locked decision; oidc-spa gives PKCE + silent renew + BroadcastChannel for free — rolling these burns 1-2 days and is the exact thing the multi-tab requirement (REQ-AUTH-03) makes error-prone. |

**Installation (run inside `frontend/` after scaffold):**
```bash
# Scaffold deps (versions pinned to verified set)
bun add @tanstack/react-start@1.168.14 @tanstack/react-router@1.170.8 @tanstack/react-query@5.100.14 react@19 react-dom@19
bun add oidc-spa@10.2.3 socket.io-client@4.8.3 zustand@5
bun add sonner@2 canvas-confetti@1 lucide-react@1
bun add -d vite@8 @vitejs/plugin-react tailwindcss@4 @tailwindcss/vite@4 @types/react @types/react-dom @types/node
bun add -d @types/canvas-confetti
# workspace packages (TS source, no build)
bun add @crash/contracts@workspace:* @crash/shared-kernel@workspace:*
# shadcn (after Tailwind v4 + @/* alias are configured)
bunx shadcn@latest init
bunx shadcn@latest add button card dialog input label tabs sonner tooltip skeleton badge separator scroll-area progress
```

**Version verification performed this session** (`npm view <pkg> version`): every package above confirmed to exist at the stated version with a legitimate source repo and no `postinstall` script (see Package Legitimacy Audit).

## Package Legitimacy Audit

> slopcheck was installed but defaults to the **PyPI** ecosystem and produced false-positive `[SLOP]` verdicts for these npm packages ("does not exist on pypi"). Per the protocol's cross-ecosystem rule, PyPI verdicts are **discarded** — these are npm packages. Legitimacy was instead established via npm registry (`npm view`), weekly-download volume, source-repo presence, and `postinstall` inspection. Packages are tagged `[VERIFIED: npm registry]` where also discovered/confirmed via official docs (TanStack, shadcn, oidc-spa docs, STACK.md lock).

| Package | Registry | Version | Weekly DL | Source Repo | postinstall | Disposition |
|---------|----------|---------|-----------|-------------|-------------|-------------|
| @tanstack/react-start | npm | 1.168.14 | 13.8M | github.com/TanStack/router | none | Approved |
| @tanstack/react-router | npm | 1.170.8 | (with Start) | github.com/TanStack/router | none | Approved |
| @tanstack/react-query | npm | 5.100.14 | very high | github.com/TanStack/query | none | Approved |
| react / react-dom | npm | 19.2.6 | very high | github.com/facebook/react | none | Approved |
| vite | npm | 8.0.14 | very high | github.com/vitejs/vite | none | Approved |
| tailwindcss | npm | 4.3.0 | 107M | github.com/tailwindlabs/tailwindcss | none | Approved |
| @tailwindcss/vite | npm | 4.3.0 | 32M | github.com/tailwindlabs/tailwindcss | none | Approved |
| oidc-spa | npm | 10.2.3 | 17.5k | github.com/keycloakify/oidc-spa | none | Approved (lower DL but authoritative author keycloakify; locked by spec) |
| socket.io-client | npm | 4.8.3 | 12.4M | github.com/socketio/socket.io | none | Approved |
| zustand | npm | 5.0.14 | 35.8M | github.com/pmndrs/zustand | none | Approved |
| sonner | npm | 2.0.7 | 40.6M | github.com/emilkowalski/sonner | none | Approved |
| canvas-confetti | npm | 1.9.4 | 13.5M | github.com/catdad/canvas-confetti | none | Approved |
| lucide-react | npm | 1.17.0 | 77.9M | github.com/lucide-icons/lucide | none | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none (all SLOP verdicts were PyPI-ecosystem false positives; discarded).
**Packages flagged as suspicious [SUS]:** none. (oidc-spa has comparatively low weekly downloads (~17.5k) but is authored by the keycloakify org, has a real GitHub repo, is the spec-locked choice, and has no postinstall — not flagged.)

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                  Browser (frontend SPA)                    │
                    │                                                            │
  player action ───▶│  TanStack Router (file routes, beforeLoadFn auth guard)    │
                    │        │                                                   │
                    │        ▼                                                   │
                    │  ┌─────────────┐   login redirect    ┌──────────────────┐  │
                    │  │  oidc-spa   │────────────────────▶│  Keycloak :8080  │  │
                    │  │ (PKCE S256, │◀────────────────────│ realm crash-game │  │
                    │  │ silent-renew│   tokens (3600s)     │ pub client PKCE  │  │
                    │  │ BroadcastCh)│                      └──────────────────┘  │
                    │  └──────┬──────┘                                            │
                    │         │ getTokens() (auto-refresh)                        │
                    │         ▼                                                   │
                    │  ┌──────────────────────────── Zustand stores ──────────┐  │
                    │  │ authSlice  walletSlice  roundSlice  feedSlice         │  │
                    │  │ historySlice            ┌─────────────────────────┐   │  │
                    │  │                         │ multiplierStore (D-06)  │   │  │
                    │  │                         │  rAF-written, isolated  │   │  │
                    │  └─────────┬───────────────┴───────────┬─────────────┘   │  │
                    │            │ selectors                  │ renderedMultiplier  │
                    │            ▼                            ▼                  │  │
                    │   BetPanel / CashoutButton /     ┌──────────────┐         │  │
                    │   Feed / History / Balance       │  CrashCurve  │         │  │
                    │                                  │ Canvas 2D rAF│         │  │
                    │                                  │ devicePixel  │         │  │
                    │                                  │ clearRect    │         │  │
                    │                                  └──────────────┘         │  │
                    │            │                            ▲                 │  │
                    │   fetch (Bearer)│              local compute via          │  │
                    │            │    │              multiplierAt() from        │  │
                    │            │    │              @crash/contracts +         │  │
                    │            │    │              EWMA(serverOffset)         │  │
                    │   ┌────────▼────┴───── socket.io-client (websocket only) ─┐│  │
                    │   │ auth:(cb)=>getTokens()→cb({token}); on(events)→stores ││  │
                    │   └───────────────┬───────────────────────┬─────────────┘│  │
                    └───────────────────┼───────────────────────┼──────────────┘
                                        │ HTTP REST              │ WS upgrade
                                        ▼                        ▼
                            ┌──────────────────────────────────────────────┐
                            │            Kong Gateway :8000                 │
                            │  /games/* /wallets/* (REST)   /ws (WS→:4101)  │
                            │  ⚠ NO cors plugin configured (see Pitfall 2)  │
                            └───────┬───────────────────────────┬──────────┘
                                    ▼                           ▼
                            games-service :4001 (REST)   games-service :4101 (Socket.IO)
                            wallets-service :4002 (REST)  emits: round:snapshot/started/
                                                          running/crashed/settled/tick(30Hz),
                                                          bet:placed/cashed_out (lobby),
                                                          bet:my_active/refunded/cashed_out (user room)
```

### Recommended Project Structure
```
frontend/
├── vite.config.ts              # tanstackStart() + viteReact() + tailwindcss(); server.port 3000
├── components.json             # shadcn (tailwind config blank for v4)
├── tsconfig.json               # extends nothing (no root tsconfig — see Pitfall 8); @/* alias
├── .env.example                # VITE_* config (issuer, growth rate, alpha, thresholds, bounds)
├── index.html
├── src/
│   ├── router.tsx              # createRouter(routeTree)
│   ├── routeTree.gen.ts        # generated by plugin
│   ├── styles/globals.css      # @import "tailwindcss"; @theme { ...tokens } ; :root/.dark vars
│   ├── routes/
│   │   ├── __root.tsx          # layout: header (balance pill, connect badge), <Toaster/>, OidcProvider
│   │   ├── index.tsx           # game page (beforeLoad: beforeLoadFn auth guard)
│   │   └── auth.callback.tsx   # oidc-spa callback (if needed; lib often handles via query params)
│   ├── auth/
│   │   ├── oidc.ts             # createOidc (core) → getOidc(); createReactOidc → useOidc, beforeLoadFn
│   │   └── oidc-provider.tsx
│   ├── ws/
│   │   └── socket.ts           # socket.io singleton; auth:(cb)=>getOidc().getTokens()
│   ├── stores/
│   │   ├── round.store.ts      # round status, bettingEndsAt, serverOffsetMs, history seed
│   │   ├── multiplier.store.ts # ISOLATED rAF-written renderedMultiplier (D-06)
│   │   ├── wallet.store.ts     # balance (Money snapshot mirror)
│   │   ├── feed.store.ts       # circular buffer last ~50
│   │   └── bet.store.ts        # my active bet, pending state
│   ├── features/
│   │   ├── game/CrashCurve.tsx, Countdown.tsx, use-game-socket.ts, use-multiplier-frame.ts
│   │   ├── bet/BetPanel.tsx, CashoutButton.tsx, validate-bet-amount.ts
│   │   ├── feed/LiveFeed.tsx
│   │   ├── history/HistoryStrip.tsx, use-history.ts (TanStack Query)
│   │   └── wallet/BalancePill.tsx, use-wallet.ts (TanStack Query)
│   ├── lib/
│   │   ├── config.ts           # typed VITE_* env (zod-parsed) — single source of truth
│   │   ├── ws-payloads.ts      # zod schemas if NOT promoted to @crash/contracts (Open Q 3)
│   │   ├── format-money.ts     # display formatter on Money.toSnapshot()
│   │   └── api.ts              # fetch wrapper injecting Bearer token
│   └── components/ui/          # shadcn output
└── public/
```

### Pattern 1: SPA scaffold under the Bun monorepo
**What:** Manual TanStack Start setup wired into the existing Bun workspace; client-only rendering for the auth-gated game.
**When to use:** REQ-FE-01.
**Example:**
```ts
// vite.config.ts — Source: tanstack.com/start build-from-scratch + tailwindcss.com/docs/installation/vite
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { port: 3000 },             // MUST be 3000 — Keycloak realm redirectUris/webOrigins only allow :3000 + :8080
  plugins: [
    tanstackStart(),                  // ⚠ do NOT add spa:{enabled:true} until #5171 verified fixed on Bun+Vite8 (Pitfall 1)
    viteReact(),
    tailwindcss(),
  ],
})
```
> SPA decision: ship as default-SSR-disabled-per-route (`ssr: false` on the game route via selective SSR) OR full SPA mode — **prove in Wave-0 which one boots cleanly on Bun 1.3.11 + Vite 8** (Pitfall 1).

### Pattern 2: Tailwind v4 `@theme` tokens (CSS-first)
**What:** Author the UI-SPEC color/typography tokens as CSS variables; no `tailwind.config.js`.
**When to use:** REQ-FE-11; consumes 07-UI-SPEC.md Color/Typography tables.
**Example:**
```css
/* src/styles/globals.css — Source: tailwindcss.com/docs/theme (v4 @theme) + shadcn tailwind-v4 */
@import "tailwindcss";
@theme {
  --color-background: #0A0F14;
  --color-card: #111827;
  --color-accent: #00FF85;        /* emerald — rising/win (D-02) */
  --color-accent-cyan: #22D3EE;
  --color-destructive: #EF4444;   /* CRASH ONLY (D-02 non-negotiable) */
  --font-mono: "Fira Code", monospace;   /* tabular display (multiplier/money) */
  --font-sans: "Fira Sans", sans-serif;
}
```

### Pattern 3: WS event → Zustand slice / Query cache mapping
**What:** One `useGameSocket()` hook (called once in `__root.tsx`) subscribes to the exact backend event catalog and routes each into the right slice. **Validate every payload with the zod schema** before applying.
**When to use:** REQ-FE-06/07/08 + multiplier reconciliation.
**Backend event catalog (exact strings, grepped from `services/games/src`):**
`round:snapshot`, `round:started`, `round:running`, `round:crashed`, `round:settled`, `round:tick` (30Hz volatile), `bet:placed`, `bet:cashed_out` (lobby, masked), `bet:my_active`, `bet:my_refunded`, `bet:my_cashed_out` (user room).
**Payload field names (verified in `ws-event.payloads.ts`):**
- `round:snapshot` → `{ round: {id,status,nonce,seedHash,clientSeed,bettingEndsAt,startedAt,crashedAt,settledAt,crashPoint,serverSeed}, activeBets[], myBet|null, serverTime }`
- `round:tick` → `{ roundId, multiplier:number, t:epochMs }` ← `t` drives EWMA offset; `multiplier` is the reconcile target
- `round:running` → `{ roundId, startedAt:ISO }` ← parse to ms = the curve anchor
- `round:crashed` → `{ roundId, crashPoint:number, crashedAt:ISO }` ← freeze value
- `bet:my_cashed_out` → `{ roundId, betId, multiplier, payout:MoneySnapshot }` ← celebration + balance update
**Anti-pattern:** subscribing the bet panel / feed / header to `round:tick`. Only `multiplier.store` consumes ticks (D-06).

### Pattern 4: Canvas 60fps renderer (rAF + devicePixelRatio + clearRect)
**What:** A single `requestAnimationFrame` loop owned by `CrashCurve`, reading from the isolated multiplier store.
**When to use:** REQ-FE-02/14.
**Example:**
```ts
// use-multiplier-frame.ts — Source: CLAUDE.md §Frontend + MDN devicePixelRatio canvas pattern
function setupCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1
  const { clientWidth: w, clientHeight: h } = canvas
  canvas.width = w * dpr; canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)               // logical coords, crisp on retina
  return ctx
}
// loop: clearRect(0,0,w,h) every frame; compute m via multiplierAt(elapsedMs, GROWTH_RATE); draw curve+glow
```

### Pattern 5: EWMA clock-offset reconciliation (never snap) — REQ-FE-03 / D-05
**What:** Client renders from `multiplierAt(elapsed, GROWTH_RATE)` where `elapsed = (Date.now() + serverOffsetMs) − roundStartedAt`. Each `round:tick` updates `serverOffsetMs` by an exponentially-weighted moving average toward `(t − Date.now())`.
**Example:**
```ts
// Source: @crash/contracts multiplierAt + ADR-022 + Gabriel Gambetta entity-interpolation canon
import { multiplierAt } from '@crash/contracts'
// on round:running → store.roundStartedAt = Date.parse(payload.startedAt)
// on round:snapshot (RUNNING) → roundStartedAt = Date.parse(round.startedAt); seed serverOffset from serverTime
// on round:tick:
function onTick({ t }: { t: number }) {
  const instantaneousOffset = t - Date.now()
  serverOffsetMs = serverOffsetMs == null
    ? instantaneousOffset
    : serverOffsetMs + EWMA_ALPHA * (instantaneousOffset - serverOffsetMs)  // EWMA_ALPHA from VITE_ env (Open Q 3)
}
// each rAF frame: const m = multiplierAt(Date.now() + serverOffsetMs - roundStartedAt, GROWTH_RATE)
// on round:crashed → freeze rendered value at payload.crashPoint (server-authoritative, not last interpolation)
```
**Note:** `multiplierAt` throws if `growthRate <= 0` — guard the env value at config-parse time.

### Pattern 6: Money on the wire (REQ-FE-04/05/06) — never `number`
**What:** Bet input parses a decimal string → cents `bigint` → `Money.of(cents)`; bounds-check against `Money.of(BET_MIN_CENTS)` / `BET_MAX_CENTS` via `.lessThan`/`.greaterThan`. Payout display uses `Money.toSnapshot()` through a formatter (the VO exposes `toString()` as `"1000.00 CRD"` and `toSnapshot()` `{amount, currency, scale}` — **there is NO `.format()` method; the FE must build the display formatter**).
**Example:**
```ts
// validate-bet-amount.ts — Source: packages/shared-kernel/src/money/money.ts (read this session)
import { Money } from '@crash/shared-kernel'
// reject scientific notation / negative / non-numeric BEFORE constructing cents:
const RE = /^\d+(\.\d{1,2})?$/   // no 'e', no '-', max 2 decimals
function toMoneyCents(input: string): bigint {           // 2-decimal CRD → cents
  const [whole, frac = ''] = input.split('.')
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'))
}
// Money.of throws NegativeMoneyError on < 0; bounds via Money compareTo
// live payout: Money.fromSnapshot(bet.amount).multiplyRounded(renderedMultiplier, 'bankers')
```
**eslint money rule caveat:** see Pitfall 7 — the rule currently only matches `**/*.ts`, not `.tsx`.

### Pattern 7: oidc-spa v10 — PKCE + guard + non-React token (REQ-AUTH-01/02/03)
**What:** Two entry points. `createReactOidc` (from `oidc-spa/react-spa`) provides `useOidc()` + `beforeLoadFn` (Router guard). `createOidc` (from `oidc-spa/core`) provides a promise-based `getOidc()` for the socket singleton. Silent renewal + BroadcastChannel multi-tab are **automatic — no config, no hand-rolling** (this is the entirety of REQ-AUTH-02 and REQ-AUTH-03).
**Example:**
```ts
// src/auth/oidc.ts — Source: docs.oidc-spa.dev integration-guides/tanstack-router-start + llms-full.txt
import { createReactOidc } from 'oidc-spa/react-spa'
export const { useOidc, beforeLoadFn } = createReactOidc({
  issuerUri: import.meta.env.VITE_KEYCLOAK_ISSUER,   // http://localhost:8080/realms/crash-game
  clientId:  import.meta.env.VITE_KEYCLOAK_CLIENT_ID, // crash-game-client
  scopes: ['profile', 'email'],
})
// route guard:  beforeLoad: beforeLoadFn({ doesCurrentHrefRequiresAuth: true })
// in component:  const oidc = useOidc(); oidc.isUserLoggedIn; await oidc.login({...}); oidc.logout({redirectTo:'home'})

// src/ws/socket.ts (non-React) — token for socket.io handshake
import { createOidc } from 'oidc-spa/core'
const prOidc = createOidc({ issuerUri: import.meta.env.VITE_KEYCLOAK_ISSUER, clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID })
export const getOidc = () => prOidc
```
> ⚠ Two `createOidc`/`createReactOidc` instances pointing at the same issuer/client is the documented pattern, but confirm in the Wave-0 auth spike that the React + core instances share session/storage cleanly (Open Q 1). The issuer host must be `localhost:8080` to match the realm `redirectUris`.

### Pattern 8: socket.io-client auth function + auto re-handshake on refresh (REQ-AUTH-02 ↔ WS)
**What:** The `auth` option as a **function** re-runs on every (re)connect. Reading the token via `getTokens()` (which auto-refreshes if near expiry) means a refreshed token flows into the next handshake with zero manual re-auth code. Backend does handshake-only auth (CLAUDE.md: "No mid-connection re-auth"), so on token expiry the client simply reconnects and re-handshakes.
**Example:**
```ts
// src/ws/socket.ts — Source: socket.io.dev client-options (auth function) + discussion #4936 + ADR-021/022
import { io, type Socket } from 'socket.io-client'
import { getOidc } from './oidc'
let socket: Socket | undefined
export function getSocket(): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_WS_URL, {       // http://localhost:8000  (Kong proxies /ws → games:4101)
      path: '/ws',                                    // matches Kong route ~/ws/?$
      transports: ['websocket'],                      // backend is websocket-only
      auth: (cb) => { void getOidc().then(o => o.getTokens()).then(t => cb({ token: t.accessToken })) },
    })
  }
  return socket
}
// reconnection (exponential backoff) is on by default → on reconnect, auth fn re-runs → fresh token (REQ-WS-07)
// on 'round:snapshot' (emitted every connect/reconnect) → full state resync
```

### Anti-Patterns to Avoid
- **SSR-ing the game page.** It needs auth + WS + Canvas + `window` — render client-only. Avoid `spa:{enabled:true}` until #5171 is verified (Pitfall 1).
- **Subscribing non-curve components to `round:tick`.** Violates D-06; causes 30Hz re-renders of the whole page.
- **Using `number` for any bet/payout/balance.** Violates CLAUDE.md §Money + eslint rule. Use `Money` end-to-end.
- **Snapping the curve to the server tick.** D-05 mandates EWMA tween; snapping causes visible jitter.
- **Hardcoding `GROWTH_RATE`, EWMA alpha, history thresholds, bet bounds.** Violates CLAUDE.md §Configuration — all `VITE_`-env-driven.
- **Reading the token once and caching it for the socket.** Always read via `getTokens()` per connect so silent-renew is honored.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PKCE flow, code-verifier, callback parsing | Custom OAuth client | `oidc-spa` `createReactOidc` | PKCE S256 + state/nonce + callback handled; realm already PKCE-S256. |
| Silent token renewal | Refresh-timer loop / manual iframe | oidc-spa built-in auto-renew via `getTokens()` | "Do not refresh in a loop" (oidc-spa docs); near-expiry refresh is automatic. |
| Multi-tab token coordination | Custom `BroadcastChannel` rotation logic | oidc-spa built-in BroadcastChannel | REQ-AUTH-03 satisfied by the library; hand-rolling causes refresh storms (Pitfall 5). |
| WS reconnection + backoff | Custom reconnect timer | socket.io-client default reconnection | Exponential backoff built-in; `round:snapshot` on reconnect resyncs (REQ-WS-07). |
| Toast dedupe | Set/Map of shown messages | sonner `toast(msg, { id: stableKey })` | Same `id` updates-in-place instead of stacking (REQ-FE-13). |
| Money parse / round / format | float math, `toFixed` | `@crash/shared-kernel` `Money` (+ thin display formatter on `toSnapshot()`) | bigint-cents, banker's rounding, byte-identical to backend. |
| Multiplier curve math | re-derive `e^(...)` | `multiplierAt()` from `@crash/contracts` | Byte-identical to server; single source of truth for the formula. |
| Confetti physics | Particle simulation | `canvas-confetti` single burst | One imperative call; gate behind reduced-motion. |
| rAF loop scaffolding | Manual `setInterval` "60fps" | `requestAnimationFrame` recursive | setInterval drifts; rAF is vsync-aligned (CLAUDE.md mandate). |

**Key insight:** oidc-spa collapses three of the riskiest requirements (REQ-AUTH-01/02/03 — PKCE, silent renew, multi-tab) into library configuration. The only auth code the FE writes is wiring + the route guard. Spend the saved budget on the Canvas/EWMA renderer and the Money-VO bet flow, which are the genuinely novel work.

## Common Pitfalls

### Pitfall 1: TanStack Start SPA mode hangs on Bun + Vite 7/8 (HIGHEST RISK)
**What goes wrong:** Adding `tanstackStart({ spa: { enabled: true } })` causes the app to render the loading skeleton and never hydrate — no JS errors. [CITED: github.com/TanStack/router/issues/5171]
**Why it happens:** Upstream interaction between SPA-mode build output and the Bun runtime under Vite 7+. This project runs Bun 1.3.11 + Vite 8 — squarely in the affected configuration.
**How to avoid:** In Wave 0, spike both modes on the pinned versions. If SPA mode hangs, ship **default SSR with `ssr: false` selective SSR on the game route** (documented fallback) and render auth/WS/Canvas client-only. Track #5171 + PR #5262 for a fixed version.
**Warning signs:** Dev server starts, page stuck on skeleton, client "pending", no console errors.

### Pitfall 2: Kong has NO CORS plugin — browser REST calls from :3000 to :8000 will fail
**What goes wrong:** `fetch('http://localhost:8000/games/...')` from the SPA at `http://localhost:3000` is a cross-origin request; with no CORS headers from Kong, the browser blocks the response. [VERIFIED: codebase — `grep -c cors docker/kong/kong.yml` → 0]
**Why it happens:** The backend was built/tested via curl + socket.io (the WS gateway sets `cors:{origin:true}`, but Kong REST routes do not). No browser client existed before Phase 7.
**How to avoid:** Add a Kong CORS plugin (global or per-route) allowing `http://localhost:3000` with credentials + the methods/headers the FE uses, OR proxy REST through the Vite dev server. **This is a backend/infra config task the plan MUST include** — it is not optional and is invisible until the first browser fetch. (The WS path is fine: the socket.io server already reflects origin.)
**Warning signs:** WS works but every REST call (balance, history, bet, cashout) fails with a CORS console error.

### Pitfall 3: Access token lifespan is 3600s — refresh must work or sockets drop after 1h
**What goes wrong:** `accessTokenLifespan: 3600` in the realm [VERIFIED: realm-export.json]. After 1h, an unrefreshed token expires; the backend rejects the next handshake.
**Why it happens:** Long-lived demo token masks refresh bugs in short sessions.
**How to avoid:** Rely on oidc-spa auto-renew + the socket auth-function pattern (Pattern 8) — never cache the token. Verify a forced-refresh reconnect in the Wave-0 auth spike (can shorten lifespan temporarily to test).
**Warning signs:** Everything works for an hour then silently breaks.

### Pitfall 4: Wrong time anchor for the curve → drift or wrong start
**What goes wrong:** Anchoring `elapsed` to client `Date.now()` at mount, or to `bettingEndsAt`, instead of the server `startedAt`, makes the curve start at the wrong multiplier.
**Why it happens:** `round:running.startedAt` is an ISO string; `round:snapshot.round.startedAt` may be null (during BETTING). Easy to use the wrong field.
**How to avoid:** Anchor to `Date.parse(startedAt)` from `round:running` (or snapshot when status===RUNNING). Use `serverTime` from the snapshot to seed `serverOffsetMs`. Only compute the curve when `status === 'RUNNING'` and `startedAt != null`.
**Warning signs:** Curve jumps at round start, or multiplier disagrees with the server tick by a constant factor.

### Pitfall 5: Multi-tab refresh storm (mitigated by oidc-spa, but verify)
**What goes wrong:** N tabs each independently refresh the token at expiry → N concurrent refreshes → Keycloak may reject/rotate inconsistently.
**Why it happens:** Naive per-tab refresh timers.
**How to avoid:** oidc-spa's built-in BroadcastChannel elects one tab to refresh and shares the result (REQ-AUTH-03). **Do not add a second refresh mechanism.** Verify two-tab behavior in the auth spike.
**Warning signs:** Tabs log out each other; intermittent 401s with multiple tabs open.

### Pitfall 6: `prefers-reduced-motion` not honored → accessibility regression
**What goes wrong:** Confetti, crash flash, and counter-up animate regardless of OS setting (UI-SPEC mandates honoring reduced-motion).
**How to avoid:** Gate confetti/flash/counter-up behind `window.matchMedia('(prefers-reduced-motion: reduce)')`; on reduce, snap to final state. Curve still renders (it is content). [CITED: 07-UI-SPEC.md §Accessibility]
**Warning signs:** UI-checker flags reduced-motion; motion plays with the OS toggle on.

### Pitfall 7: eslint money rule does not match `.tsx` files
**What goes wrong:** `@crash/no-number-for-money` is configured for `files: ["**/*.ts"]` only [VERIFIED: eslint.config.js]. FE components are `.tsx` — the money guard silently does not apply to them.
**Why it happens:** The flat config predates any `.tsx` in the repo.
**How to avoid:** The plan should extend `eslint.config.js` to add `**/*.tsx` to the money-rule `files` glob (and keep the `tests` override). Otherwise REQ-DOM-06's "no `number` for money, frontend included" is unenforced in components.
**Warning signs:** A `number` payout sneaks into a `.tsx` with no lint error.

### Pitfall 8: Workspace packages export raw TS `src/index.ts` (no build) + no root tsconfig
**What goes wrong:** `@crash/contracts` and `@crash/shared-kernel` set `"main": "src/index.ts"` (TypeScript source, not compiled JS) [VERIFIED: package.json read this session]. Vite must transpile these on import; some bundler configs only transpile the app's own source, not `node_modules`/linked workspace TS. Also, the root `typecheck` script references `tsconfig.json` that **does not exist** at repo root [VERIFIED: `find` returned none].
**Why it happens:** The backend runs on Bun which executes TS directly; no build was ever needed. Vite/esbuild handle workspace TS via `optimizeDeps` / `ssr.noExternal` but it can need explicit config.
**How to avoid:** (1) Ensure Vite transpiles the workspace packages — add them to `optimizeDeps.include` or `ssr.noExternal` if import errors appear; bun's symlinked workspaces usually resolve, but verify in Wave 0. (2) The Money VO imports `dinero.js/bigint` (ESM subpath, browser-safe, verified) and uses bigint literals — ensure the Vite target supports bigint (esbuild default does). (3) Give `frontend/` its own self-contained `tsconfig.json` (do not assume a root extends-base exists).
**Warning signs:** "Failed to parse source for import analysis... contains invalid JS syntax" on a workspace `.ts` import, or `dinero.js/bigint` resolution errors.

### Pitfall 9: Socket connects before auth is ready (race on first paint)
**What goes wrong:** The socket singleton tries to handshake before oidc-spa has a token → handshake fails → reconnect loop.
**How to avoid:** Only instantiate/connect the socket after `oidc.isUserLoggedIn` is true (call `getSocket()` inside the authed game route, not at module top-level). The auth function `getTokens()` is async and will await the token, but the route guard should already guarantee login.
**Warning signs:** Initial connect_error UNAUTHORIZED that self-heals after a reconnect.

### Pitfall 10: WS payload schemas live only in `services/games`, not in `@crash/contracts`
**What goes wrong:** `ws-event.payloads.ts` (the zod schemas + TS types for every WS event) is under `services/games/src/presentation/dtos/` — **not exported from `@crash/contracts`** [VERIFIED: grep]. The FE cannot import them; without them it hand-redeclares shapes and drifts from the server.
**How to avoid:** Promote the WS payload zod schemas into `@crash/contracts` (e.g. `@crash/contracts/ws`) so both tiers share one source, OR (smaller change) re-declare them in `frontend/src/lib/ws-payloads.ts` and accept the drift risk. **Promoting is the senior move and prevents silent contract drift** — recommend to the planner. (See Open Question 3.)
**Warning signs:** A backend payload field rename breaks the FE at runtime, not compile time.

## Common Code patterns (verified field names)

### Reading current round + history (TanStack Query, Bearer)
```ts
// Source: Kong routes (verified kong.yml) + games REST surface
// GET http://localhost:8000/games/rounds/current      (public)
// GET http://localhost:8000/games/rounds/history       (public; FE wants last 20)
// GET http://localhost:8000/games/bets/me               (JwtGuard — needs Bearer)
// GET http://localhost:8000/wallets/me                  (JwtGuard — needs Bearer; balance.amount is cents string)
// POST http://localhost:8000/games/bet                  → 202 { betId, status:'PENDING', roundId }
// POST http://localhost:8000/games/bet/cashout          → 200 { multiplier, payoutCents, cashedOutAt } | 409
```

### Live payout label (UI-SPEC copy: "Cash Out {m}x · {payout}")
```ts
import { Money } from '@crash/shared-kernel'
const stake = Money.fromSnapshot(myBet.amount)             // amount came as MoneySnapshot over WS
const payout = stake.multiplyRounded(renderedMultiplier, 'bankers')
const label = `Cash Out ${renderedMultiplier.toFixed(2)}x · ${formatMoney(payout)}`  // formatMoney built on toSnapshot()
```

## Runtime State Inventory

> N/A — this is a **greenfield** phase (scaffolding an empty workspace slot). No rename/refactor/migration. No stored data, live-service config, OS-registered state, secrets, or build artifacts carry an old identifier to migrate. **None — verified: `frontend/` contains only `.gitkeep` + a stub `package.json`.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `createReactOidc` + `createOidc` pointing at the same issuer/client share session/storage cleanly so the React app and the socket singleton see the same token. | Pattern 7/8 | If they don't share, the socket may get a stale/different token; mitigated by reading via `getTokens()` per connect. Verify in Wave-0 auth spike. |
| A2 | `oidc.getTokens()` returns `{ accessToken, ... }` and auto-refreshes near expiry. | Pattern 7/8 | Docs confirm destructuring `accessToken` and auto-refresh, but exact Tokens shape (refreshToken/expiry fields) not fully documented — confirm against TS types after install. |
| A3 | TanStack Start dev server default port is 3000 (matches realm redirectUris). | Pattern 1 | If a different port, OIDC redirect fails with `invalid redirect_uri`. Pin `server.port: 3000` explicitly (done in snippet). |
| A4 | EWMA alpha default value (e.g. ~0.1) — must be env/config-driven per CONTEXT discretion. | Open Q 3 | Wrong alpha → curve too jittery (high) or too laggy (low). Defaulted env, tuned during build. |
| A5 | shadcn CLI v4 `init` works against a Bun + TanStack Start + Tailwind v4 project leaving the tailwind config blank in `components.json`. | §shadcn | If the CLI lacks a clean TanStack Start path, fall back to manual component install (STACK.md compat note). |
| A6 | History color thresholds (`VITE_HISTORY_RED_MAX_X=1.5`, `VITE_HISTORY_YELLOW_MAX_X=2.0`) are FE-only env (no backend equivalent). | §Open Configuration Values | Low — UI-SPEC already specifies these as new FE env vars. |

## Open Questions (RESOLVED)

1. **Do `createReactOidc` (react-spa) and `createOidc` (core) share one session?**
   - What we know: docs show both patterns; the core promise pattern is the documented non-React accessor.
   - What's unclear: whether instantiating both against the same issuer/client double-initializes or shares storage.
   - Recommendation: Wave-0 auth spike — verify token parity; if they conflict, export a single `getOidc()` from the react-spa instance instead of a second `createOidc`.
   - **RESOLVED:** gated by the 07-02 Wave-0 spike checkpoint (`autonomous:false`, blocking) before the 07-03 scaffold — the spike ratifies single-vs-dual instance and the 07-04 socket accessor consumes that decision. No work proceeds on an unverified assumption.

2. **SPA mode vs selective `ssr:false` — which boots on Bun 1.3.11 + Vite 8?**
   - What we know: #5171 reports SPA-mode hang on Bun + Vite 7/8.
   - What's unclear: whether the pinned versions are affected or already fixed (PR #5262).
   - Recommendation: Wave-0 spike both; default to selective `ssr:false` if SPA mode hangs.
   - **RESOLVED:** gated by the same 07-02 Wave-0 spike checkpoint; the boot-mode decision is recorded in `frontend/spike/SPIKE-NOTES.md` and consumed by the 07-03 scaffold (`vite.config.ts`). Default to selective `ssr:false` if SPA mode hangs.

3. **Promote WS payload schemas to `@crash/contracts`?**
   - What we know: schemas + types live in `services/games` only; FE needs them.
   - What's unclear: appetite for touching a shared package vs re-declaring in FE.
   - Recommendation: promote to `@crash/contracts/ws` (one new subpath export) — eliminates contract drift; small, additive change. Also surface the EWMA alpha + history-threshold + bet-bound env defaults during planning.
   - **RESOLVED:** resolved-into-task by 07-01 (promote schemas to `@crash/contracts/ws`, re-export from `services/games`); env defaults surfaced via the 07-03 typed config module.

4. **Kong CORS — global plugin or per-route?**
   - What we know: no CORS plugin exists; browser REST will fail without it.
   - What's unclear: preferred scope.
   - Recommendation: add a global Kong `cors` plugin allowing `http://localhost:3000`, credentials, the FE's methods/headers; document in the FE bring-up. Plan must include this infra task.
   - **RESOLVED:** resolved-into-task by 07-01 (scoped CORS plugin allowing the SPA origin with credentials, not `*`); 07-02 spike verifies a real browser fetch from :3000 reaches a REST route.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Workspace runtime + FE deps/scripts | ✓ | 1.3.11 | — |
| Node | (some tooling) | ✓ | v24.14.1 | Bun covers most |
| Keycloak (realm `crash-game`, client `crash-game-client`, PKCE S256, redirect :3000/:8080) | REQ-AUTH-01/02/03 | ✓ (via `docker:up`) | 26.5.5 | none — blocking; realm already configured for :3000 |
| Kong gateway (REST :8000, WS /ws→:4101) | All FE↔backend traffic | ✓ (via `docker:up`) | 3.9.1 | none — blocking |
| Kong CORS plugin | Browser REST from :3000 | ✗ NOT configured | — | **Must add (Pitfall 2)** — blocking for REST |
| games-service WS + REST | Live game data | ✓ (Phase 6 complete) | — | none |
| wallets-service REST (`/wallets/me`) | Balance | ✓ (Phase 3) | — | none |
| `@crash/contracts` / `@crash/shared-kernel` | Formula + Money VO | ✓ (workspace, TS source) | 0.0.1 | none — import directly |
| Fira Code / Fira Sans fonts | Typography (UI-SPEC) | ✗ (not vendored) | — | self-host via `@fontsource` or include in `public/`; pick maintained source |

**Missing dependencies with no fallback:**
- **Kong CORS plugin** — REST from the browser is blocked until added (infra task in the plan).

**Missing dependencies with fallback:**
- **Fira Code / Fira Sans** — add via `@fontsource/fira-code` + `@fontsource/fira-sans` (verify on install) or self-host woff2 in `public/`.

## Validation Architecture

> `workflow.nyquist_validation: true` in config.json — section included. The `frontend/` workspace has **no test infrastructure yet** (empty slot), so Wave 0 must establish it.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **Vitest** (`vitest` + `@testing-library/react` + `jsdom`) for unit/component; **Playwright** `1.49+` for E2E (already the project's locked browser-E2E tool per STACK.md; full Playwright flow is REQ-TEST-05 in Phase 10) |
| Config file | none — Wave 0 creates `frontend/vitest.config.ts` |
| Quick run command | `cd frontend && bun run test` (vitest run, single file) |
| Full suite command | `cd frontend && bun run test` (all vitest) + project `bun run typecheck` + `bun run lint` |

> Rationale for Vitest over `bun:test` here: the FE needs jsdom + React Testing Library + Vite's transform pipeline (Tailwind, `@/*` alias, workspace TS) — Vitest reuses the Vite config natively. Backend stays on `bun:test`; the FE is the one place Vitest earns its keep. (Flag to planner: this is the first Vitest in the repo — confirm acceptable, otherwise pure-logic helpers like `validate-bet-amount`, EWMA reducer, and `multiplierAt` consumption can run under `bun:test`.)

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-FE-03 | EWMA offset reducer converges, never snaps; `multiplierAt` anchor math | unit | `vitest run src/features/game/ewma.test.ts` | ❌ Wave 0 |
| REQ-FE-04 | Bet input rejects negative / scientific / >2dp / out-of-bounds; accepts valid | unit | `vitest run src/features/bet/validate-bet-amount.test.ts` | ❌ Wave 0 |
| REQ-FE-05 | Live payout = `stake.multiplyRounded(m)` matches Money math | unit | `vitest run src/features/bet/payout.test.ts` | ❌ Wave 0 |
| REQ-FE-07/08 | WS event → correct Zustand slice; feed circular buffer cap; history prepend on crash | unit | `vitest run src/stores/*.test.ts` | ❌ Wave 0 |
| REQ-FE-13 | Toast dedupe by id; skeleton renders on loading state | component | `vitest run src/features/**/*.test.tsx` | ❌ Wave 0 |
| REQ-AUTH-01 | Unauth route redirects (guard invoked) | component | `vitest run src/auth/*.test.tsx` (mock oidc) | ❌ Wave 0 |
| REQ-FE-02/14 | Canvas draws (smoke), crash freeze value | component (jsdom canvas stub) / manual | manual + `vitest` smoke | ❌ Wave 0 |
| Full player loop (login→bet→cashout / crash) | E2E | Playwright (Phase 10 REQ-TEST-05) | deferred to Phase 10 | ❌ Phase 10 |

### Sampling Rate
- **Per task commit:** `cd frontend && bun run test` (changed-area vitest) + `bun run typecheck`
- **Per wave merge:** full `frontend` vitest + `bun run lint` (with the `.tsx` money-rule glob fix from Pitfall 7) + `bun run typecheck`
- **Phase gate:** full vitest green + typecheck + lint clean before `/gsd:verify-work`; live manual smoke against `docker:up` (login → bet → watch curve → cashout → balance update).

### Wave 0 Gaps
- [ ] `frontend/vitest.config.ts` — reuses Vite config (alias, workspace TS transpile)
- [ ] `frontend/src/test/setup.ts` — jsdom + Testing Library + canvas stub + `matchMedia` mock (for reduced-motion)
- [ ] `frontend/tsconfig.json` — self-contained (no root tsconfig exists — Pitfall 8)
- [ ] Framework install: `bun add -d vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react`
- [ ] eslint: extend `**/*.tsx` into the `@crash/no-number-for-money` glob (Pitfall 7)
- [ ] Wave-0 spikes (non-test but gating): SPA-vs-SSR boot spike (Pitfall 1), OIDC two-instance/token-parity + two-tab spike (Open Q 1, Pitfall 5), workspace-TS-import + dinero/bigint resolution spike (Pitfall 8), Kong CORS reachability (Pitfall 2)

## Security Domain

> `security_enforcement` not set to `false` in config.json → included. This is a security-relevant phase (browser-side auth, token handling, money mutations).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | oidc-spa Authorization Code + PKCE (S256) against Keycloak; no implicit flow; no client secret (public client). |
| V3 Session Management | yes | oidc-spa token storage + silent renew + BroadcastChannel; tokens in memory, not persisted to a readable cookie; backend handshake-only JWT validation. |
| V4 Access Control | yes | Route guard (`beforeLoadFn`) client-side; **server is authoritative** — FE guard is UX only, never a security boundary (backend validates every REST/WS call). |
| V5 Input Validation | yes | zod for WS payloads + env; bet input regex (no scientific/negative/>2dp) + `Money` VO bounds; **server re-validates all bets** (defense in depth). |
| V6 Cryptography | no (this phase) | No in-browser crypto here — `crypto.subtle` provably-fair verification is Phase 8. Do not hand-roll any crypto in P7. |
| V7 Errors/Logging | partial | Deduped error toasts; never log tokens; no token in console/network logs. |

### Known Threat Patterns for {browser SPA + OIDC + WS + money}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token exfiltration via XSS | Information Disclosure | React auto-escaping; no `dangerouslySetInnerHTML`; CSP later (Phase 10); tokens in memory via oidc-spa, not localStorage where feasible. |
| Open redirect on OIDC callback | Tampering | Keycloak `redirectUris` whitelist (only :3000/:8080) — already locked; do not widen. |
| Client trusting local cashout time | Tampering / Repudiation | Cashout is server-authoritative (ADR-023, `cashoutAcceptedAt`); FE never decides win/loss — it sends the request and renders the server's 200/409. |
| Client-supplied money amount manipulation | Tampering | Backend re-validates bounds + balance; FE validation is UX only. Never trust FE-computed payout — display only. |
| Cross-tab token refresh storm / desync | DoS / Repudiation | oidc-spa BroadcastChannel single-rotation (REQ-AUTH-03); do not add a second refresh path. |
| CORS misconfig (over-permissive) | Spoofing | When adding the Kong CORS plugin (Pitfall 2), scope to `http://localhost:3000` with explicit methods/headers — not `*` with credentials. |

## Sources

### Primary (HIGH confidence)
- Codebase (read this session): `frontend/package.json` (empty stub), root `package.json` (Bun 1.3.11 workspaces incl. `frontend`), `packages/contracts/src/provably-fair/multiplier.ts` (`multiplierAt`/`crashTimeMs`), `packages/contracts/src/provably-fair/formulas.constants.ts` (`FORMULA_VERSION`), `packages/shared-kernel/src/money/money.ts` (full `Money` API), `packages/contracts/src/money/snapshot.ts` (`moneySnapshotSchema`), `services/games/src/presentation/dtos/ws-event.payloads.ts` (full WS payload zod schemas + field names), `services/games/src/application/multiplier-broadcast.service.ts` (tick payload `{roundId, multiplier, t}`), `services/games/src/application/use-cases/get-ws-snapshot.use-case.ts` (snapshot shape), `docker/kong/kong.yml` (routes, no CORS), `docker/keycloak/realm-export.json` (PKCE S256, redirectUris :3000/:8080, accessTokenLifespan 3600, publicClient), `eslint.config.js` (money rule `**/*.ts` only), `.env.example` (GROWTH_RATE etc.), `.planning/config.json`.
- npm registry (`npm view` this session): all 13 FE package versions + repos + downloads + postinstall.
- TanStack Start docs — build-from-scratch (vite.config, router, routes), SPA-mode guide (`spa:{enabled:true}` config). [CITED: tanstack.com/start/latest/docs/framework/react]
- oidc-spa docs — TanStack Router/Start integration guide + `llms-full.txt` (`createReactOidc`/`createOidc`, `useOidc`, `beforeLoadFn`, `getTokens`/`getAccessToken`, auto silent renew, BroadcastChannel). [CITED: docs.oidc-spa.dev]
- shadcn/ui — TanStack Start install + Tailwind v4 (leave tailwind config blank in components.json). [CITED: ui.shadcn.com/docs/installation/tanstack, /docs/tailwind-v4]
- Socket.IO client docs/options — auth function form re-invoked on (re)connect. [CITED: socket.io/docs/v4/client-options]
- 07-UI-SPEC.md (approved design contract) + 07-CONTEXT.md (locked decisions) + STACK.md + ARCHITECTURE.md §12 (FE) + CLAUDE.md §Frontend/§Money.

### Secondary (MEDIUM confidence)
- TanStack/router#5171 — SPA mode hang on Bun + Vite 7/8 (workaround: remove `spa` config; PR #5262 referenced). [CITED: github.com/TanStack/router/issues/5171]
- socketio/socket.io discussions #4936 / #3902 — reconnect with new JWT via auth function. [CITED: github.com/socketio/socket.io/discussions]
- Gabriel Gambetta entity-interpolation (EWMA reconciliation canon — referenced in ARCHITECTURE.md §8).

### Tertiary (LOW confidence)
- Exact `Tokens` object field set from `getTokens()` (A2) — confirm against installed TS types.
- shadcn CLI v4 clean path under Bun+TanStack+Tailwind v4 (A5) — confirm at init.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified on npm registry this session; peer ranges checked (TanStack Start `vite>=7`, Tailwind plugin `^8`).
- Architecture / patterns: HIGH — oidc-spa API, socket.io auth function, TanStack SPA mode, Canvas/EWMA all from official docs + verified codebase field names.
- Pitfalls: HIGH for the codebase-verified ones (no CORS, eslint `.tsx` gap, TS-source workspace export, 3600s token, port 3000, WS schemas not in contracts); MEDIUM for the upstream SPA-mode hang (single authoritative issue, version-fix status unconfirmed → Wave-0 spike required).

**Research date:** 2026-05-28
**Valid until:** 2026-06-11 (14 days — fast-moving FE ecosystem: TanStack Start, Vite 8, oidc-spa, Tailwind v4 all release frequently; re-verify SPA-mode bug status and any minor bumps before execution if older).
