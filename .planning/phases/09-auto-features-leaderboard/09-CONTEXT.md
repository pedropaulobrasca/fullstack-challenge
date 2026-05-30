# Phase 9: Auto Features & Leaderboard - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Server-enforced auto-cashout target + server-driven auto-bet strategies (`fixed`, `martingale`) with stop-loss / stop-win guardrails + a 24h-rolling top-10 leaderboard fed by a CQRS projector consuming `game.events` and surfaced live via a `leaderboard:updated` WS event. Delivers REQ-AUTO-01..05 + REQ-LEAD-01..04.

In scope: backend per-bet `autoCashoutTarget`, round-loop tick handler that issues server-authoritative cashout when `multiplier >= target`, auto-bet driver (per-session client config that POSTs a new bet each BETTING window with the configured strategy + stop guardrails), leaderboard projector consuming `game.events` into a `leaderboard_24h` denormalized table, `GET /games/leaderboard?window=24h` endpoint, `leaderboard:updated` WS event throttled to round-settle boundaries, FE Auto tab in the bet panel (per-session Zustand store, NO persistence), FE Leaderboard panel as a tab in the existing right rail alongside the Live Feed.

Out of scope (Phase 10): CI / Playwright E2E suite for the LIVE loop (the disconnect-safety E2E test required by SC1 IS in this phase because it asserts server-authoritative auto-cashout); observability stack; full quality hardening pass.

</domain>

<decisions>
## Implementation Decisions

### Auto-bet stops scope
- **D-01:** Stop-loss / stop-win thresholds are **cumulative since the auto-bet Start click** (per-session, reset on every Start). Simple, predictable, matches the Start/Stop toggle UX. Server enforces nothing here — stops live in the FE auto-bet driver (each round the FE computes session P/L from `bet:my_cashed_out` + `bet:my_refunded` payouts vs the placed amounts; if P/L >= STOP_WIN_CENTS or P/L <= -STOP_LOSS_CENTS, the driver halts and POSTs no further bets). Backend stays stateless on stops.

### Leaderboard placement
- **D-02:** Right rail becomes a **tabbed component** with two tabs: `Live Feed` (existing) and `Leaderboard` (new). Same width, same height, same dark-casino tokens. No layout breakage to the D-01 Phase 7 grid; mobile stays stacked column with the tabbed component preserved.

### Auto tab UX
- **D-03:** Bet panel becomes **tabbed**: `Manual` (existing) + `Auto`. Auto tab exposes: target multiplier (number input, validated against `min/max`), strategy radio (`fixed | martingale`), base bet amount (Money VO validation), stop-loss CRD input, stop-win CRD input, `Start / Stop` toggle. When auto-bet is running, the Manual tab is disabled (visual indicator) so the player can't accidentally place a manual bet mid-strategy. Configuration is per-session Zustand store, **explicitly not persisted** (REQ-AUTO-04).

### Leaderboard live update frequency
- **D-04:** `leaderboard:updated` WS event emits **throttled to the round-settle boundary** (i.e. when the projector finishes processing `round:settled` and the top-10 ranks have actually shifted). Avoids per-tick flooding while still feeling live (one update per round). Client refetches the top-10 (or accepts the payload inline) when the event arrives.

### CQRS contract
- **D-05:** Light CQRS — write model = existing mutable Postgres (rounds, bets), read model = new `leaderboard_24h` denormalized table populated by a projector that subscribes to `game.events` via the existing `@crash/messaging-spine` Inbox pattern (Phase 2/5). Projector failure MUST NOT block the write path: the projector reads from RabbitMQ in its own consumer with idempotent updates; if it crashes, bets still settle, the leaderboard goes stale until the projector recovers (proven by the SC5 chaos test — kill projector + confirm bets still settle).

