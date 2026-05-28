# Phase 7: Frontend Vertical Slice - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

A logged-in player completes the full Crash loop in a polished dark-casino UI: redirected to Keycloak when unauthenticated, logs in, bets during the BETTING window, watches the multiplier climb on a smooth 60fps Canvas curve, cashes out (or loses on crash), sees balance update, and reads the live bet/cashout feed plus a last-20 history strip — fully responsive on desktop and mobile.

Delivers REQ-FE-01..08, REQ-FE-11..14, and REQ-AUTH-01/02/03. Provably-fair UX (REQ-FE-09/10 badge + `/verify` route) and replay are Phase 8 — out of scope here even though the verify endpoint already exists backend-side.

</domain>

<decisions>
## Implementation Decisions

### Layout
- **D-01:** Center-stage Canvas curve with side rails (Stake/Aviator pattern). Left rail = bet panel + cashout button; right rail = live feed; history strip across the top. Collapses to a single stacked column on mobile (curve → controls → feed → history).

### Visual identity
- **D-02:** Dark casino base (deep blacks) with **emerald/cyan neon** accent for the rising multiplier and cashout wins; **red reserved exclusively for crash** state. High contrast on black.
- **D-03:** Source the visual system via the **ui-ux-pro MCP first** — pull design-system tokens, real-time/casino UI component patterns, and references to ground the UI-SPEC, then theme shadcn/ui on top. (Mandatory per the project's frontend workflow rule; also use impeccable / taste / emil-design skills during build.)

### Animation / juice
- **D-04:** Tasteful, restrained polish: balance counter-up, subtle cashout glow + small confetti burst, crash = red flash + brief freeze overlay. No screen shake, no heavy particle storms. Senior-polished, not arcade-loud.

### Multiplier rendering (carried from ADR-022, reaffirmed)
- **D-05:** Client computes the multiplier locally each frame via `e^(GROWTH_RATE * t / 1000)` anchored to `roundStartedAt` from the WS snapshot; reconciles toward server `round:tick` via EWMA clock-offset tween — never snap. Canvas 2D only (rAF + devicePixelRatio + clearRect).

### State management (carried from ADR-021, reaffirmed)
- **D-06:** Zustand slice-per-concern; the multiplier rAF loop lives in its own isolated store so the high-frequency tick does not re-render the bet panel / feed / history components.

### Claude's Discretion
- Exact shadcn component set, Tailwind v4 theme token names, file/route tree under `frontend/`, EWMA alpha constant (must be env/config-driven, not hardcoded — confirm value during planning), confetti library choice, skeleton component composition.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` §"Phase 7: Frontend Vertical Slice" — goal, 5 success criteria, anticipated ADR-019..022
- `.planning/REQUIREMENTS.md` — REQ-FE-01..08, REQ-FE-11..14, REQ-AUTH-01/02/03 (full text + config defaults; "Open Configuration Values" for env list incl. history color thresholds, GROWTH_RATE, BETTING window)

### Real-time + fairness contract (FE must mirror server)
- `.planning/adrs/ADR-022-30hz-tick-60fps-interpolation.md` — 30Hz server tick / 60fps client interpolation contract the curve renderer must honor
- `.planning/adrs/ADR-021-single-global-lobby.md` — single `lobby` room + `user:{playerId}` room topology the WS client joins
- `.planning/adrs/ADR-023-server-authoritative-cashout.md` — cashout is server-authoritative; client never trusts local time for the cashout decision
- `packages/contracts/` — shared crash formula + FORMULA_VERSION + provably-fair derivation (FE imports the same package for local multiplier compute)
- `.planning/research/ARCHITECTURE.md` §WebSocket — event catalog the client subscribes to

### Stack + standards
- `.planning/research/STACK.md` — locked FE versions (TanStack Start 1.x, Vite, Tailwind v4, shadcn CLI v4, Zustand 5, TanStack Query 5, oidc-spa)
- `CLAUDE.md` §Frontend + §Money — Canvas discipline, Money VO on the wire (never `number`), BroadcastChannel multi-tab refresh

### Money VO (shared)
- `packages/shared-kernel/` — Money value object the bet input must use for min/max validation and display formatting

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Backend REST already complete** — `GET /games/rounds/current`, `GET /games/rounds/history`, `GET /games/rounds/:roundId/verify`, `GET /games/bets/me`, `POST /games/bet` (202), `POST /games/bet/cashout` (200). Wallets exposes balance. No new backend endpoints needed for this phase.
- **WS surface complete (Phase 6)** — `round:snapshot` (on connect/reconnect), `round:started|running|crashed|settled`, `round:tick` (30Hz volatile), `bet:placed|cashed_out` (lobby masked), `bet:my_active|my_refunded|my_cashed_out` (user room). FE consumes via Socket.IO client through Kong at `localhost:8000/ws`.
- **`packages/contracts`** — crash formula, FORMULA_VERSION, hash-chain derivation: import directly so the FE multiplier math is byte-identical to the server.
- **`packages/shared-kernel`** — Money VO for bet validation/formatting.

### Established Patterns
- All money is bigint cents wrapped in Money VO — wire format too. The bet input and payout display MUST NOT use `number`. ESLint money rule applies to FE code.
- Kong gateway is the single ingress: REST at `localhost:8000/games/*` + `/wallets/*`, WS at `localhost:8000/ws`. Keycloak realm `crash-game`, client `crash-game-client`, demo user `player/player123`.

### Integration Points
- **OIDC**: oidc-spa Authorization Code + PKCE (S256) against Keycloak; route guard redirects unauthenticated users; silent renewal before expiry; `BroadcastChannel` coordinates refresh across tabs (single rotation, ADR-022 anticipated for FE).
- **WS auth**: Socket.IO handshake passes the access token in `auth.token` (matches Phase 6 `JwtIoAdapter` middleware). On token refresh the client must re-handshake / re-auth.
- **`frontend/` workspace slot exists** in root `package.json` workspaces but the directory is empty — this phase scaffolds it (REQ-FE-01).

</code_context>

<specifics>
## Specific Ideas

- Aesthetic reference: Stake / Aviator-class crash UI — center curve, side rails, neon-on-black, but restrained polish (senior, not gaudy).
- Emerald/cyan = win/rising; red = crash only (semantic color discipline).
- History strip color-coding thresholds come from env (red ≤ 1.5x, yellow 1.5–2x, green > 2x) — tunable, not hardcoded.

</specifics>

<deferred>
## Deferred Ideas

- **Provably-fair badge + `/verify/:roundId` route (REQ-FE-09/10)** — Phase 8. Verify endpoint already exists backend-side; FE verification drawer + in-browser `crypto.subtle` algorithm ships in Phase 8 alongside replay.
- **Deterministic replay (REQ-REPLAY-*)** — Phase 8, reuses this phase's Canvas renderer.
- **Auto-bet / auto-cashout + leaderboard UI (REQ-FE auto features)** — Phase 9, extends the bet panel.
- **Multi-bet** — stretch only, not in v1 vertical slice.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 7-Frontend Vertical Slice*
*Context gathered: 2026-05-28*
