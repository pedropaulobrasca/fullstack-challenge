# Phase 9: Auto Features & Leaderboard - Research

**Researched:** 2026-05-30
**Domain:** Server-enforced auto-cashout integration on the 30Hz tick loop + FE-driven auto-bet driver + light-CQRS leaderboard projector consuming `game.events` via the Phase 2 Inbox pattern + WebSocket fan-out throttled to round-settle.
**Confidence:** HIGH (every backend integration point is grounded in shipped Phase 4/5/6 code paths; every leaderboard primitive reuses Phase 2 spine + Phase 6 raw-SQL pitfall is known; FE driver design grounded in Phase 7 Zustand slice-per-concern + WS dispatch already in place).

## Summary

Phase 9 is overwhelmingly an **integration phase**, not a greenfield phase. Every primitive it needs already ships: the round loop tick callback (`RoundLoopService` with a per-tick path through `MultiplierBroadcastService`), the synchronous server-authoritative cashout (`CashOutUseCase` with controller-first-line `acceptedAt`), the messaging spine (`@IdempotentSubscribe` decorator with inbox dedupe + CLS propagation + DLX-with-x-delivery-limit), the `game.events` exchange with `bet.placed`/`bet.cashed_out`/`bet.refunded` already published by Phase 5 sagas, the `GameWsGateway` with `@OnEvent` lobby fan-out, the FE Zustand slice-per-concern architecture with schema-validated WS dispatch + isolated multiplier store (ADR-026), and the typed `getConfig()` env layer. The phase's job is to wire these existing primitives into two new features while honoring the CLAUDE.md non-negotiables (Money VO never `number` for stops/stake/payouts, no hardcoded constants — all stops/window/size/throttle/target bounds via env, no AI attribution).

The **central technical decision** the planner must lock is *where* the per-tick auto-cashout check lives. Three options exist: (a) extend `MultiplierBroadcastService.fireTick()` with the per-bet check inline, (b) introduce a dedicated `AutoCashoutTickService` that subscribes to an in-process `round:tick` event the broadcast service emits, or (c) extend `RoundLoopService` with a per-tick callback. Per CONTEXT canonical-refs guidance — "`MultiplierBroadcastService` should NOT do the auto-cashout check (single responsibility — keep WS broadcast lean); auto-cashout check belongs in the round loop's tick step or a dedicated `AutoCashoutService` listening to a per-tick domain event" — Option (b) is the locked architecture: the broadcast service emits a single in-process `GAME_EVENTS.ROUND_TICK` event per fire (carrying `{ roundId, multiplier, t }` exactly as already passed to `volatile.emit`), and a new `AutoCashoutTickService` `@OnEvent`-listens to it, queries `bets WHERE roundId = ? AND status = 'ACTIVE' AND auto_cashout_target_centi_x IS NOT NULL AND auto_cashout_target_centi_x <= ?`, and for each matching bet invokes the existing `CashOutUseCase` with a fresh server-stamped `acceptedAt = new Date()` (per ADR-023). The DB filter avoids N+1 and avoids loading every active bet into memory.

The **second decision** is the leaderboard projector's read-model schema and update strategy. The locked design is a denormalized `leaderboard_24h` table with composite PK `(player_id)` (single row per player), columns `{ player_id, net_profit_cents BIGINT NOT NULL DEFAULT 0, win_count INT NOT NULL DEFAULT 0, total_bet_count INT NOT NULL DEFAULT 0, last_event_at TIMESTAMPTZ NOT NULL }`, with an index on `(net_profit_cents DESC, player_id)`. Window expiry uses **on-read filtering** (`WHERE last_event_at > NOW() - INTERVAL 'X hours'`) — no cron infra, simplest. The projector consumes `game.events` via a NEW queue `leaderboard-projector.q` (quorum + DLX following the topology-defaults Phase 5 pattern), uses `@IdempotentSubscribe` (inbox dedupe is automatic + free), and applies idempotent UPSERTs per event. Projector crash never blocks writes — sagas have already committed before the projector reads.

**Primary recommendation:** Lock the AutoCashoutTickService-via-in-process-event pattern (single responsibility for the broadcast service, single-aggregate transaction per auto-cashout via existing `CashOutUseCase`); land the `leaderboard_24h` denormalized projection via the existing `@IdempotentSubscribe` spine; throttle `leaderboard:updated` server-side to round-settle (the projector is naturally event-driven by `round.settled`/`bet.cashed_out`/`bet.refunded`, so a top-10 diff check inside the projector is the throttle); ship the FE auto-bet driver as a slice-per-concern Zustand store + a hook subscribed to the existing `round:settled` + `bet:my_cashed_out` + `bet:my_refunded` WS events via the Phase 7 dispatch layer; install only `shadcn radio-group` (every other primitive already in `frontend/src/components/ui/`).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Auto-bet stops scope:** Stop-loss / stop-win thresholds are **cumulative since the auto-bet Start click** (per-session, reset on every Start). Simple, predictable, matches the Start/Stop toggle UX. Server enforces nothing here — stops live in the FE auto-bet driver (each round the FE computes session P/L from `bet:my_cashed_out` + `bet:my_refunded` payouts vs the placed amounts; if P/L >= STOP_WIN_CENTS or P/L <= -STOP_LOSS_CENTS, the driver halts and POSTs no further bets). Backend stays stateless on stops.

**D-02 — Leaderboard placement:** Right rail becomes a **tabbed component** with two tabs: `Live Feed` (existing) and `Leaderboard` (new). Same width, same height, same dark-casino tokens. No layout breakage to the D-01 Phase 7 grid; mobile stays stacked column with the tabbed component preserved.

**D-03 — Auto tab UX:** Bet panel becomes **tabbed**: `Manual` (existing) + `Auto`. Auto tab exposes: target multiplier (number input, validated against `min/max`), strategy radio (`fixed | martingale`), base bet amount (Money VO validation), stop-loss CRD input, stop-win CRD input, `Start / Stop` toggle. When auto-bet is running, the Manual tab is disabled (visual indicator) so the player can't accidentally place a manual bet mid-strategy. Configuration is per-session Zustand store, **explicitly not persisted** (REQ-AUTO-04).

**D-04 — Leaderboard live update frequency:** `leaderboard:updated` WS event emits **throttled to the round-settle boundary** (i.e. when the projector finishes processing `round:settled` and the top-10 ranks have actually shifted). Avoids per-tick flooding while still feeling live (one update per round). Client refetches the top-10 (or accepts the payload inline) when the event arrives.

**D-05 — CQRS contract:** Light CQRS — write model = existing mutable Postgres (rounds, bets), read model = new `leaderboard_24h` denormalized table populated by a projector that subscribes to `game.events` via the existing `@crash/messaging-spine` Inbox pattern (Phase 2/5). Projector failure MUST NOT block the write path: the projector reads from RabbitMQ in its own consumer with idempotent updates; if it crashes, bets still settle, the leaderboard goes stale until the projector recovers (proven by the SC5 chaos test — kill projector + confirm bets still settle).

**D-06 — Auto-cashout enforcement:** Server-enforced. The round-loop tick handler (Phase 4 `RoundLoopService` / `MultiplierBroadcastService`) checks each tick's multiplier against every ACTIVE bet's `autoCashoutTarget`; when crossed, the server issues the cashout exactly the same way a manual `POST /games/bet/cashout` would (same `cashoutAcceptedAt` server-authoritative stamp, same Money math, same saga). E2E test (SC1) drops the WS client at 1.5x with target 2.0x and asserts the bet still cashes at 2.0x. The `autoCashoutTarget` is added to the `PlaceBetRequestDto` as an optional field; existing manual flow keeps working unchanged.

### Claude's Discretion

- Exact tab component (shadcn tabs vs ToggleGroup acting as tabs) — UI-SPEC §Grounding & Provenance locks shadcn `Tabs` for both new tabbed surfaces.
- Tab transition timing — UI-SPEC locks shadcn default content-swap (no slide), reduced-motion no-op.
- Leaderboard chip styling — UI-SPEC § Color locks inherited semantic ramp (no medal-hue fills; rank-1 emerald rail, rank-2 cyan rail, rank-3 muted rail, ranks 4-10 hairline only; own-row always emerald rail).
- Rank-up animation — UI-SPEC locks 200ms `border-color` CSS transition on the rank chip, reduced-motion gated, NOT a juice moment (sub-300ms band).
- Projector idempotency strategy — RESEARCH recommends `@IdempotentSubscribe` (inbox dedupe by `messageId` is free + battle-tested in Phase 5).
- Exact env tunables (throttle, leaderboard size, window) — RESEARCH recommends defaults below; planner confirms in PLAN.md.

### Deferred Ideas (OUT OF SCOPE)