### Auto-cashout enforcement
- **D-06:** Server-enforced. The round-loop tick handler (Phase 4 `RoundLoopService` / `MultiplierBroadcastService`) checks each tick's multiplier against every ACTIVE bet's `autoCashoutTarget`; when crossed, the server issues the cashout exactly the same way a manual `POST /games/bet/cashout` would (same `cashoutAcceptedAt` server-authoritative stamp, same Money math, same saga). E2E test (SC1) drops the WS client at 1.5x with target 2.0x and asserts the bet still cashes at 2.0x. The `autoCashoutTarget` is added to the `PlaceBetRequestDto` as an optional field; existing manual flow keeps working unchanged.

### Claude's discretion
- Exact tab component (shadcn tabs vs ToggleGroup acting as tabs), tab transition timing, leaderboard chip styling, rank-up animation if any (must be reduced-motion gated and stay within the 4-juice budget — leaderboard rank-up does NOT add a new juice moment, just a subtle border or a chip transition), projector idempotency strategy (event-id-keyed inbox row vs a (roundId, betId) natural key), exact env tunables (cooldown for the throttled emit, leaderboard size, window).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` §"Phase 9: Auto Features & Leaderboard" — goal, 5 success criteria, anticipated ADRs (numbering reconciled to ADR-032+ during planning — 001..031 already taken)
- `.planning/REQUIREMENTS.md` — REQ-AUTO-01..05 + REQ-LEAD-01..04 + "Open Configuration Values" (STOP_LOSS_CENTS, STOP_WIN_CENTS, leaderboard window/size env defaults)

### Backend — write side, saga, round loop
- `services/games/src/application/round-loop.service.ts` — tick path where auto-cashout MUST hook in
- `services/games/src/application/multiplier-broadcast.service.ts` — the 30Hz tick source; MultiplierBroadcastService should NOT do the auto-cashout check (single responsibility — keep WS broadcast lean); auto-cashout check belongs in the round loop's tick step or a dedicated AutoCashoutService listening to a per-tick domain event
- `services/games/src/application/use-cases/cash-out.use-case.ts` — exact code path the auto-cashout must invoke (server-authoritative `cashoutAcceptedAt` per ADR-023)
- `services/games/src/presentation/dtos/place-bet.request.dto.ts` — add optional `autoCashoutTarget`
- `services/games/src/domain/bet.aggregate.ts` (or equivalent) — `autoCashoutTarget` field on the Bet aggregate
- `packages/messaging-spine/` — Inbox pattern + RabbitMQ consumer the leaderboard projector reuses
- `.planning/adrs/ADR-023-server-authoritative-cashout.md` — the trust boundary the auto-cashout MUST honor

### Backend — leaderboard read side
- `services/games/src/infrastructure/persistence/` — where to add a `leaderboard_24h` MikroORM entity + migration (idempotent denormalized table, indexed on net_profit DESC + window timestamp)
- `services/games/src/application/leaderboard-projector.service.ts` — new service (or wherever fits the existing structure) that consumes `game.events` and updates the denormalized table
- `services/games/src/presentation/controllers/` — new `LeaderboardController` (GET /games/leaderboard?window=24h)
- `services/games/src/presentation/gateways/game-ws.gateway.ts` — add `leaderboard:updated` @OnEvent emitter (mirrors round:settled fan-out — locked by the Phase 6 raw-SQL-timestamp fix)

### Frontend — Auto tab + leaderboard
- `frontend/src/components/bet-panel.tsx` — refactor into tabs (Manual | Auto)
- `frontend/src/features/auto-bet/auto-bet.store.ts` (new) — per-session Zustand slice
- `frontend/src/features/auto-bet/auto-bet-driver.ts` (new) — listens to round:settled/bet:my_cashed_out/bet:my_refunded and POSTs the next bet per strategy; stops on threshold
- `frontend/src/components/live-feed.tsx` — refactor right rail to tabbed (Live Feed | Leaderboard)
- `frontend/src/components/leaderboard-panel.tsx` (new)
- `frontend/src/features/leaderboard/` (new) — TanStack Query hook + WS subscription
- `.planning/adrs/ADR-021-single-global-lobby.md` — leaderboard:updated emits to lobby

### Stack + standards
- `.planning/research/STACK.md` + `.planning/research/ARCHITECTURE.md` (CQRS / saga / outbox sections)
- `CLAUDE.md` §Money + §Frontend — Money VO never `number` for stops/stake/payouts; no hardcoded business constants (stops, leaderboard window, throttle period — all via env)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Round loop tick + cashout use-case** (Phase 4 + Phase 5) — auto-cashout is a thin trigger that invokes the EXISTING `CashOutUseCase` with a server-stamped `cashoutAcceptedAt`. No new cashout math.
- **Messaging spine** — Inbox pattern + RabbitMQ consumer ergonomics already established. Projector is a new consumer in the same pattern.
- **WS gateway lifecycle @OnEvent handlers** (Phase 6 — raw-SQL-timestamp fix `439e5b4`) — `leaderboard:updated` plugs in identically. ALL timestamps from raw SQL hydration MUST go through the Phase 6 `toDate()` coercion in the projector (the same defect bit Phase 6 hard).
- **Bet panel + LiveFeed components** (Phase 7) — refactor to tabbed in-place; shadcn `Tabs` already in the install set.
- **Money VO** for stops/stake/profit calculations.

### Established Patterns
- One aggregate per transaction (Bet write + leaderboard projection are SEPARATE consumers — the projector is eventually consistent by design).
- Domain events carry `{messageId, correlationId, causationId, type, version, occurredAt, payload}`; projector dedupes via Inbox.
- Money is bigint cents on the wire (`MoneySnapshot { amount, currency, scale }`); never `number`.

### Integration Points
- `PlaceBetRequestDto.autoCashoutTarget?: number` (multiplier) — additive, optional; backwards compatible. Money's `multiplyRounded(target)` on the bet amount drives payout server-side.
- Projector subscribes to `game.events` (the same exchange Phase 5/6 already publish to). New queue `leaderboard-projector` with quorum + DLX following the existing pattern.
- New env vars (all flow through service `defaults.ts` / FE `getConfig()`): `LEADERBOARD_WINDOW_HOURS` (default 24), `LEADERBOARD_SIZE` (default 10), `LEADERBOARD_UPDATE_THROTTLE_MS` (default — confirm during planning, the goal is one update per round-settle), `STOP_LOSS_CENTS` / `STOP_WIN_CENTS` default ceilings (the FE inputs accept any value within these limits), `VITE_AUTO_BET_MIN_TARGET`/`VITE_AUTO_BET_MAX_TARGET` (target multiplier bounds).
- Kong: no new routes — leaderboard reuses the existing `/games/*` upstream.

</code_context>

<specifics>
## Specific Ideas

- SC1 disconnect-safety E2E is the centerpiece test of this phase: drops the WS client at multiplier=1.5x with target=2.0x, then queries `GET /games/bets/me` to confirm the bet settled at 2.0x. Must run against the real docker stack as part of the phase verify (Playwright LIVE-loop E2E itself is deferred to Phase 10, but THIS specific disconnect test is the proof of SC1's "server-enforced" claim).
- Leaderboard chip masking matches the Phase 6 mask pattern (`playerIdMasked` — first 8 chars or similar — already established for the lobby feed).
- Rank-up: a subtle border highlight + 200ms transition on a chip whose rank improved, reduced-motion gated; explicitly NOT a new juice moment.
- Martingale base: REQ says "reset to base after each win" — base is the configured initial bet, NOT the last bet. Re-confirm in plan acceptance.

</specifics>

<deferred>
## Deferred Ideas

- All-time leaderboard / weekly leaderboard windows — env-tunable so easy later, but only the 24h window ships in v1.
- Auto-bet strategy: Fibonacci, D'Alembert — out of scope; v1 ships only `fixed` + `martingale` per REQ-AUTO-02.
- Server-side stops (cumulative across browser sessions / device-bound) — flagged in D-01 as out-of-scope; v1 is FE-driven per-Start scope only.
- Persisting auto-bet config across reloads — REQ-AUTO-04 explicitly says no.
- Leaderboard rank-up celebration (confetti / tier-up animation) — out of the 4-juice budget; flagged.

</deferred>

---

*Phase: 9-Auto Features & Leaderboard*
*Context gathered: 2026-05-30*