- All-time leaderboard / weekly leaderboard windows — env-tunable so easy later, but only the 24h window ships in v1.
- Auto-bet strategy: Fibonacci, D'Alembert — out of scope; v1 ships only `fixed` + `martingale` per REQ-AUTO-02.
- Server-side stops (cumulative across browser sessions / device-bound) — flagged in D-01 as out-of-scope; v1 is FE-driven per-Start scope only.
- Persisting auto-bet config across reloads — REQ-AUTO-04 explicitly says no.
- Leaderboard rank-up celebration (confetti / tier-up animation) — out of the 4-juice budget; flagged.
- Player-contributed seeds — Phase 9 does NOT alter the Phase 4 deterministic `deriveClientSeed(prev.id, prev.crashedAt)` contract.
- Phase 10 quality / Playwright LIVE-loop E2E, observability, full CI — out of Phase 9.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-AUTO-01 | Player can set an auto-cashout target multiplier; server enforces it (server compares each tick's multiplier to the target; auto-issues cashout when reached). Server-enforced so disconnects don't cost the player. | § "Auto-Cashout Integration Point" — locked Option B (in-process `GAME_EVENTS.ROUND_TICK` event from `MultiplierBroadcastService.fireTick()` → new `AutoCashoutTickService` `@OnEvent` listener → DB-filtered query for matching ACTIVE bets → invoke `CashOutUseCase` with fresh `acceptedAt = new Date()` per ADR-023). § "autoCashoutTarget Field" — `PlaceBetRequestDto` gains optional `autoCashoutTarget` (number, multiplier coefficient), `Bet` aggregate gains `autoCashoutTarget: Multiplier \| null`, migration adds `auto_cashout_target_centi_x INT NULL` + index `(round_id, status, auto_cashout_target_centi_x) WHERE status = 'ACTIVE' AND auto_cashout_target_centi_x IS NOT NULL`. SC1 disconnect E2E test design in § "Disconnect-Safety E2E (SC1)". |
| REQ-AUTO-02 | Player can configure auto-bet with strategy `fixed` (same amount every round) or `martingale` (double on loss, reset on win). | § "FE Auto-Bet Driver" — pure-function `nextBetAmount(strategy, baseAmount, lastOutcome)` in `frontend/src/features/auto-bet/strategy.ts`; the driver hook subscribes to `round:settled` + `bet:my_cashed_out` + `bet:my_refunded`, accumulates session outcome via Money VO arithmetic, and POSTs the next bet at the next BETTING window. Martingale base = the **configured initial bet**, NOT the previous bet (CONTEXT §Specifics + REQ-AUTO-02 wording). |
| REQ-AUTO-03 | Player can configure stop-loss / stop-win thresholds; auto-bet halts when either is breached. | § "FE Auto-Bet Driver" — cumulative-since-Start P/L (Money VO bigint cents) compared each round-settle against stop bounds; on breach the driver halts + a single amber `dedupedToast` fires (UI-SPEC Copywriting Contract). Stops are FE-only per D-01; server stays stateless. Server-side ceilings `STOP_LOSS_CENTS_MAX` / `STOP_WIN_CENTS_MAX` (input validation upper bounds, not enforcement) live in `gamesEnvSchema`. |
| REQ-AUTO-04 | Auto-bet configuration is per-session (client-side store) — does not survive page reload by default (UX explicit choice). | § "FE Auto-Bet Driver" — Zustand store at `frontend/src/features/auto-bet/auto-bet.store.ts` with **NO persist middleware** (matches Phase 7 slice-per-concern pattern; persist is the opt-in, omitting it is the default). |
| REQ-AUTO-05 | System surfaces an "Auto" tab in the bet panel with target/strategy/stop inputs and a Start/Stop toggle. | UI-SPEC Surface A.1 fully specifies the form. § "FE Component Inventory" maps to `AutoBetForm` + `AutoBetSessionPanel` + the refactored tabbed `BetPanel`. Single shadcn install: `radio-group`. |
| REQ-LEAD-01 | System maintains a 24h rolling leaderboard of top players by net profit (sum of payouts − sum of bets, last 24h window). | § "Leaderboard Projector" — denormalized `leaderboard_24h` table; on-read window filter `WHERE last_event_at > NOW() - INTERVAL '{N} hours'` (no cron); `net_profit_cents BIGINT` updated by signed deltas (`+(payout - bet)` on cashed_out, `-bet` on refund/loss-via-settle). Window driven by env `LEADERBOARD_WINDOW_HOURS` (default 24 — already in `gamesEnvSchema`). |
| REQ-LEAD-02 | System populates the leaderboard via a projector consuming `game.events` (light CQRS — no event sourcing) into a denormalized read model. | § "Leaderboard Projector" — new queue `leaderboard-projector.q` bound to `game.events` with routing keys `bet.cashed_out` + `bet.refunded` + `round.settled` (planner confirms which events drive deltas vs trigger emits). Uses `@IdempotentSubscribe` (Phase 5 pattern); inbox dedupe by `messageId` makes redelivery a no-op. Projector lives in `services/games/src/application/leaderboard-projector.service.ts` (subscribes within the same service per CONTEXT — no new service binary). |
| REQ-LEAD-03 | System exposes `GET /games/leaderboard?window=24h` returning the top N (default 10) with masked playerId, net profit, win count. | § "Leaderboard Controller" — new `LeaderboardController` (`services/games/src/presentation/controllers/leaderboard.controller.ts`) under existing `JwtGuard` (UI-SPEC implies authenticated users), accepts `?window=24h` (single allowed value v1; planner uses Zod enum), returns `{ entries: Array<{ playerIdMasked, netProfit: MoneySnapshot, winCount, totalBetCount }>, updatedAt: ISO8601 }`. Reuses existing Kong upstream — no new gateway route. |
| REQ-LEAD-04 | Frontend renders the leaderboard in a side panel with live updates via WS (`leaderboard:updated` event when ranks change). | § "Leaderboard WS Emit Throttle" — projector compares top-N snapshot before/after each batch; emits `leaderboard:updated` to `lobby` ONLY when the top-N ranks have shifted; payload = full top-N snapshot (cheap, ~10 rows; FE avoids a second fetch). FE listener invalidates the TanStack Query cache (or replaces inline) at `frontend/src/features/leaderboard/use-leaderboard.ts`. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

These are non-negotiable. Plans MUST honor them; verification MUST gate on them.

| # | Constraint | Enforcement |
|---|------------|-------------|
| C-1 | **Money is NEVER `number`** for any monetary amount (stops, base bet, payout, session P/L, leaderboard net profit, leaderboard delta). Use the `Money` VO from `@crash/shared-kernel`. | ESLint custom rule `@crash/no-number-for-money` already bans `number` typed symbols matching `/amount\|balance\|bet\|payout\|price\|wager/i` (extended to `.tsx` in P07-01). Plans MUST type stops as `Money`, P/L as `Money`, leaderboard `netProfit` as `MoneySnapshot` on the wire. The leaderboard DB column is `BIGINT` (cents). |
| C-2 | **Domain layer has ZERO infrastructure imports.** No `@nestjs/*` decorators, no `@mikro-orm/*` decorators, no `socket.io`, no `axios`, no `pg`. The `Bet.autoCashoutTarget` field is a `Multiplier \| null` value object — added to the domain aggregate, NOT to the MikroORM entity in isolation. | Code review gate. Bet aggregate change is a value-object addition + a factory parameter, not a decorator. |
| C-3 | **No hardcoded business constants** — every value goes through `services/games/src/config/defaults.ts` (Zod-parsed env). | Phase 9 adds the following env vars (defaults to be confirmed by user in PLAN.md): `LEADERBOARD_UPDATE_THROTTLE_MS`, `STOP_LOSS_CENTS_MAX`, `STOP_WIN_CENTS_MAX`, `AUTO_BET_MIN_TARGET_CENTI_X`. FE adds the `VITE_*` mirrors per UI-SPEC §Cross-References. NOTHING gets a hardcoded ceiling in code. |
| C-4 | **One aggregate per transaction.** | Auto-cashout invokes the existing `CashOutUseCase`, which already wraps a single-Bet `em.transactional()` — one Bet write + one outbox row per invocation. The projector's leaderboard upsert is a single-row write per event — single aggregate. |
| C-5 | **Server-authoritative timestamps for cashout** — `cashoutAcceptedAt = new Date()` computed at the inbound handler, **before any await**. | The `AutoCashoutTickService` MUST stamp `acceptedAt = new Date()` as the literal first executable line of its tick-event handler, before the bet query, before the `CashOutUseCase.execute()` call. ADR-023 generalizes: "Phase 9 REQ-AUTO-01 reuses this same server-clock primitive: the 30 Hz tick loop will compare each tick's multiplier to the player's target and auto-issue a cashout server-stamped the same way." |
| C-6 | **Ticks emitted as `volatile.emit`** — the existing `MultiplierBroadcastService` already does this. Phase 9 must NOT block the broadcast loop on the auto-cashout check. | Decoupling via in-process `@OnEvent` (Option B) honors this — the broadcast loop emits the in-process event and immediately schedules its next tick; the auto-cashout listener runs asynchronously off the same event-loop turn. |
| C-7 | **No emojis in code. No AI attribution in commits.** | Plans and commit messages stay clean. |
| C-8 | **Atomic commits per logical change.** | Plans should produce one commit per task; the planner already follows this. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auto-cashout target validation + persistence | API / Backend (games-service) | Database (Postgres bet row + index) | Server is the trust boundary per D-06 + ADR-023. FE only displays + sends an optional field on POST /games/bet. |
| Per-tick auto-cashout evaluation | API / Backend (in-process `AutoCashoutTickService`) | — | Per D-06: tick loop is server-owned (`MultiplierBroadcastService` already on the 30Hz cadence). |
| Server-stamped cashout execution | API / Backend (existing `CashOutUseCase`) | Database (Bet `tryTransition` ACTIVE→CASHED_OUT + outbox `wallet.credit`) | ADR-023 invariant: `acceptedAt = new Date()` first-line; existing single-Bet micro-TX. |
| Auto-bet strategy computation (fixed/martingale) | Browser / Client (Zustand-backed driver) | — | Per D-01 / REQ-AUTO-04: per-session, no persistence, FE-only. Server stays stateless on stops. |
| Stop-loss / stop-win evaluation | Browser / Client (auto-bet driver hook) | — | Per D-01: cumulative P/L from event payloads, FE-computed; server has no awareness of stops. |
| Auto-bet driver POST /games/bet trigger | Browser / Client (TanStack Query mutation) | API / Backend (existing PlaceBetUseCase) | Driver fires the SAME POST a manual bet fires, just with `autoCashoutTarget` populated. No new endpoint. |
| Leaderboard read-model projection | API / Backend (projector @IdempotentSubscribe) | Database (`leaderboard_24h` table) | Per D-05: light CQRS, projector failure decoupled from write path via RabbitMQ. |
| Leaderboard query | API / Backend (`LeaderboardController` GET /games/leaderboard) | Database (indexed on net_profit_cents DESC) | Per REQ-LEAD-03. |
| Leaderboard `leaderboard:updated` WS emit | API / Backend (projector → GameWsGateway via `@OnEvent`) | — | Per D-04 + REQ-LEAD-04: server is the only authority for "ranks shifted". |
| Leaderboard render + live update consumption | Browser / Client (`LeaderboardPanel` + TanStack Query + WS dispatch) | — | Phase 7 dispatch layer already handles WS event hydration. |
| Tabbed `BetPanel` (Manual / Auto) | Browser / Client (refactored Phase 7 component) | — | Pure UI refactor per D-03 + UI-SPEC Surface A. |
| Tabbed right rail (Live Feed / Leaderboard) | Browser / Client (refactored parent of Phase 7 LiveFeed) | — | Pure UI refactor per D-02 + UI-SPEC Surface B. |

## Standard Stack

### Core (every package already in the workspace — Phase 9 installs ONE new shadcn primitive on the FE)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/common`, `@nestjs/core` | `^11.1.21` | Backend framework — services, controllers, gateways, lifecycle, `@OnEvent`. | Already locked stack (STACK.md §1). |
| `@nestjs/event-emitter` | `^2.x` | In-process pub-sub for the in-process `GAME_EVENTS.ROUND_TICK` and existing `ROUND_STARTED/RUNNING/CRASHED/SETTLED`. | Already installed in Phase 6 (P6.05); `GameWsGateway.@OnEvent` consumers are live. |
| `@mikro-orm/postgresql` | `^7.1.x` | Bet aggregate persistence + the new `leaderboard_24h` table + migrations. | Already locked (ADR-001). |
| `@golevelup/nestjs-rabbitmq` | `^5.x` | AMQP consumer ergonomics — `@RabbitSubscribe` underlies `@IdempotentSubscribe`. | Already in spine. |
| `amqplib` | `^0.10.x` | Raw publisher for outbox (auto-cashout's `wallet.credit` reuses existing path via `CashOutUseCase`). | Already in spine. |
| `@crash/messaging-spine` | workspace | `@IdempotentSubscribe`, `InboxRepository`, `OutboxRepository`, `buildEnvelope`, `EXCHANGES`, `QUEUES`, `buildQuorumArgs`, `deriveDlxFromExchange`. | Phase 2 spine. The leaderboard projector lands inside it as a new consumer reusing the canonical decorator. |
| `@crash/shared-kernel` | workspace | `Money` VO + `PlayerId`/`RoundId`/`BetId` branded IDs + `sharedEnvSchema`. | Already locked (ADR-002). |
| `@crash/contracts` | workspace | Shared `MoneySnapshot`, WS event schemas (Phase 7 P07-01 ships `@crash/contracts/ws`). Phase 9 adds `leaderboardUpdatedPayloadSchema` + bumps `placeBetRequestSchema` with optional `autoCashoutTarget`. | Already locked. |
| `nestjs-zod` | `^4.x` | DTO validation (place-bet request + leaderboard query). | Already locked (STACK.md §2.6). |
| `zod` | `^3.23.x` | Schema source-of-truth. | Already locked. |
| `nestjs-cls` | `^4.x` | CLS propagation inside `@IdempotentSubscribe`. | Already in spine. |
| `socket.io` | `^4.8.x` | WS server (existing `GameWsGateway`). | Already locked. |
| `@tanstack/react-query` | `^5.x` | FE leaderboard fetch + invalidation. | Already in FE (Phase 7). |
| `zustand` | `^5.x` | FE auto-bet store (per-session, NO persist). | Already in FE (Phase 7 slice-per-concern). |
| `socket.io-client` | `^4.8.x` | FE WS dispatch (already wired in Phase 7 P07-04). | Already in FE. |
| `shadcn/ui` | CLI v4 | `tabs` (already installed), `radio-group` (NEW for Phase 9), `card`/`input`/`label`/`button`/`alert`/`tooltip`/`scroll-area`/`skeleton`/`badge` (inherited). | Already locked. The single new install is `radio-group`. |
| `lucide-react` | latest | New icons used: `Bot`, `Trophy`, `TrendingUp`, `TrendingDown`, `Lock`, `RefreshCw`. Already-present icons: `Play`, `Pause`, `Loader2`, `Info`. | Already in FE. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fast-check` | `^3.x` | Property test for the auto-cashout race window + martingale arithmetic invariants. | Optional — add a property test for "cumulative P/L of a fixed-strategy session equals sum of (payout - bet) per round" (single source of truth for stops). |
| `bun:test` | builtin | Unit + integration tests, mirroring P5/P6 layout. | Mandatory — the SC1 disconnect E2E and the projector idempotency integration both run here. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-process `@OnEvent` for the per-tick auto-cashout dispatch (Option B) | (A) Inline check in `MultiplierBroadcastService.fireTick()` | (A) couples two responsibilities and risks blocking the volatile broadcast on a DB query — directly contradicts CONTEXT canonical-refs guidance "should NOT do the auto-cashout check". REJECTED. |
| In-process `@OnEvent` | (C) New per-tick callback registered on `RoundLoopService` | (C) puts the per-tick mechanism in the FSM service rather than the broadcaster, but `RoundLoopService` does NOT tick at 30Hz — it schedules at `BETTING/RUNNING/CRASHED/SETTLED/cooldown` boundaries via recursive `setTimeout`. Reusing the existing 30Hz cadence of `MultiplierBroadcastService` (already proven; single owner of `volatile.emit`) is the right hook point. REJECTED in favor of (B). |
| Denormalized `leaderboard_24h` snapshot table | Event-sourced leaderboard with on-demand fold | Rejected by D-05 explicitly ("light CQRS, no event sourcing"). |
| On-read window filter `WHERE last_event_at > NOW() - INTERVAL 'X hours'` | Cron sweep to delete stale rows | Cron adds infra surface + scheduling concerns + a "what if cron is late" failure mode. On-read filter is simpler, has zero infra cost, and the leaderboard query is already indexed. The table grows linearly with active players (bounded — a handful per day in the recruiter demo). RECOMMENDED. |
| `@IdempotentSubscribe` for the projector | Hand-rolled consumer with inline inbox dedupe | The decorator already does inbox dedupe + DLX wiring + CLS propagation + txEm — reusing it saves ~80 lines + ensures the projector observes the same Phase 5 reliability invariants. RECOMMENDED. |
| `radio-group` (shadcn) for strategy | `toggle-group` (shadcn) | UI-SPEC explicitly chose `RadioGroup` — correct ARIA semantic for "one of N mutually exclusive value choices in a form". |

**Installation (FE only — backend installs nothing):**
```bash
cd frontend && bunx shadcn@latest add radio-group
```

**Version verification:** Every package above is already in `bun.lock` / `package.json` per the Phase 1-8 closeout state. The only registry-touching install is `radio-group` from the shadcn official registry — no third-party packages.

## Package Legitimacy Audit

> Phase 9 installs **one** package: `shadcn/ui radio-group` from the official shadcn registry. The shadcn CLI does NOT publish to npm — it scaffolds the component source into `frontend/src/components/ui/radio-group.tsx` from the official `https://ui.shadcn.com/registry` index. There is no npm package to slopcheck.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| shadcn registry block `radio-group` | shadcn official | many years | n/a (registry block, not npm pkg) | github.com/shadcn-ui/ui | n/a — not an npm package | Approved (official registry, used by Phase 7/8 already) |

**Underlying transitive dep installed by the radio-group block:** `@radix-ui/react-radio-group` (a Radix UI primitive, the same provenance as every other Radix primitive shadcn ships with `dialog`, `tabs`, `tooltip`, etc., already in `frontend/package.json`). Verifiable via `npm view @radix-ui/react-radio-group version`.

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

*slopcheck was not run because the installation flow is `bunx shadcn@latest add radio-group` (registry block scaffold + Radix transitive), not a direct `bun add` of a non-trusted package. The Radix primitives are governed by the same provenance gate Phase 7 established (P07-03 shadcn 13-component install + P08-04 sheet/toggle-group/alert install both passed without slopcheck — same registry, same provenance).*

## Architecture Patterns

### System Architecture Diagram (Phase 9 deltas only — Phase 4/5/6 stack assumed)

```
┌─────────────────────── games-service process ─────────────────────────────┐
│                                                                            │
│   RoundLoopService (existing)                                              │
│      │                                                                     │
│      │  schedules BETTING/RUNNING/CRASHED/SETTLED transitions              │
│      ▼                                                                     │
│   MultiplierBroadcastService (existing — 30Hz recursive setTimeout)        │
│      │                                                                     │
│      │  fireTick():                                                        │
│      │    1. resolve roundLoop.getMultiplierAt(now) → Multiplier           │
│      │    2. gateway.server.to('lobby').volatile.emit('round:tick', …)     │
│      │ ┌─NEW──────────────────────────────────────────────────────────┐    │
│      │ │ 3. eventEmitter.emit(GAME_EVENTS.ROUND_TICK,                 │    │
│      │ │      { roundId, multiplier, t })                             │    │
│      │ └──────────────────────────────────────────────────────────────┘    │
│      │                                                                     │
│      ▼                                                                     │
│  ┌─NEW─────────────────────────────────────────────────────────────────┐   │
│  │ AutoCashoutTickService                                              │   │
│  │   @OnEvent(GAME_EVENTS.ROUND_TICK)                                  │   │
│  │     const acceptedAt = new Date();  // ADR-023 first line           │   │
│  │     const bets = await betRepo.findAutoCashoutCandidates(           │   │
│  │       roundId, multiplier.centiX,                                   │   │
│  │     );  // single indexed SELECT, no N+1                            │   │
│  │     for (bet of bets) {                                             │   │
│  │       cashOutUseCase.execute({                                      │   │
│  │         playerId: bet.playerId,                                     │   │
│  │         multiplier: bet.autoCashoutTarget,                          │   │
│  │         acceptedAt,                                                 │   │
│  │       });  // existing single-Bet micro-TX + outbox wallet.credit   │   │
│  │     }                                                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│      │                                                                     │
│      │   (cashed_out bets flow through the existing Phase 5 saga path:     │
│      │    outbox.bet.cashed_out → game.events → WsBridgeConsumer →         │
│      │    bet:my_cashed_out user-room emit + bet:cashed_out lobby emit)    │
│      ▼                                                                     │
│                                                                            │
│   game.events (RabbitMQ topic exchange)                                    │
│      │                                                                     │
│      ├──► games.ws-bridge.q  (existing — Phase 6 fan-out)                  │
│      │                                                                     │
│      ├─NEW──────────────────────────────────────────────────────────┐      │
│      │   leaderboard-projector.q                                    │      │
│      │   (quorum + x-delivery-limit=5 + DLX = game.dlx)             │      │
│      │   bindings: bet.cashed_out, bet.refunded, round.settled      │      │
│      │                                                              │      │
│      │   LeaderboardProjectorService                                │      │
│      │     @IdempotentSubscribe(...) — inbox dedupe automatic        │      │
│      │     case 'bet.cashed_out':                                   │      │
│      │       upsert player row: net_profit += (payout - bet),       │      │
│      │                          win_count += 1,                     │      │
│      │                          total_bet_count += 1,               │      │
│      │                          last_event_at = now                 │      │
│      │     case 'bet.refunded':                                     │      │
│      │       upsert: net_profit -= 0 (refund = no money change);    │      │
│      │       total_bet_count += 1 (still a placed bet attempt)      │      │
│      │       [planner confirms semantics — refund vs lose]          │      │
│      │     case 'round.settled':                                    │      │
│      │       For each LOST bet emitted: net_profit -= bet,          │      │
│      │       total_bet_count += 1.                                  │      │
│      │       Compute top-N before/after; if changed, fire           │      │
│      │       eventEmitter.emit(GAME_EVENTS.LEADERBOARD_UPDATED,     │      │
│      │         { entries, updatedAt })                              │      │
│      └──────────────────────────────────────────────────────────────┘      │
│                                                                            │
│   ┌─NEW──────────────────────────────────────────────────────────────┐     │
│   │ GameWsGateway (existing) gains:                                  │     │
│   │   @OnEvent(GAME_EVENTS.LEADERBOARD_UPDATED)                      │     │
│   │     server.to('lobby').emit('leaderboard:updated', payload)      │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                                                                            │
│   ┌─NEW──────────────────────────────────────────────────────────────┐     │
│   │ LeaderboardController                                            │     │
│   │   GET /games/leaderboard?window=24h  (JwtGuard)                  │     │
│   │     SELECT player_id, net_profit_cents, win_count,               │     │
│   │            total_bet_count, last_event_at                        │     │
│   │       FROM leaderboard_24h                                       │     │
│   │      WHERE last_event_at > NOW() - INTERVAL 'N hours'            │     │
│   │      ORDER BY net_profit_cents DESC                              │     │
│   │      LIMIT {LEADERBOARD_TOP_N}                                   │     │
│   └──────────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────┘

┌───────────────── Browser ──────────────────────────────────────────────────┐
│                                                                            │
│   Phase 7 socket.io-client dispatch (existing)                             │
│      │  hydrates Zustand stores from WS events; schema-validates payloads  │
│      ├─NEW──► auto-bet.store: append last bet outcome (cashed_out/refund)  │
│      │        + recompute session P/L (Money VO)                           │
│      ├─NEW──► leaderboard.store / TanStack Query cache: replace top-N      │
│      │                                                                     │
│   auto-bet driver hook (NEW)                                               │
│      @OnEvent('round:settled') (via dispatcher subscription)               │
│        if (!isRunning) return;                                             │
│        const next = strategy.nextBetAmount(...);                           │
│        // check stops (cumulative since Start) and balance                 │
│        if (stop-loss / stop-win / insufficient-balance) {                  │
│          halt; dedupedToast (amber); return;                               │
│        }                                                                   │
│        await placeBetMutation({                                            │
│          amountCents: next.toCents(),                                      │
│          autoCashoutTarget: store.config.target,                           │
│        });  // SAME POST /games/bet manual uses — no new endpoint          │
│                                                                            │
│   BetPanel (REFACTORED — tabbed)                                           │
│      shadcn Tabs defaultValue="manual"                                     │
│        Manual tab = existing form (disabled+Alert when auto-running)       │
│        Auto    tab = AutoBetForm (5 fields + Start/Stop + session panel)   │
│                                                                            │
│   Right Rail (REFACTORED — tabbed)                                         │
│      shadcn Tabs defaultValue="live-feed"                                  │
│        Live Feed   tab = existing LiveFeed verbatim                        │
│        Leaderboard tab = LeaderboardPanel (top-N + own-row highlight)      │
└────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
services/games/src/
├── application/
│   ├── auto-cashout-tick.service.ts            # NEW — @OnEvent ROUND_TICK
│   ├── leaderboard-projector.service.ts        # NEW — @IdempotentSubscribe
│   ├── multiplier-broadcast.service.ts         # EXTEND — emit ROUND_TICK in fireTick()
│   ├── round-loop.service.ts                   # untouched
│   ├── game-events.ts                          # EXTEND — add ROUND_TICK, LEADERBOARD_UPDATED constants
│   └── use-cases/
│       └── cash-out.use-case.ts                # untouched (reused by auto-cashout)
├── domain/
│   ├── bet.aggregate.ts                        # EXTEND — autoCashoutTarget: Multiplier | null
│   ├── bet.repository.ts                       # EXTEND — findAutoCashoutCandidates(roundId, ceilingCentiX)
│   └── leaderboard-snapshot.value-object.ts    # NEW — pure VO for top-N comparison
├── infrastructure/
│   ├── mikro-orm/migrations/
│   │   ├── 20260530001-add-auto-cashout-target-to-bets.ts   # NEW
│   │   └── 20260530002-create-leaderboard-24h.ts            # NEW
│   ├── persistence/
│   │   ├── bet.entity.ts                       # EXTEND — autoCashoutTargetCentiX nullable
│   │   └── leaderboard-24h.entity.ts           # NEW EntitySchema
│   └── repositories/
│       ├── mikro-bet.repository.ts             # EXTEND — findAutoCashoutCandidates SQL
│       └── mikro-leaderboard.repository.ts     # NEW
├── presentation/
│   ├── controllers/
│   │   └── leaderboard.controller.ts           # NEW — GET /games/leaderboard
│   ├── dtos/
│   │   ├── place-bet.request.dto.ts            # EXTEND — optional autoCashoutTarget
│   │   ├── leaderboard.query.dto.ts            # NEW
│   │   └── leaderboard.response.dto.ts         # NEW
│   └── gateways/
│       └── game-ws.gateway.ts                  # EXTEND — @OnEvent LEADERBOARD_UPDATED
├── config/
│   └── defaults.ts                             # EXTEND — LEADERBOARD_UPDATE_THROTTLE_MS,
│                                                 STOP_LOSS_CENTS_MAX, STOP_WIN_CENTS_MAX,
│                                                 AUTO_BET_MIN_TARGET_CENTI_X
└── tests/
    ├── e2e/
    │   └── auto-cashout-disconnect.e2e.ts      # NEW — SC1 disconnect proof
    ├── integration/
    │   ├── auto-cashout-tick.test.ts           # NEW — eligible bets cashed when multiplier crosses target
    │   ├── leaderboard-projector.test.ts       # NEW — idempotent, ranks reflect events
    │   └── leaderboard-controller.test.ts      # NEW — GET /games/leaderboard happy path
    └── unit/
        └── leaderboard-snapshot.test.ts        # NEW — top-N diff detection

frontend/src/
├── components/
│   ├── bet-panel.tsx                           # REFACTOR — wrap in shadcn Tabs
│   ├── auto-bet-form.tsx                       # NEW
│   ├── auto-bet-session-panel.tsx              # NEW
│   ├── manual-tab-content.tsx                  # NEW — wraps existing form + Alert
│   ├── leaderboard-panel.tsx                   # NEW
│   ├── leaderboard-row.tsx                     # NEW
│   ├── rank-chip.tsx                           # NEW
│   └── ui/radio-group.tsx                      # NEW (shadcn install)
├── features/
│   ├── auto-bet/
│   │   ├── auto-bet.store.ts                   # NEW — Zustand slice (NO persist)
│   │   ├── auto-bet-driver.ts                  # NEW — subscribes to WS dispatcher
│   │   ├── strategy.ts                         # NEW — pure nextBetAmount(strategy, base, lastOutcome)
│   │   └── strategy.test.ts                    # NEW
│   └── leaderboard/
│       ├── use-leaderboard.ts                  # NEW — TanStack Query + WS invalidation
│       └── leaderboard.store.ts                # OPTIONAL — planner may merge into Query cache
├── stores/
│   └── (wire WS dispatcher to auto-bet driver hook)
└── config/
    └── (extend getConfig() with VITE_LEADERBOARD_* + VITE_AUTO_BET_* + VITE_RANK_UP_TRANSITION_MS)
```

### Pattern 1: In-process domain event for per-tick auto-cashout dispatch

**What:** `MultiplierBroadcastService.fireTick()` adds one line — `eventEmitter.emit(GAME_EVENTS.ROUND_TICK, { roundId, multiplier: m.toNumber(), t: now.getTime() })` — alongside its existing `gateway.server.to('lobby').volatile.emit('round:tick', …)`. A new `AutoCashoutTickService` `@OnEvent(GAME_EVENTS.ROUND_TICK)`-listens, stamps `acceptedAt = new Date()` as its first executable statement, queries `BetRepository.findAutoCashoutCandidates(roundId, currentMultiplierCentiX)` (single indexed SELECT), and invokes `CashOutUseCase.execute()` for each match.

**When to use:** Always for this phase — it is the locked architecture per CONTEXT canonical-refs + the single-responsibility rule for the broadcast service.

**Example:**
```typescript
// services/games/src/application/multiplier-broadcast.service.ts (DELTA)
// In existing fireTick(), after the volatile.emit:
this.eventEmitter.emit(GAME_EVENTS.ROUND_TICK, {
  roundId,
  multiplier: multiplier.toNumber(),
  t: now.getTime(),
});
// fall through to scheduleNext() — broadcast loop never blocks on auto-cashout.

// services/games/src/application/auto-cashout-tick.service.ts (NEW)
@Injectable()
export class AutoCashoutTickService {
  constructor(
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    private readonly cashOut: CashOutUseCase,
  ) {}

  @OnEvent(GAME_EVENTS.ROUND_TICK, { async: true })
  async onTick(payload: RoundTickPayload): Promise<void> {
    const acceptedAt = new Date();  // ADR-023 first line; server-authoritative
    const ceilingCentiX = Math.floor(payload.multiplier * 100);
    const candidates = await this.bets.findAutoCashoutCandidates(
      RoundId(payload.roundId),
      ceilingCentiX,
    );
    for (const bet of candidates) {
      try {
        await this.cashOut.execute({
          playerId: bet.playerId,
          multiplier: bet.autoCashoutTarget!,  // honors target, NOT current — players' contract
          acceptedAt,
        });
      } catch (err) {
        // Bet already raced (manual cashout won, or round already crashed in another tick);
        // CashOutUseCase throws BetNotCashableError(RACE) or RoundNotRunningError — both safe to swallow.
      }
    }
  }
}
```

**Critical subtlety — auto-cashout multiplier value:** Per CONTEXT D-06 the cashout fires *at the target* (e.g., 2.0x), not at the current tick multiplier (which by definition is ≥ target). This is the player's contract: "auto-cashout at 2.0x" pays 2.0x even if the next tick read 2.05x. The bet's `autoCashoutTarget` is the multiplier passed into `CashOutUseCase`. The race-resolution authority (`acceptedAt`) is still the server clock of the tick handler — and importantly it's safely *before* crash for any matched bet, because if the round had crashed `RoundLoopService.getMultiplierAt()` would have been capped at `crashPoint` and the tick would never have fired for a target above it (or the tick would have failed and been dropped silently).

### Pattern 2: Leaderboard projector via `@IdempotentSubscribe`

**What:** A new `LeaderboardProjectorService` `@IdempotentSubscribe`s to a new queue `leaderboard-projector.q` bound to `game.events` with three routing keys. The decorator handles inbox dedupe + DLX + CLS + transactional txEm. The handler discriminates on `envelope.type` and applies idempotent UPSERT updates to `leaderboard_24h`.

**When to use:** Whenever a backend consumer reads from RabbitMQ in this codebase.

**Example:**
```typescript
// services/games/src/application/leaderboard-projector.service.ts (NEW)
@Injectable()
export class LeaderboardProjectorService {
  public readonly logger = new Logger(LeaderboardProjectorService.name);
  constructor(
    public readonly em: EntityManager,
    public readonly cls: ClsService,
    public readonly inbox: InboxRepository,
    @Inject(LEADERBOARD_REPOSITORY) private readonly leaderboard: LeaderboardRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @IdempotentSubscribe({
    consumerName: "games.leaderboard-projector",
    exchange: EXCHANGES.GAME_EVENTS,
    routingKey: ["bet.cashed_out", "bet.refunded", "round.settled"],  // confirm with planner — array allowed
    queue: "leaderboard-projector.q",
  })
  async handle(envelope: GameEventEnvelope, _msg: ConsumeMessage, txEm: EntityManager): Promise<void> {
    const beforeTopN = await this.leaderboard.fetchTopN(env.LEADERBOARD_TOP_N, txEm);
    switch (envelope.type) {
      case "bet.cashed_out":
        await this.leaderboard.applyCashedOut(envelope.payload, txEm);
        break;
      case "bet.refunded":
        await this.leaderboard.applyRefunded(envelope.payload, txEm);
        break;
      case "round.settled":
        await this.leaderboard.applySettled(envelope.payload, txEm);  // marks LOST bets
        break;
    }
    const afterTopN = await this.leaderboard.fetchTopN(env.LEADERBOARD_TOP_N, txEm);
    if (LeaderboardSnapshot.diff(beforeTopN, afterTopN).changed) {
      this.eventEmitter.emit(GAME_EVENTS.LEADERBOARD_UPDATED, {
        entries: afterTopN,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}
```

**Routing key set — planner must confirm.** Three candidates exist for which `game.events` keys drive the projector:
- `bet.cashed_out` — strongest signal (winner credited): definitely include.
- `bet.refunded` — saga refund (insufficient funds / timeout): include for `total_bet_count` increment but a refund is net-zero (the player was never debited or was credited back); planner should confirm with user whether refunded bets count toward `total_bet_count`.
- `round.settled` — fires when a round closes (Phase 5 publishes this in `RoundLoopService.settleRound`). Inside the settle path, LOST bets transition. This is the cleanest debit signal. **Alternative:** add a `bet.lost` event publish to Phase 5's `SettleRoundUseCase` if it isn't already published (verify in implementation).

### Pattern 3: FE auto-bet driver via WS dispatcher subscription

**What:** A new hook `useAutoBetDriver()` mounts once in `__root.tsx` (or `index.tsx` — wherever Phase 7's WS dispatcher is wired). It reads the auto-bet Zustand store and subscribes to `round:settled` + `bet:my_cashed_out` + `bet:my_refunded` events via the existing Phase 7 dispatcher pattern. On each event it (a) updates the session P/L (Money VO arithmetic on `MoneySnapshot` deltas), (b) on `round:settled` if running and next BETTING window is open, computes `nextBet = strategy.nextBetAmount(...)`, checks stops + balance, and either POSTs `/games/bet` with `autoCashoutTarget` or halts with a deduped amber toast.

**When to use:** This phase only; the pattern is "external side-effect driven by Zustand-store-watching hook + WS-event subscription", mirroring how Phase 7 wired `useGameSocket`.

**Example:**
```typescript
// frontend/src/features/auto-bet/auto-bet-driver.ts (NEW)
export function useAutoBetDriver(): void {
  const isRunning = useAutoBetStore((s) => s.isRunning);
  const config = useAutoBetStore((s) => s.config);
  const halt = useAutoBetStore((s) => s.halt);
  const recordOutcome = useAutoBetStore((s) => s.recordOutcome);
  const balance = useWalletStore((s) => s.balance);
  const placeBet = usePlaceBet();

  // dispatcher.on('bet:my_cashed_out' | 'bet:my_refunded'): recordOutcome(payload)
  // dispatcher.on('round:settled'): if (!isRunning || !config) return;
  //   const next = strategy.nextBetAmount(config.strategy, config.baseAmount, lastOutcome);
  //   if (sessionPL.cents >= config.stopWin.cents) return halt({ reason: 'stop-win' });
  //   if (sessionPL.cents <= -config.stopLoss.cents) return halt({ reason: 'stop-loss' });
  //   if (next.cents > balance.cents) return halt({ reason: 'insufficient-balance' });
  //   placeBet.mutate({ amount: next, autoCashoutTarget: config.target });
}

// frontend/src/features/auto-bet/strategy.ts (NEW)
export function nextBetAmount(
  strategy: 'fixed' | 'martingale',
  baseAmount: Money,
  lastOutcome: 'win' | 'loss' | null,
): Money {
  if (strategy === 'fixed') return baseAmount;
  if (lastOutcome === 'loss' && lastBetAmount !== null) return lastBetAmount.multiplyRounded({ numerator: 2n, denominator: 1n });
  return baseAmount;  // win or first round → reset to base (REQ-AUTO-02)
}
```

### Anti-Patterns to Avoid

- **Inline auto-cashout check in `MultiplierBroadcastService.fireTick()`** — couples WS broadcast to DB query, blocks the volatile tick, contradicts CONTEXT canonical-refs guidance.
- **Stamping `acceptedAt` AFTER the DB query in `AutoCashoutTickService`** — violates ADR-023. The stamp MUST be the literal first executable statement.
- **Loading ALL ACTIVE bets every tick and filtering in memory** — N+1 / quadratic in bet count. Use a DB index on `(round_id, status, auto_cashout_target_centi_x) WHERE status = 'ACTIVE' AND auto_cashout_target_centi_x IS NOT NULL` + a parameterized SELECT that returns only crossing rows.
- **Cashing out at the current tick multiplier rather than the player's target** — violates the player contract per CONTEXT D-06. Use `bet.autoCashoutTarget` as the multiplier passed to `CashOutUseCase`.
- **Driving the FE auto-bet from a `setInterval`** — the source of truth is the round FSM (BETTING windows are the only valid bet times). Subscribe to `round:settled` (round-ended event) and POST in the next BETTING window. No timers.
- **Server-side stop enforcement** — D-01 locks stops to FE. Backend MUST stay stateless on stops; do not add stop fields to the request DTO.
- **`@OnEvent` listener that fires synchronously and blocks the emit** — use `{ async: true }` option so the broadcast service's `eventEmitter.emit` returns immediately without awaiting the listener (the `MultiplierBroadcastService.fireTick()` is fire-and-forget anyway, but the discipline matters).
- **Raw-SQL hydration without `toDate()` coercion** — Phase 6 fix `439e5b4` was forced by this. If the leaderboard repo or auto-cashout-candidates query uses `em.getConnection().execute(...)` and reads timestamp columns, the timestamps come back as **strings** under Bun's pg driver, not `Date`. ALL such timestamps MUST go through the Phase 6 `toDate()` coercion helper before any consumer touches them.
- **Martingale `nextBet = lastBet * 2` interpreted as "base = previous bet"** — REQ-AUTO-02 says "reset to base after each win" and the base is the configured initial bet, NOT the last bet. CONTEXT §Specifics flags this explicitly: "Martingale base: REQ says 'reset to base after each win' — base is the configured initial bet, NOT the last bet. Re-confirm in plan acceptance."
- **Persisting auto-bet config in localStorage** — REQ-AUTO-04 + D-03 explicitly forbid this. The Zustand store has NO `persist` middleware.
- **Tagging `leaderboard:updated` to a per-tick or per-bet event** — D-04 locks throttling to round-settle. Emit only when (a) it's a `round.settled` projection batch AND (b) the top-N diff actually changed.
- **Emitting `leaderboard:updated` from outside the projector's TX** — emit AFTER the TX commits (i.e., outside the `@IdempotentSubscribe` decorator's `em.transactional` wrapper). The standard pattern: the decorator wraps the handler in TX; emit from within the handler but the listener processes the event after the decorator returns. Verify behavior in integration test — alternative is to use the outbox for the WS emit too (overkill for a low-stakes UI signal).
- **Hand-rolling another `@RabbitSubscribe`-based consumer for the projector** — `@IdempotentSubscribe` is the canonical pattern (P5.05, P5.07, P6.06 all use it). Reuse it.
- **Adding a confirmation dialog to the Stop button** — UI-SPEC §"Destructive actions in this phase" forbids it (Phase 7 / Phase 8 stance: no destructive dialogs for tactile real-time actions). The destructive-bordered button + Pause icon + label are sufficient.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Inbox dedupe for the leaderboard projector | Inline `tryClaim`/`markProcessed` calls | `@IdempotentSubscribe` decorator from `@crash/messaging-spine` | Already wraps inbox dedupe + DLX + CLS + txEm propagation. Saves ~80 lines + ensures the projector observes the same Phase 5 reliability invariants. |
| In-process pub-sub between `MultiplierBroadcastService` and `AutoCashoutTickService` | Direct call (which would re-couple SRP), or `Subject` from rxjs | `@nestjs/event-emitter` — already in the project for Phase 6 `@OnEvent` lifecycle | One emit, async listener, zero new dependency. |
| AMQP topology declaration for `leaderboard-projector.q` | Hand-rolled `assertQueue` | `@IdempotentSubscribe` calls `buildQuorumArgs` + `deriveDlxFromExchange` automatically | Same canonical pattern Phase 5 uses; binds to `game.events` exchange + `game.dlx` for DLQ via convention. |
| Tab swap UI | Custom `<div onClick={() => setTab(...)}>` | shadcn `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent` | UI-SPEC explicit lockin; Radix-backed ARIA-correct; keyboard navigation free; reduced-motion handled. |
| Radio group for strategy | Native `<input type="radio">` cluster | shadcn `RadioGroup` (Radix `react-radio-group`) | ARIA correctness + keyboard nav + matches the form's visual system. |
| Server clock for the auto-cashout race | New helper | `new Date()` inline as first statement of `AutoCashoutTickService.onTick` | ADR-023 invariant — the controller pattern is the canon. Adding a wrapper hides the "first executable line" requirement. |
| Money arithmetic for session P/L (FE) | `number` accumulator | `Money.fromSnapshot(...).subtract(...).add(...)` on the shared kernel | CLAUDE.md §Money: `number` is BANNED. ESLint enforces. Session P/L MUST be a `Money` value, NOT a JS number. |
| Auto-cashout filter SQL | `findAll().filter(...)` in JS | Indexed `WHERE` clause: `WHERE round_id = ? AND status = 'ACTIVE' AND auto_cashout_target_centi_x IS NOT NULL AND auto_cashout_target_centi_x <= ?` | At 30Hz × N active bets, in-memory filter is wasteful. Postgres + index handles it in microseconds. |
| Leaderboard window expiry | Cron job or trigger | On-read filter `WHERE last_event_at > NOW() - INTERVAL '24 hours'` | Cron adds infra surface + scheduling failure modes. On-read is one line + the existing index helps. |
| Top-N diff detection | Naive deep equality | Pure-function `LeaderboardSnapshot.diff(before, after)` comparing ordered `playerId` arrays | Easier to unit test; isolates the "did ranks change" decision from the projector's side-effect path. |
| Disconnect-safety SC1 test | Full Playwright LIVE-loop stack | Bun test + `socket.io-client` connect + force-close + poll `GET /games/bets/me` until CASHED_OUT | Phase 10 owns Playwright; THIS phase ships the disconnect proof via Bun integration test against the live docker stack (mirroring P6.08 ws-tick + P5.09 SIGKILL patterns). |

**Key insight:** This phase is 90% wiring existing primitives. Hand-rolling anything in the auto-cashout / leaderboard projector path means duplicating spine work that's already battle-tested across Phases 2, 5, and 6.

## Common Pitfalls

### Pitfall 1: Raw-SQL timestamp hydration returns strings under Bun's pg driver
**What goes wrong:** Any query using `em.getConnection().execute<MyRowType[]>('SELECT ...')` returns timestamp columns as **strings**, not `Date`. Downstream code that does `row.created_at.getTime()` throws `row.created_at.getTime is not a function` in production, but tests against jsdom mocks may pass.
**Why it happens:** Bun's `pg` driver does not auto-coerce `TIMESTAMPTZ` to `Date` in raw-SQL paths (only the EntitySchema mapping layer does it). The bug bit Phase 6 hard (fix `439e5b4` per CONTEXT).
**How to avoid:** Any new raw-SQL query in this phase (the `findAutoCashoutCandidates` SQL, the projector's UPSERTs, the leaderboard query) MUST coerce timestamps via a `toDate()` helper before exposing them to consumers. Use the EntitySchema path (`em.find(...)`) wherever possible; raw SQL is only justified when `RETURNING *` or `UPSERT` semantics need it.
**Warning signs:** A test that hydrates DB rows via the EntitySchema passes; the live smoke probe throws on `.getTime()`. Or: leaderboard updated-at column appears as `"2026-05-30T..."` in WS payloads when the schema says `Date`.

### Pitfall 2: `acceptedAt` not stamped first in `AutoCashoutTickService.onTick`
**What goes wrong:** A `const candidates = await this.bets.findAutoCashoutCandidates(...)` runs BEFORE `const acceptedAt = new Date()` — so the stamp drifts past the true tick instant by the query latency (~ms). At the crash boundary, this turns a should-have-paid auto-cashout into a `409` or vice versa.
**Why it happens:** Natural code flow ("first query, then stamp"). Easy to introduce in a refactor.
**How to avoid:** ADR-023 invariant — `acceptedAt = new Date()` is the LITERAL first executable statement of the handler. Code review gate. Unit test asserts the position via source inspection (mirroring the Phase 5 P5.06 check that found `acceptedAt` at line 69 of `bet-command.controller.ts`).
**Warning signs:** Property test (`fast-check`, ±50ms around crash) shows a non-zero rate of double-payouts or wrongly-rejected cashouts.

### Pitfall 3: `MultiplierBroadcastService` event emit blocks the volatile tick
**What goes wrong:** `eventEmitter.emit(GAME_EVENTS.ROUND_TICK, ...)` awaited synchronously in `fireTick()` means the broadcast loop pauses for the auto-cashout listener's DB roundtrip. The volatile tick rate drops below 30Hz under load.
**Why it happens:** `EventEmitter2.emit()` returns `Promise<boolean>` if any async listener is registered; an inadvertent `await` on the emit blocks.
**How to avoid:** Mark listeners with `{ async: true }` in the `@OnEvent` decorator; do NOT `await` `eventEmitter.emit(...)` in `fireTick()`. Verify via integration test that 30Hz cadence holds with the auto-cashout listener active.
**Warning signs:** Smoke probe `ws-tick-volatile.test.ts` (Phase 6 integration) regresses on tick frequency.

### Pitfall 4: Auto-cashout fires at the current tick multiplier instead of the target
**What goes wrong:** Player set target=2.0x; the tick that triggers the auto-cashout reads 2.03x; the bet pays 2.03x; player gets MORE than expected. Or: ticks at 30Hz mean the tick multiplier can be `target + ε`; the player set 2.0x and got 2.01x. Different from "target met" — could be exploited for free RTP edge.
**Why it happens:** Natural impulse to "use the current multiplier the cashout is happening at" instead of the player's explicit target.
**How to avoid:** Pass `bet.autoCashoutTarget` (the locked-at-bet-time `Multiplier` VO) into `CashOutUseCase.execute({ multiplier: bet.autoCashoutTarget, ... })`. The DB filter ensures we only cash bets where `target <= currentMultiplier`. The cashout's `acceptedAt` is the server tick stamp (race-resolution authority), but the multiplier paid is the player's target.
**Warning signs:** Unit test for `AutoCashoutTickService` verifies a bet with `target=2.0` and tick `multiplier=2.05` results in a CASHED_OUT bet with `cashedOutMultiplier=2.00` (not 2.05).

### Pitfall 5: Martingale doubling overflows the wallet balance
**What goes wrong:** After 8 consecutive losses, martingale wants `256 * baseBet`. If `baseBet=10 CRD` and balance=1000 CRD, the 8th loss tries to bet 2560 CRD. `POST /games/bet` returns 202 → saga rejects with `INSUFFICIENT_FUNDS` → bet refunded. If the driver doesn't detect this it spins re-posting in a fail-loop.
**Why it happens:** No client-side balance check before POST; reliance on server rejection.
**How to avoid:** Driver checks `nextBet.cents > balance.cents` BEFORE POST; halts with `halted={reason:'insufficient-balance'}` and amber toast (UI-SPEC Copywriting). Also caps `nextBet` at `BET_MAX_CENTS` (env-provided) — if `nextBet > BET_MAX_CENTS`, halt with insufficient-balance reason (or a dedicated `martingale-overflow` reason if the planner prefers).
**Warning signs:** Live test: set base=100 CRD, force several losses by setting target very high, observe the driver halts cleanly without spamming POST.

### Pitfall 6: Projector double-applies an event after a redelivery
**What goes wrong:** `bet.cashed_out` arrives; projector updates `net_profit += payout - bet`. RabbitMQ redelivers (consumer crashed before ack). Projector applies it AGAIN; leaderboard shows double the profit.
**Why it happens:** Without idempotency, at-least-once delivery applies twice.
**How to avoid:** `@IdempotentSubscribe` decorator — inbox dedupe by `messageId` is automatic. The first delivery inserts an inbox row inside the projector's TX + applies the delta + commits + acks. A redelivery hits the inbox UNIQUE constraint, claim fails, decorator short-circuits, ack returns. No double-apply possible.
**Warning signs:** Integration test: emit the same `bet.cashed_out` envelope twice; assert the leaderboard row's `net_profit` reflects ONE application only.

### Pitfall 7: `leaderboard:updated` floods the lobby
**What goes wrong:** Projector emits `leaderboard:updated` on every event (cashed_out + refunded + settled). At ~3 events per round × 1 round per ~10s = an emit every ~3s during play. Clients re-render the leaderboard at this rate even when ranks haven't changed.
**Why it happens:** Misreading D-04 as "emit on every projector run" instead of "emit when top-N ranks shift, at round-settle boundary".
**How to avoid:** Per UI-SPEC + D-04: projector computes top-N before and after each event batch (or after each `round.settled`); emit ONLY when the ordered set of (player_id, rank) within the top-N changes. The `LeaderboardSnapshot.diff()` pure function isolates the decision.
**Warning signs:** Profile WS traffic during a 10-round test; `leaderboard:updated` emits should be ≤ N (number of rounds with rank-changing events).

### Pitfall 8: Leaderboard window confusion — last_event_at vs round_settled_at
**What goes wrong:** The `last_event_at` column gets bumped on every event (including refunds). A player who had a big win 23h ago and a refund 1h ago has `last_event_at = 1h ago`, so they appear in the 24h window. But the "active player" semantic was "had a settled round in the last 24h".
**Why it happens:** Single `last_event_at` column conflates "any activity" with "settled play".
**How to avoid:** Either (a) only bump `last_event_at` on `bet.cashed_out` / `bet.lost` (the round-affecting events), not on `bet.refunded`; (b) add a separate `last_settled_event_at` column. Recommendation: option (a) — the column semantic is "last event that affects the leaderboard's profit/loss ledger". A refund is a no-op for the ledger and shouldn't extend the window.
**Warning signs:** Integration test where a player has a settled win 23h ago and a refund 1h ago — assert they DO NOT appear in the leaderboard at the 24h cutoff.

### Pitfall 9: `findAutoCashoutCandidates` query under raw multiplier precision drift
**What goes wrong:** Multiplier on the wire is a JS `number` like `2.01`. Stored as `auto_cashout_target_centi_x INT` (201 for 2.01x). Tick multiplier is a `number` like `2.013`. The filter is `auto_cashout_target_centi_x <= floor(tick * 100)` (201 <= 201 → matches). But if the multiplier is stored at 10000-precision (`Multiplier.fromTenThousandths` uses `centiX * 100n`), the planner must pick ONE precision and use it consistently.
**Why it happens:** The Bet aggregate already uses `cashed_out_multiplier_centi_x` as INT centiX (see `mikro-bet.repository.ts:160`); the `Multiplier` VO has both `centiX` (×100) and `tenThousandths` (×10000) accessors. The planner must reuse `centiX` for `auto_cashout_target` to match the existing column convention.
**How to avoid:** Migration adds `auto_cashout_target_centi_x INT NULL` (matching `cashed_out_multiplier_centi_x`). The Bet aggregate's `autoCashoutTarget: Multiplier | null` serializes via `.toCentiX()`. The filter query passes `Math.floor(payload.multiplier * 100)` (the tick payload is also in display units already).
**Warning signs:** Unit test: bet target=2.00x cashes when tick reads 2.00x exactly (not 2.01x), and cashes at exactly 2.00x not 2.0001x.

### Pitfall 10: Auto-bet driver double-bets on WS hiccup + reconnect
**What goes wrong:** Driver POSTs bet for round N. Network glitch; the FE never receives `bet:my_active`. Round N completes (driver has no record of it). Round N+1 arrives; driver POSTs ANOTHER bet for round N+1 (correct). But meanwhile, the dropped `bet:my_active` arrives late and the driver thinks "I have an active bet" — out of phase with round.
**Why it happens:** Driver state is FE-local; server is the truth.
**How to avoid:** Driver POSTs are idempotent at the saga layer (existing Phase 5 pattern: each POST creates a NEW correlation_id; double-POSTing creates two PENDING bets, the second is rejected by the existing `(player_id, round_id) WHERE status IN ('PENDING','ACTIVE')` partial unique index with SQLSTATE 23505 → driver receives an error, doesn't halt, treats as "next round"). Also: the driver should rely on `bet:my_active`/`bet:my_cashed_out`/`bet:my_refunded` for its state, NOT on optimistic FE state — and the dispatcher's WS-reconnect `round:snapshot` resync (Phase 6) carries the player's active bet so the driver re-syncs on reconnect.
**Warning signs:** Integration test: force-disconnect during BETTING, reconnect, verify driver state matches server bet state.

### Pitfall 11: Auto-cashout candidate set includes bets from a stale round
**What goes wrong:** Tick fires for round R, but `findAutoCashoutCandidates(R, ...)` returns bets from a round that just transitioned to CRASHED in another tick handler racing on the same event-loop turn. Cashout fires for a CRASHED round.
**Why it happens:** The 30Hz tick handler and the `RoundLoopService` `crashRound()` step are on the same event loop. The tick can fire AFTER the round's actual crash multiplier was reached, but BEFORE `crashRound()` flips the FSM.
**How to avoid:** `CashOutUseCase` already does `if (open.status !== 'RUNNING') throw new RoundNotRunningError(open.status)` inside its TX (see `cash-out.use-case.ts:46`). Any auto-cashout invoked against a CRASHED round throws and is swallowed by the catch block. The Bet's status transition is also FSM-guarded by `tryTransition('ACTIVE', 'CASHED_OUT', ...)` — a CRASHED bet that was already settled as LOST in `settleRound` returns `null` from `tryTransition`, swallow.
**Warning signs:** Property test ±50ms around crash; no double-cashouts, no payouts for CRASHED rounds.

### Pitfall 12: Projector blocks on `round.settled` and stalls write path
**What goes wrong:** Projector is slow (DB lock, AMQP latency); RabbitMQ queue backs up; in extreme cases, RabbitMQ memory pressure. But D-05 explicitly requires "projector failure does not block writes" — so even a stalled projector must not stall sagas.
**Why it happens:** All consumers share the broker; congestion in one queue can starve others.
**How to avoid:** Projector is its OWN queue `leaderboard-projector.q` bound to `game.events` with the same routing keys as `games.ws-bridge.q` (Phase 6 pattern). Fan-out (topic exchange) → each consumer's queue is independent → projector lag does not affect WS bridge or saga consumers. Quorum + x-delivery-limit + DLX = bad messages go to DLQ, projector continues. The chaos test (SC5) `docker compose stop leaderboard-projector` (or `pkill` the projector consumer in-process) + place a bet + verify the bet still cashes → proves the decoupling.
**Warning signs:** Chaos test failure or a single shared queue between projector and WS bridge.

## Code Examples

Verified patterns from existing code in this repository.

### Existing `@IdempotentSubscribe` consumer (reused pattern)
```typescript
// Source: services/games/src/application/handlers/wallet-debited.handler.ts (P5.05)
@IdempotentSubscribe({
  consumerName: "games.wallet-debited",
  exchange: EXCHANGES.WALLET_EVENTS,
  routingKey: "wallet.debited",
  queue: QUEUES.GAMES_WALLET_EVENTS,
})
async handle(envelope: WalletDebitedEnvelope, msg: ConsumeMessage, txEm: EntityManager): Promise<void> {
  // ... handler body has txEm ready, inbox dedupe already applied
}
```

### Existing `@OnEvent` lobby fan-out (extend with LEADERBOARD_UPDATED)
```typescript
// Source: services/games/src/presentation/gateways/game-ws.gateway.ts (P6.05)
@OnEvent(GAME_EVENTS.ROUND_SETTLED)
onRoundSettled(payload: RoundSettledPayload): void {
  this.server.to("lobby").emit("round:settled", payload);
}

// NEW pattern (mirror):
@OnEvent(GAME_EVENTS.LEADERBOARD_UPDATED)
onLeaderboardUpdated(payload: LeaderboardUpdatedPayload): void {
  this.server.to("lobby").emit("leaderboard:updated", payload);
}
```

### Existing 30Hz tick fire (extend with in-process emit)
```typescript
// Source: services/games/src/application/multiplier-broadcast.service.ts:61-80 (P6.04)
private fireTick(): void {
  if (!this.running) return;
  const now = new Date();
  const roundId = this.currentRoundId;
  try {
    const multiplier = this.resolveRoundLoop().getMultiplierAt(now);
    const gateway = this.resolveGateway();
    if (roundId !== null && gateway !== null) {
      gateway.server.to("lobby").volatile.emit("round:tick", {
        roundId,
        multiplier: multiplier.toNumber(),
        t: now.getTime(),
      });
      // NEW (Phase 9): in-process emit for auto-cashout dispatch
      this.eventEmitter.emit(GAME_EVENTS.ROUND_TICK, {
        roundId,
        multiplier: multiplier.toNumber(),
        t: now.getTime(),
      });
    }
  } catch {
    // Round transitioned out of RUNNING between schedule and fire — drop tick silently.
  } finally {
    this.scheduleNext();
  }
}
```

### Existing cashout invocation (reused unchanged)
```typescript
// Source: services/games/src/application/use-cases/cash-out.use-case.ts (P5.06)
async execute(input: CashOutInput): Promise<CashOutResult> {
  return this.em.transactional(async (txEm) => {
    // ... full RUNNING-phase + ACTIVE-bet + tryTransition + outbox dance
  });
}
// Auto-cashout uses this UNTOUCHED — only the caller changes.
```

### Existing PlaceBetRequestDto (extend with optional autoCashoutTarget)
```typescript
// Source: services/games/src/presentation/dtos/place-bet.request.dto.ts (current — Phase 5)
export const placeBetRequestSchema = z
  .object({
    amountCents: z.string().regex(/^\d+$/).transform((raw) => BigInt(raw)),
  })
  .strict();

// NEW Phase 9 shape (additive, optional; backwards compatible):
export const placeBetRequestSchema = z
  .object({
    amountCents: z.string().regex(/^\d+$/).transform((raw) => BigInt(raw)),
    autoCashoutTarget: z
      .number()
      .positive()
      .min(env.AUTO_BET_MIN_TARGET_CENTI_X / 100)
      .max(env.AUTO_CASHOUT_MAX_X)
      .optional(),
  })
  .strict();
```

### Existing FE Zustand slice-per-concern (mirror for auto-bet store)
```typescript
// Source: frontend/src/stores/round.store.ts, bet.store.ts (Phase 7 P07-04)
// NEW Phase 9 (NO persist middleware):
import { create } from 'zustand';
import type { Money, MoneySnapshot } from '@crash/shared-kernel';

interface AutoBetConfig {
  target: Multiplier;
  strategy: 'fixed' | 'martingale';
  baseAmount: Money;
  stopLoss: Money;
  stopWin: Money;
}

interface AutoBetState {
  isRunning: boolean;
  config: AutoBetConfig | null;
  sessionPL: Money;
  lastBetAmount: Money | null;
  lastOutcome: 'win' | 'loss' | null;
  roundCount: number;
  halted: { reason: 'user' | 'stop-loss' | 'stop-win' | 'insufficient-balance' } | null;
  start: (config: AutoBetConfig) => void;
  stop: (reason?: AutoBetState['halted']) => void;
  recordOutcome: (outcome: 'win' | 'loss', amount: Money, payout: Money) => void;
}

export const useAutoBetStore = create<AutoBetState>((set) => ({
  // ... no persist, no localStorage, dies on reload (REQ-AUTO-04)
}));
```

## Runtime State Inventory

> Phase 9 is **additive** (new fields, new tables, new components) — NOT a rename/refactor. The Runtime State Inventory protocol applies only to rename phases per the agent spec, so this section is intentionally narrow. The only "state" Phase 9 introduces is:
>
> - **Stored data:** new `leaderboard_24h` table (created from scratch — no migration of pre-existing data); new `bets.auto_cashout_target_centi_x` column (nullable, defaults NULL on backfill — no data migration needed because the field is only meaningful for bets placed *after* the migration).
> - **Live service config:** new RabbitMQ queue `leaderboard-projector.q` (declared at boot by `@IdempotentSubscribe`'s `buildQuorumArgs` + bindings to `game.events`). Phase 5/6 `topology-defaults.ts` may need new exchange-binding constants if the planner wants centralized declaration; otherwise the decorator's own queue setup suffices.
> - **OS-registered state:** none.
> - **Secrets / env vars:** new env names (no secrets — all are numeric defaults). Existing code that reads env via `gamesEnvSchema.parse(process.env)` picks up the new keys automatically once the schema is extended.
> - **Build artifacts / installed packages:** one new shadcn registry block (`radio-group`) scaffolds `frontend/src/components/ui/radio-group.tsx`; no compiled artifacts.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 18 | `leaderboard_24h` table + `bets` column migration | ✓ (running in `bun run docker:up` stack) | 18 | — |
| RabbitMQ 4.2 | new `leaderboard-projector.q` quorum queue | ✓ (running) | 4.2-management | — |
| Keycloak 26.5 | `JwtGuard` on `GET /games/leaderboard` | ✓ (running) | 26.5 | — |
| Kong 3.9 | proxies `/games/leaderboard` via existing upstream | ✓ (running) | 3.9 | — |
| Bun 1.3.11+ | runs services + tests | ✓ | 1.3.11+ | — |
| Docker Compose (full stack) | SC1 disconnect E2E + chaos test | ✓ (existing `docker compose up`) | — | — |
| `socket.io-client` (test usage in SC1 E2E) | E2E disconnect test connects + force-closes | ✓ (already in frontend deps + test fixtures) | 4.8.x | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

> `workflow.nyquist_validation = true` (per `.planning/config.json`). Section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bun test (`bun:test`) for backend unit/integration/e2e; Vitest + jsdom for frontend (Phase 7/8 pattern, confirmed live across 168/168 FE tests as of P08-08) |
| Config file | Backend: `services/games/tests/setup.ts` + per-suite `*.test.ts`; Frontend: `frontend/vitest.config.ts` (Phase 7 P07-03) |
| Quick run command | Backend: `cd services/games && bun test tests/unit && bun test tests/integration/auto-cashout-tick.test.ts`; Frontend: `cd frontend && bunx vitest run src/features/auto-bet src/features/leaderboard src/components/auto-bet-form.test.tsx` |
| Full suite command | Backend: `cd services/games && bun test`; Frontend: `cd frontend && bunx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-AUTO-01 | Server cashes a disconnected client's bet at target | E2E (live docker) | `bun test services/games/tests/e2e/auto-cashout-disconnect.e2e.ts` | ❌ Wave 0 |
| REQ-AUTO-01 | Tick handler stamps `acceptedAt` first; passes `autoCashoutTarget` to CashOutUseCase | unit | `bun test services/games/tests/unit/auto-cashout-tick.spec.ts` | ❌ Wave 0 |
| REQ-AUTO-01 | DB query returns only ACTIVE bets where target ≤ ceiling | integration | `bun test services/games/tests/integration/auto-cashout-tick.test.ts` | ❌ Wave 0 |
| REQ-AUTO-02 | `nextBetAmount` returns base on win, 2× last on loss (martingale); same base on fixed | unit | `bunx vitest run frontend/src/features/auto-bet/strategy.test.ts` | ❌ Wave 0 |
| REQ-AUTO-03 | Driver halts on cumulative P/L ≤ -stopLoss or ≥ stopWin | unit | `bunx vitest run frontend/src/features/auto-bet/driver-stops.test.ts` | ❌ Wave 0 |
| REQ-AUTO-04 | Auto-bet store has no `persist` middleware; state resets on remount | unit | `bunx vitest run frontend/src/features/auto-bet/auto-bet.store.test.ts` | ❌ Wave 0 |
| REQ-AUTO-05 | BetPanel renders shadcn Tabs with Manual + Auto triggers; Auto form has 5 fields + Start/Stop | unit (RTL) | `bunx vitest run frontend/src/components/bet-panel.test.tsx` (extend existing) | ❌ Wave 0 |
| REQ-LEAD-01 | Leaderboard rows reflect 24h window; row > 24h does not appear | integration | `bun test services/games/tests/integration/leaderboard-projector.test.ts` | ❌ Wave 0 |
| REQ-LEAD-02 | Projector idempotent on redelivery of same envelope | integration | (same file as above; specific test case) | ❌ Wave 0 |
| REQ-LEAD-02 | Projector crash does NOT block bet settlement (chaos) | integration / e2e | `bun test services/games/tests/integration/leaderboard-projector-chaos.test.ts` | ❌ Wave 0 |
| REQ-LEAD-03 | GET /games/leaderboard returns ordered top-N with masked playerId + MoneySnapshot | integration | `bun test services/games/tests/integration/leaderboard-controller.test.ts` | ❌ Wave 0 |
| REQ-LEAD-04 | `leaderboard:updated` emits only when top-N ranks change | unit + integration | `bun test services/games/tests/unit/leaderboard-snapshot.test.ts` + `leaderboard-projector.test.ts` | ❌ Wave 0 |
| REQ-LEAD-04 | FE `LeaderboardPanel` updates when `leaderboard:updated` arrives | unit (RTL) | `bunx vitest run frontend/src/components/leaderboard-panel.test.tsx` | ❌ Wave 0 |
| Race | Cashout-race ±50ms property test extended for auto-cashout target | property | `bun test services/games/tests/property/auto-cashout-race.property.test.ts` | ❌ Wave 0 (optional, mirror P6.08) |

### Sampling Rate
- **Per task commit:** Run the unit suite for the touched layer (`bun test services/games/tests/unit` if backend touched; `bunx vitest run frontend/src/features/<feature>` if FE touched). <30s.
- **Per wave merge:** Run the integration suite for the touched layer (`bun test services/games/tests/integration` includes the new tests). <60s.
- **Phase gate:** Full suite green for both services + FE + the SC1 disconnect E2E against the live `bun run docker:up` stack before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `services/games/tests/e2e/auto-cashout-disconnect.e2e.ts` — SC1 disconnect proof (connect socket, force-close, poll GET /games/bets/me)
- [ ] `services/games/tests/integration/auto-cashout-tick.test.ts` — auto-cashout dispatches on tick crossing target
- [ ] `services/games/tests/integration/leaderboard-projector.test.ts` — projection correctness + idempotency
- [ ] `services/games/tests/integration/leaderboard-projector-chaos.test.ts` — projector down ⇒ bets still settle (SC5)
- [ ] `services/games/tests/integration/leaderboard-controller.test.ts` — GET happy path + masking
- [ ] `services/games/tests/unit/auto-cashout-tick.spec.ts` — first-line acceptedAt + multiplier honors target
- [ ] `services/games/tests/unit/leaderboard-snapshot.test.ts` — top-N diff pure function
- [ ] `services/games/tests/property/auto-cashout-race.property.test.ts` — ±50ms race window (optional)
- [ ] `frontend/src/features/auto-bet/strategy.test.ts` — fixed + martingale + base-reset-on-win
- [ ] `frontend/src/features/auto-bet/driver-stops.test.ts` — stop-loss / stop-win / insufficient-balance halts
- [ ] `frontend/src/features/auto-bet/auto-bet.store.test.ts` — no persist, state ephemeral
- [ ] `frontend/src/components/leaderboard-panel.test.tsx` — render top-N + own-row highlight + rank-up transition
- [ ] `frontend/src/components/auto-bet-form.test.tsx` — RadioGroup + Start/Stop + disabled-while-running

Framework install: none needed (Bun test + Vitest both already in place).

## Security Domain

> `security_enforcement` is enabled (no `false` override in `.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `JwtGuard` already protects `/games/*` routes (ADR-012); `GET /games/leaderboard` reuses the existing guard. WS handshake JWT validation (ADR-021/022) already covers the `leaderboard:updated` push. |
| V3 Session Management | yes | OIDC tokens via `oidc-spa` (ADR-024) — no Phase 9 changes. Auto-bet store is per-session in-memory, dies on reload (REQ-AUTO-04) — defensible as a "no state survives reload" guarantee. |
| V4 Access Control | yes | The leaderboard endpoint is authenticated but not authorized per-player (every authenticated player sees the same top-N). Player rows are masked (`playerIdMasked`, first 8 hex) — does NOT reveal full player UUIDs to other players. Own-row highlight is FE-only based on the authenticated player's own ID. |
| V5 Input Validation | yes | `nestjs-zod` validates `PlaceBetRequestDto.autoCashoutTarget` (positive number, within env bounds), `LeaderboardQueryDto.window` (Zod enum `'24h'` v1). FE inputs validated via shared `parseBetAmount` Money VO pattern (Phase 7 P07-05). |
| V6 Cryptography | no | No new crypto operations. The provably-fair primitive (ADR-015 / Phase 4) is untouched; auto-cashout reuses the existing deterministic crash-point derivation. |
| V7 Errors / Logging | yes | `WalletDebitedHandler` pattern (Phase 5) — every consumer logs to nest `Logger` with `consumerName` prefix + envelope `messageId` / `correlationId` from CLS. The new `LeaderboardProjectorService` MUST follow the same pattern. |
| V8 Data Protection | yes | `playerIdMasked` for lobby (existing Phase 6 pattern via `maskPlayerId` helper); leaderboard rows use the same mask. Own-row gets the full `playerId` only because the request is authenticated and the FE knows its own ID. |
| V9 Communication | yes | TLS via Kong in production-mode; local dev uses HTTP via the existing Docker Compose setup. |
| V10 Malicious Code | yes | No new third-party packages installed on the backend; one shadcn registry block on the FE (covered by §Package Legitimacy Audit). |
| V12 Files / Resources | n/a | No file I/O changes. |
| V13 API | yes | New `GET /games/leaderboard` follows existing REST conventions (Zod-validated query + DTO response + `JwtGuard`). `leaderboard:updated` WS event payload schema lands in `@crash/contracts/ws`. |

### Known Threat Patterns for Phase 9

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Player forges `autoCashoutTarget` outside bounds to win disproportionately | Tampering | Zod schema enforces `min` (env `AUTO_BET_MIN_TARGET_CENTI_X / 100`, default 1.01) and `max` (env `AUTO_CASHOUT_MAX_X`, default 100.00); request rejected with `400 Bad Request` before saga begins. |
| Player attempts cashout-race exploit via auto-cashout (server backdates timestamp) | Tampering | ADR-023 — `acceptedAt = new Date()` is the literal first executable line of the tick handler. Same invariant as manual cashout. ±50ms property test covers (Pitfall 2). |
| Projector consumer flooded with poison messages → DLQ overflow | DoS | `@IdempotentSubscribe` wires `buildQuorumArgs(5, 'game.dlx')` — after 5 redeliveries a poison message goes to DLQ; the existing `games-dead-letter.consumer.ts` (Phase 5) inspects DLQ. |
| Leaderboard query enumeration leaks per-player profit/loss | Information Disclosure | Top-N only (default 10) + masked playerId (first 8 hex of UUID per Phase 6 pattern). A player can derive their own row via their own ID; they cannot derive other players' full IDs from the mask. |
| Auto-bet driver fail-loop: insufficient balance → POST rejected → driver re-POSTs immediately | DoS (self-inflicted) | Driver checks `nextBet > balance` BEFORE POST and halts; the driver only POSTs at `round:settled` boundaries (one POST per round at most). |
| `leaderboard:updated` payload exceeds WS frame size with large top-N | DoS / availability | Top-N is bounded by `LEADERBOARD_TOP_N` (default 10) → payload ~1 KB; far below WS frame limits. |
| Auto-cashout race: tick fires for round R, but R already crashed in another tick handler | TOCTOU | `CashOutUseCase` already does `if (open.status !== 'RUNNING') throw` inside its TX; bet `tryTransition('ACTIVE', 'CASHED_OUT', ...)` returns `null` for already-settled bets; auto-cashout handler swallows both (Pitfall 11). |
| Replay attack: malicious actor replays a `bet.cashed_out` envelope from RabbitMQ to inflate leaderboard | Spoofing | `@IdempotentSubscribe` inbox dedupe by `messageId` makes redelivery a no-op (Pitfall 6 covers). RabbitMQ access is broker-trust within the Docker network (no external connectivity per Phase 5 design). |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 5 publishes `bet.refunded` to `game.events` with payload `{ betId, playerId, roundId, reason, amount }` | § "Leaderboard Projector" — routing keys | Projector misses refund events; net_profit calculation wrong on insufficient-funds / timeout paths. Verify in `services/games/src/infrastructure/messaging/` and Phase 5 outbox-writer paths. The `WsBridgeConsumer` already subscribes to this routing key (confirmed in `ws-bridge.consumer.ts:71`), so the event IS published. |
| A2 | Phase 5 publishes `round.settled` (or equivalent) to `game.events` carrying LOST bet info, OR the projector should subscribe to `bet.lost` events that may need new publish wiring in `SettleRoundUseCase` | § "Leaderboard Projector" — routing keys | If `round.settled` payload does not include per-bet LOST data, the projector cannot debit losing bets from net_profit. **Mitigation:** planner verifies in `services/games/src/application/use-cases/settle-round.use-case.ts` whether each LOST bet emits its own outbox event; if not, add a `bet.lost` publish per LOST bet inside `settleRound` TX (single TX = single saga step). The `RoundLoopService.settleRound` only emits `round:settled` in-process; the outbox path for per-bet LOST events is to verify. |
| A3 | The Bet aggregate's `cashOut(multiplier, time)` method accepts an arbitrary multiplier (not just the current tick value) and computes payout as `amount.multiplyRounded(multiplier)` | § "Auto-Cashout — multiplier value" | Verified in `bet.aggregate.ts:99-115`: yes, it does. Passing `bet.autoCashoutTarget` works as expected. CONFIRMED. |
| A4 | `EventEmitter2.@OnEvent({ async: true })` does not block the emitter when listeners are async | § "MultiplierBroadcastService event emit" | If emit blocks, the volatile tick rate drops under load. Verify with the existing Phase 6 `@OnEvent(GAME_EVENTS.ROUND_STARTED)` handlers — they are async and the broadcast loop has not regressed; treat as confirmed by precedent. |
| A5 | The `MikroBetRepository.tryTransition` raw-SQL `RETURNING *` path correctly hydrates `cashed_out_at` as a `Date` (not a string) under Bun's pg driver | § "Pitfall 1" | If it returns a string, the existing Phase 5 `CashOutUseCase` consumer of the result would have broken in Phase 6 — the fact that it didn't is suggestive but NOT proof. Planner should add a defensive assertion in the integration test for the auto-cashout path. The CONTEXT explicitly flags the raw-SQL `toDate()` defect as a pitfall (Phase 6 fix `439e5b4`), so the planner must add explicit `toDate()` coercion for any NEW raw-SQL timestamps the leaderboard projector or candidate query introduces. |
| A6 | Auto-cashout invokes `CashOutUseCase` with `playerId` taken from `bet.playerId`, NOT from a session; the JWT-authenticated player is irrelevant because the server is acting on behalf of the player | § "AutoCashoutTickService" implementation | If a `JwtGuard`-style check is mistakenly added inside `CashOutUseCase`, the auto-cashout path fails. Verified the use case takes `playerId` as a plain input (`cash-out.use-case.ts:21-25`). CONFIRMED. |
| A7 | Phase 5's outbox publishes `bet.cashed_out` to the `game.events` exchange with payload `{ betId, playerId, roundId, multiplier, payout: MoneySnapshot, cashedOutAt }` | § "Leaderboard Projector" — projection deltas | Verified via `WsBridgeConsumer.onBetCashedOut` schema (`ws-bridge.consumer.ts:35-44`) — payload includes the exact fields the projector needs. CONFIRMED. |
| A8 | The leaderboard projector lives inside the games-service binary (no separate service) | § Project Structure | Avoids a new Docker container + new env wiring. CONTEXT canonical-refs §"services/games/src/application/leaderboard-projector.service.ts" confirms — same service. CONFIRMED. |
| A9 | Phase 7's WS dispatcher pattern allows new subscribers to subscribe to events without modifying the dispatcher core | § "FE Auto-Bet Driver" + "Leaderboard Live Update" | If the dispatcher is closed (switch statement over a fixed set of types), Phase 9 must EXTEND it. Likely a one-line addition per event type. Planner verifies at `frontend/src/stores/ws-dispatch.ts` (or equivalent). |
| A10 | Default values for new env vars (planner confirms with user before locking): `LEADERBOARD_UPDATE_THROTTLE_MS=0` (effectively zero because the throttle is event-driven by `round.settled` + top-N diff), `STOP_LOSS_CENTS_MAX=10000000` (100,000 CRD ceiling — extremely generous for a play-money demo), `STOP_WIN_CENTS_MAX=10000000`, `AUTO_BET_MIN_TARGET_CENTI_X=101` (1.01x — must be > 1.00 because below 1.00x is unreachable per UI-SPEC §Component Inventory) | § "Env Vars" | These are educated defaults consistent with existing env conventions; planner should explicitly ask the user for confirmation in PLAN.md or carry them as Claude's-discretion defaults. |
| A11 | Auto-bet halt on `insufficient-balance` is the correct semantic when wallet balance < next bet amount, NOT a continuous retry | § "FE Auto-Bet Driver" + UI-SPEC Copywriting | Per UI-SPEC: `Auto-bet halted: insufficient balance for next round.` — explicit halt. CONFIRMED. |
| A12 | `LeaderboardSnapshot.diff(before, after)` compares ordered `playerId` arrays for top-N; a `playerId` swap at any rank → "changed" | § "Leaderboard Projector" | This is the obvious implementation; planner confirms whether reordering within ranks 1-3 is treated identically to reordering ranks 8-9. Recommendation: yes — any change in the ordered list is "changed". |

## Open Questions (RESOLVED)

1. **Should `bet.refunded` increment `total_bet_count` on the leaderboard?**
   - What we know: A refund means the player attempted a bet but it was rejected (insufficient funds or saga timeout). Money never moved or was returned. Win count is clearly 0. Net profit delta is 0.
   - What's unclear: Is a refunded bet a "placed bet" for stats purposes? It happened in time, but it wasn't a played round for that player.
   - **RESOLVED:** Do NOT increment `total_bet_count` on refund. Implemented in Plan 09-04 (`LeaderboardRepository.applyRefunded` is a no-op).

2. **Are LOST bets published as individual events or only inside `round.settled`?**
   - What we know: Phase 5's `SettleRoundUseCase` (file: `services/games/src/application/use-cases/settle-round.use-case.ts`) transitions LOST bets in batch and emits `round.settled`. The current outbox publishing pattern per-bet for cashed-out events is via `cash-out.use-case.ts`.
   - What's unclear: Without per-bet `bet.lost` events, the projector cannot subtract individual losing bet amounts from `net_profit`. The `round.settled` payload may not carry per-bet info.
   - **RESOLVED:** Add per-bet `bet.lost` outbox events inside `SettleRoundUseCase`'s TX (Option a — single outbox row per side-effect; Phase 5 idiom). Implemented in Plan 09-03 (Task 1: contract event in `@crash/contracts`; Task 2: per-LOST-bet outbox publish in `SettleRoundUseCase`).

3. **Auto-bet driver: when does the driver POST the NEXT bet — on `round:settled` or on the next `round:started`?**
   - What we know: A bet must be placed during BETTING. `round:settled` fires after CRASHED → before the next BETTING starts (within ~`COOLDOWN_MS=2000`). `round:started` fires when the next BETTING begins.
   - What's unclear: POST timing — posting on `round:settled` may race the cooldown; posting on `round:started` is unambiguously inside BETTING but adds one event-loop turn of latency.
   - **RESOLVED:** POST on `round:started`. Implemented in Plan 09-08 (Task 2: `useAutoBetDriver` subscribes to `round:started` and fires the POST inside the BETTING window).

4. **Should `leaderboard:updated` payload include the full top-N snapshot or just a "stale" pulse?**
   - What we know: Top-N is ~10 rows × ~50 bytes = ~500 bytes. Trivial.
   - What's unclear: Inline payload vs FE refetch on signal.
   - **RESOLVED:** Inline payload. Implemented in Plan 09-09 (Task 1: `useLeaderboard` subscribes to `leaderboard:updated` and inline-replaces the TanStack Query cache via `setQueryData` — no refetch).

5. **Should the auto-cashout candidate query lock the bet rows (`FOR UPDATE`)?**
   - What we know: `findAutoCashoutCandidates` returns rows. `CashOutUseCase.tryTransition('ACTIVE', 'CASHED_OUT', ...)` is the FSM-guarded UPDATE that actually transitions. Without `FOR UPDATE` in the candidate query, two consecutive tick handlers could both fetch the same candidate; both invoke `CashOutUseCase`; the second's `tryTransition` returns `null` (status is no longer ACTIVE), error swallowed. No double-cashout possible.
   - What's unclear: Performance — `FOR UPDATE SKIP LOCKED` may be slightly nicer at 30Hz scale.
   - **RESOLVED:** No `FOR UPDATE` on the candidate query — existing FSM-guarded `tryTransition` handles the race. Implemented in Plan 09-02 (`findAutoCashoutCandidates` raw-SQL query) + Plan 09-05 (`AutoCashoutTickService` invokes `CashOutUseCase` with FSM guard relied upon for double-fetch tolerance).

6. **Does the Auto tab need to be visible to unauthenticated users (preview/discoverability) or only after login?**
   - What we know: UI-SPEC §Surface A says "Auto tab is only shown to authenticated users (the Phase 7 `enforceLogin` guard already covers the game route)" — the game route as a whole requires login, so the question is moot.
   - **RESOLVED:** Implemented in 09-UI-SPEC §Surface A — Auto tab gated by the existing route-level `enforceLogin` guard from Phase 7; no Phase 9 code change required.


## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side auto-cashout (player browser decides when to cash) | Server-enforced auto-cashout (server compares each tick) | Standard since early Aviator clones (~2019) | Disconnect-safe. The recruiter-defensible answer. ADR-023 + CONTEXT D-06. |
| Auto-bet state on server (DB-persisted strategy config per player) | Per-session FE state (Zustand, no persist) | Phase 9 decision (D-01 + REQ-AUTO-04) | Simpler; no inter-session state for the recruiter to ask about; explicit "every reload is a fresh session" UX. Tradeoff: no auto-bet continuity across browser reloads, accepted. |
| Full event sourcing for leaderboard | Light CQRS with denormalized read model | Phase 9 decision (D-05) | Much simpler; no snapshot/projection machinery; the projector is one consumer + one table. |
| Per-tick `leaderboard:updated` emits | Round-settle throttle + top-N diff check | Phase 9 decision (D-04) | Avoids per-tick WS flood; "live" but bounded. |
| Hand-rolled outbox / inbox per service | `@crash/messaging-spine` workspace package with `@IdempotentSubscribe` | Phase 2 (already shipped) | Phase 9 projector inherits all reliability invariants for free. |

**Deprecated/outdated:**
- Trusting the client multiplier value at cashout time — never. ADR-023 forbids.
- `setInterval` for any tick or driver loop — never. Recursive `setTimeout` (ADR-017) or event subscription (Phase 9 driver) instead.

## Sources

### Primary (HIGH confidence — code in this repository)
- `services/games/src/application/round-loop.service.ts` (P4.06 + P6 fix `439e5b4`)
- `services/games/src/application/multiplier-broadcast.service.ts` (P6.04)
- `services/games/src/application/use-cases/cash-out.use-case.ts` (P5.06)
- `services/games/src/application/handlers/wallet-debited.handler.ts` (P5.05 — canonical `@IdempotentSubscribe` pattern)
- `services/games/src/presentation/dtos/place-bet.request.dto.ts` (current Phase 5 shape)
- `services/games/src/presentation/gateways/game-ws.gateway.ts` (P6.05 — `@OnEvent` lobby fan-out)
- `services/games/src/infrastructure/repositories/mikro-bet.repository.ts` (raw-SQL `tryTransition` + Phase 6 timestamp pitfall context)
- `services/games/src/infrastructure/messaging/ws-bridge.consumer.ts` (P6.06 — fan-out pattern)
- `services/games/src/domain/bet.aggregate.ts` (Bet aggregate — autoCashoutTarget field landing point)
- `services/games/src/config/defaults.ts` (env schema — `LEADERBOARD_WINDOW_HOURS=24`, `LEADERBOARD_TOP_N=10`, `AUTO_CASHOUT_MAX_X=100` already declared)
- `packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts` (canonical decorator)
- `packages/messaging-spine/src/topology/topology-defaults.ts` (`EXCHANGES`, `QUEUES`, `buildQuorumArgs`, `deriveDlxFromExchange`)
- `.planning/adrs/ADR-023-server-authoritative-cashout-accepted-at.md` (race-resolution invariant — explicitly references Phase 9)
- `.planning/research/STACK.md` §"Outbox/Inbox", §"WebSocket", §"NestJS"
- `.planning/research/ARCHITECTURE.md` §10 (CQRS — explicitly endorses leaderboard projector pattern + §4 (saga choice))
- `.planning/phases/09-auto-features-leaderboard/09-CONTEXT.md` (locked D-01..D-06)
- `.planning/phases/09-auto-features-leaderboard/09-UI-SPEC.md` (5 surfaces + env vars + locked shadcn install)
- `.planning/REQUIREMENTS.md` §"Auto Features" + §"Leaderboard" + §"Open Configuration Values"
- `.planning/ROADMAP.md` §"Phase 9: Auto Features & Leaderboard" + 5 success criteria
- `CLAUDE.md` (Money VO + no-hardcoded-constants + no-AI-attribution non-negotiables)

### Secondary (MEDIUM confidence — verified against multiple sources)
- microservices.io "Saga pattern" + "Idempotent Consumer" patterns
- microservices.io "Transactional Outbox" pattern
- @nestjs/event-emitter `@OnEvent({ async: true })` semantics — Phase 6 precedent + documented in nest docs

### Tertiary (LOW confidence — flag for validation)
- None — every claim in this research is grounded in either this repo's code or in artifacts explicitly cited from CONTEXT / UI-SPEC / REQUIREMENTS / STACK / ARCHITECTURE.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package is already in the workspace; one shadcn install only.
- Architecture (Option B + leaderboard projector via `@IdempotentSubscribe`): HIGH — patterns directly reuse Phase 2/5/6 primitives; CONTEXT canonical-refs explicitly endorses the AutoCashoutTickService split.
- Pitfalls: HIGH — Pitfalls 1, 2, 3, 6, 9, 11 are all grounded in shipped phase code + ADRs + observed Phase 6 defects.
- FE auto-bet driver: MEDIUM-HIGH — pattern mirrors Phase 7 dispatcher subscription; specific WS event names (round:settled, bet:my_cashed_out, bet:my_refunded) confirmed against existing `WsBridgeConsumer`.
- Leaderboard projector schema: MEDIUM — schema is a recommendation; planner confirms refund semantics + LOST event publication (Open Q1, Q2).

**Research date:** 2026-05-30
**Valid until:** 2026-06-29 (30 days — stable backend stack, no new library churn expected). Confidence drops if Phase 5 `SettleRoundUseCase` is changed to bulk-publish LOST events differently.
