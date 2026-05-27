# Phase 6: WebSocket Gateway & Multiplier Sync — Research

**Researched:** 2026-05-27
**Domain:** Server-authoritative real-time WebSocket gateway over Socket.IO 4.8 + NestJS 11
**Confidence:** HIGH (Socket.IO patterns canonical, NestJS adapter pattern verified, Kong WS upgrade documented; MEDIUM on the outbox→WS bridge architecture choice — Claude's discretion area)

---

## Summary

Phase 6 wires a single `GameWsGateway` into the existing `games-service` NestJS app, mounted at `/ws` and fronted by Kong, that broadcasts the server-authoritative round lifecycle and 30 Hz multiplier ticks to all clients while pushing per-player private events (bet status, balance) on a dedicated `user:{playerId}` room. The heavy lifting is mechanical because every primitive is already in place: `RoundLoopService.getMultiplierAt(at)` returns the synchronous server-clock multiplier (Phase 5 plan 05-02), `JwtGuard` already implements the cached-JWKS validation that the WS handshake will share via a new `JwtVerifierService` extraction, the outbox publishes `bet.active`/`bet.refunded`/`bet.cashed_out` to `game.events`, and the controller cashout endpoint already server-stamps `acceptedAt` as its first executable line.

What's actually new in this phase is (1) a custom `JwtIoAdapter` extending `@nestjs/platform-socket.io`'s `IoAdapter` that injects an `io.use(...)` middleware to validate JWTs at upgrade, (2) a `MultiplierBroadcastService` running an independent 33 ms recursive-setTimeout loop pulling from `RoundLoopService.getMultiplierAt(now)` and emitting `round:tick` via `volatile.emit` to the `lobby` room, (3) hooks from `RoundLoopService` state transitions (BETTING/RUNNING/CRASHED/SETTLED) into the gateway via NestJS `EventEmitter2` to avoid a circular dependency, (4) a `WsBridgeConsumer` subscribing to `game.events` exchange so the outbox remains the single source of truth and the gateway emits to the right WS room based on the AMQP envelope's correlationId/playerId, and (5) Kong WS upgrade routing via a new `~/ws` route. ADR-021 locks single global lobby over per-round rooms, ADR-022 locks 30 Hz server / 60 fps client interpolation, ADR-023 locks server-authoritative `cashoutAcceptedAt` (already implemented at controller — ADR codifies the invariant for WS handlers if any future inbound message is added).

**Primary recommendation:** Implement the gateway as a thin presentation-layer fan-out — DO NOT inject domain repositories into it. The gateway listens to internal NestJS events from `RoundLoopService` and to AMQP events from the outbox via `WsBridgeConsumer`; domain logic stays where it is. Use `volatile.emit` ONLY for `round:tick`; all other events (lifecycle, bet events, snapshot) use regular `emit`. REQ-AUTH-01/02/03 (OIDC PKCE, silent renew, BroadcastChannel) are frontend concerns deferred to Phase 7 — Phase 6 only delivers the BACKEND side that REQ-AUTH-04 (cached JWKS validation) already covers, now extended to the WS handshake.

---

## User Constraints

> No CONTEXT.md exists for Phase 6 (no `/gsd:discuss-phase 6` was run yet — orchestrator drove direct research). The following constraints come from the orchestrator brief + the locked decisions in PROJECT.md, REQUIREMENTS.md, ROADMAP.md, and the research files. The planner MUST treat these as locked.

### Locked Decisions (from research synthesis + Roadmap + global CLAUDE.md)

- **Stack**: Socket.IO 4.8.x via `@nestjs/websockets@^11.1.21` + `@nestjs/platform-socket.io@^11.1.21` (locked in STACK §2.3, ROADMAP Phase 6).
- **JWT validation library**: `jose@6.2.3` (already in `services/games/package.json`); reuse via shared `JwtVerifierService` extracted from `JwtGuard`. `createRemoteJWKSet` cache parameters (`cacheMaxAge: 600_000`, `cooldownDuration: 30_000`) carry forward unchanged.
- **Room model**: single global `lobby` + `user:{playerId}` (ROADMAP Phase 6 → ADR-021, ARCHITECTURE §7.2, SUMMARY §8). NO per-round rooms.
- **Tick rate**: 30 Hz server emit (every 33 ms), 60 fps client interpolation via rAF (SUMMARY §8 conflict resolution, REQ-WS-06).
- **Cashout race authority**: server-authoritative timestamp captured as the first line of the inbound handler. Already satisfied by `bet-command.controller.ts:69`; ADR-023 codifies the invariant for any future inbound WS message.
- **`volatile.emit` for ticks only** (REQ-WS-06). Lifecycle events, snapshots, bet feed all use regular `emit`.
- **Outbox stays the source of truth**: bet events flow through `game.events` exchange. WS gateway consumes from the outbox-published events, not from in-memory hooks that bypass the outbox.
- **CLAUDE.md hard rules**: no float math anywhere; no `number` types on money symbols; Money VO with bigint cents over the wire as `{amount, currency, scale}`; no AI fingerprints in commits; no emojis in code; rich aggregates only; one aggregate per transaction; no hardcoded business constants (all from env).
- **Kong perimeter**: must add WS upgrade route. JWT plugin stays OFF — gateway validates JWT itself.
- **REQ-WS-05 wording vs. reality**: The requirement literally says "stamped at gateway middleware." In practice, cashout is a `POST /games/bet/cashout` HTTP endpoint, not a WS message; the "gateway" interpretation is the NestJS controller layer. Phase 5 already implements this (`acceptedAt = new Date()` at line 69 of `bet-command.controller.ts`, before any `await`). Phase 6 does NOT migrate cashout to a WS message; ADR-023 documents the existing HTTP-controller-as-gateway interpretation explicitly.

### Claude's Discretion

- **Outbox → WS bridge mechanism**: Two viable options surfaced in §5 below — (a) direct injection of the gateway into existing handlers (`WalletDebitedHandler` etc.), or (b) a dedicated `WsBridgeConsumer` subscribing to `game.events`. Research recommends (b) but the planner may override after discussion. Discretion is bounded: whichever is chosen, the outbox MUST remain the source of truth — no WS emit without a persisted outbox row.
- **Domain event hook into gateway from `RoundLoopService`**: NestJS `EventEmitter2` (in-process pub/sub) vs. direct gateway injection with `forwardRef`. Research recommends `EventEmitter2` (looser coupling, easier to test). Either is acceptable.
- **Internal event payload shape**: the wire-format payloads in §4 are locked by REQ-WS-03; the internal event-bus payloads are an implementation detail.
- **Bet feed playerId masking strategy**: research recommends `sha256(playerId).slice(0,8)` consistent with existing `GET /games/rounds/current` masking (Phase 4 plan 04-08). Alternative: server-issued short ephemeral aliases. Stick with the existing pattern unless the planner has cause to revisit.

### Deferred Ideas (OUT OF SCOPE for Phase 6)

- **Frontend OIDC implementation (REQ-AUTH-01/02/03)**: oidc-spa wiring, silent token renewal iframe, BroadcastChannel multi-tab coordination — all live in Phase 7. Phase 6 only proves the BACKEND can validate a real Keycloak JWT at WS handshake (`scripts/smoke-health.sh` will use a password-grant token from Keycloak directly, same as Phase 4 plan 04-10 helpers).
- **Frontend WS client reconnect logic (REQ-WS-07)**: Socket.IO's built-in reconnection handles backoff; Phase 7 wires the snapshot consumer on `connect` events. Phase 6 only ensures the SERVER answers a `round:snapshot` correctly to any (re)connecting socket — the client reconnect ladder is FE work.
- **Auto-cashout server enforcement (REQ-AUTO-01)**: Phase 9. The 30 Hz tick loop in Phase 6 is the foundation that Phase 9 will subscribe to in-process.
- **Leaderboard projector (`leaderboard:updated` event)**: Phase 9. The gateway will be extensible for it, but no `leaderboard:*` events ship in Phase 6.
- **Replay round events (REQ-REPLAY-*)**: Phase 8.
- **Token re-validation mid-connection**: Out of scope per PITFALLS H4 — Phase 7 handles via FE silent refresh + reconnect; if FE doesn't refresh, server disconnects on expiry. Phase 6 does NOT implement `auth:refresh` control-frame plumbing.
- **OpenTelemetry instrumentation of WS spans**: Phase 10.
- **Redis adapter for horizontal scaling**: ARCHITECTURE §7.5 explicitly defers.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-AUTH-01 | OIDC Authorization Code + PKCE (S256) via oidc-spa | Phase 7 frontend — out of scope for Phase 6 backend [DEFERRED] |
| REQ-AUTH-02 | Token persistence + silent renewal | Phase 7 frontend — out of scope for Phase 6 backend [DEFERRED] |
| REQ-AUTH-03 | `BroadcastChannel`-coordinated multi-tab refresh | Phase 7 frontend — out of scope for Phase 6 backend [DEFERRED] |
| REQ-WS-01 | JWT-at-handshake via custom Socket.IO IoAdapter | §3 JwtIoAdapter — extracts `JwtVerifierService` from existing `JwtGuard`; `io.use()` middleware verifies via cached JWKS at upgrade |
| REQ-WS-02 | Sockets joined to `lobby` + `user:{playerId}` | §4 Room model — `handleConnection` auto-joins both rooms; ADR-021 locks single-lobby |
| REQ-WS-03 | Round + bet + cashout server→client events | §5 Event catalog — full S→C event table per REQ-WS-03 wording |
| REQ-WS-04 | `round:snapshot` on connect / reconnect | §7 Snapshot handler — fetches current round + active bets + (if authenticated) own bet, emits once per `handleConnection` |
| REQ-WS-05 | `cashoutAcceptedAt` stamped at gateway middleware | §8 Cashout race — already satisfied at controller line 69 (Phase 5); ADR-023 codifies invariant |
| REQ-WS-06 | `volatile.emit` for ticks (slow-consumer-safe) | §6 MultiplierBroadcastService — `server.to('lobby').volatile.emit('round:tick', ...)` on 33ms recursive setTimeout |
| REQ-WS-07 | Client reconnect with exponential backoff + resync | Socket.IO default reconnection + server `round:snapshot` on each `handleConnection`; FE wiring in Phase 7 |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| JWT validation at WS upgrade | API / Backend | — | Auth must happen before connection establishes; cannot trust client to assert identity post-upgrade. Already part of Phase 3 closure (REQ-AUTH-04). |
| Round lifecycle event emission | API / Backend (`RoundLoopService` → `EventEmitter2` → gateway) | — | Single in-process source of truth for round state; gateway is a thin fan-out. |
| 30 Hz multiplier tick generation | API / Backend (`MultiplierBroadcastService` recursive setTimeout) | — | Server is canonical authority per PITFALLS C2 / H1. |
| 60 fps client multiplier rendering | Browser / Client | — | Phase 7 — rAF + EWMA clock-offset reconciliation. Out of scope for Phase 6. |
| Cashout-vs-crash race resolution | API / Backend (HTTP controller server-clock) | — | Already implemented at `bet-command.controller.ts:69`; ADR-023 documents. |
| Outbox-to-WS event bridging | API / Backend (`WsBridgeConsumer` on `game.events`) | — | Outbox remains source of truth (CLAUDE.md); WS reads from it. |
| Snapshot-on-reconnect | API / Backend (gateway `handleConnection`) | Database / Storage (round + bet queries) | Gateway calls into application use cases (`GetCurrentRoundUseCase`, `GetPlayerActiveBetsUseCase`) — does not bypass DDD layering. |
| WS upgrade routing | API Gateway (Kong) | — | Kong proxies `/ws` upgrade to `games:4001`; declarative `kong.yml` route. |
| Per-tab token rotation | Browser / Client (BroadcastChannel) | — | Phase 7 — deferred. |
| Reconnect backoff ladder | Browser / Client (Socket.IO client default) | — | Phase 7 wires; server-side only needs the snapshot handler. |

---

## Project Constraints (from CLAUDE.md)

- **Money**: never `number` for amounts; always `Money` VO with bigint cents; over the wire as `{amount: string, currency, scale}`. WS event payloads carrying money values MUST follow this format. Postgres columns `BIGINT` or `NUMERIC(20,2)`.
- **Domain layer**: zero infrastructure imports. The gateway lives in `presentation/`, NOT `domain/`. Domain events flow via `EventEmitter2` (`@nestjs/event-emitter`) — gateway subscribes, domain does not depend on gateway.
- **Rich aggregates**: no anemic rows. The `Round.acceptBet(now)` method already enforces — gateway must not bypass aggregates for any state transition.
- **One aggregate per transaction**: gateway does not write to DB. Reads only (snapshot fetch). All writes flow through existing use cases (`PlaceBetUseCase`, `CashOutUseCase`).
- **No hardcoded business constants**: `SERVER_TICK_HZ` already in `.env.example` (default 30); reuse via `env.SERVER_TICK_HZ`. Derive `tickIntervalMs = 1000 / env.SERVER_TICK_HZ`. WS path `/ws` is a stable protocol surface — acceptable to inline as a const, but pin in `defaults.ts` for consistency (`env.WS_PATH = "/ws"`).
- **Tests**: Bun test runner; property tests via `fast-check@^3.23.0` for the cashout race window; integration tests via `Test.createTestingModule({imports:[AppModule]})` + real Socket.IO client.
- **Saga / messaging**: every domain event has the standard envelope; outbox row + state change in same TX; gateway emits to WS only AFTER the outbox row is published (consumes from `game.events` via `WsBridgeConsumer`).
- **WebSocket** (verbatim from CLAUDE.md): JWT validated at handshake (cached JWKS); no mid-connection re-auth; server-authoritative `cashoutAcceptedAt` computed at the inbound handler, before any await; ticks emitted as `volatile.emit`. All four requirements directly addressed by §3, §6, §8.
- **Commits**: atomic per logical change; conventional prefixes (`feat:`, `fix:`, `docs:`); no AI attribution.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/websockets` | `^11.1.21` | NestJS WS module + decorators (`@WebSocketGateway`, `@SubscribeMessage`, `@WebSocketServer`) | First-class NestJS support; aligns with existing `@nestjs/common@^11.1.21` baseline [VERIFIED: package.json + STACK §2.3] |
| `@nestjs/platform-socket.io` | `^11.1.21` | Socket.IO platform adapter for NestJS; provides `IoAdapter` base class | Required to use Socket.IO under NestJS WS abstraction [VERIFIED: STACK §2.3] |
| `socket.io` | `^4.8.1` | Underlying WS server (rooms, namespaces, ack, volatile.emit, auto-reconnect) | Stack already locked; 4.8.x verified compatible with NestJS 11.1.x [VERIFIED: STACK §2.3] |
| `@nestjs/event-emitter` | `^3.0.0` | In-process pub/sub bridging `RoundLoopService` → `GameWsGateway` without circular DI | Avoids `forwardRef` between gateway and round loop; standard NestJS pattern [CITED: https://docs.nestjs.com/techniques/events] |
| `jose` | `6.2.3` | JWKS verification (already in deps) | Reused via extracted `JwtVerifierService` from existing `JwtGuard` [VERIFIED: package.json line 29] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@golevelup/nestjs-rabbitmq` | `^9.0.2` (already in deps) | `@RabbitSubscribe` ergonomics for `WsBridgeConsumer` on `game.events` exchange | When implementing outbox-driven WS event bridging |
| `nestjs-cls` | `^6.2.0` (already in deps) | Per-request CLS scope for correlationId propagation through WS handlers if needed | Optional — only if `correlationId` needs to flow into a WS handler trace |
| `socket.io-client` | `^4.8.1` (devDependency) | Integration-test client | When writing integration tests under `tests/integration/` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `socket.io@4.8` | Native `ws` (raw WebSocket) | Lose rooms, broadcasts, ack semantics, volatile.emit, auto-reconnect — would re-implement; rejected per STACK §2.3 |
| `socket.io@4.8` | `uWebSockets.js` (uWS) | 5-10× throughput but irrelevant at challenge scale; third-party NestJS adapter; no server-side reconnect concept; rejected per STACK §2.3 |
| `@nestjs/event-emitter` | Direct `forwardRef(() => GameWsGateway)` in `RoundLoopService` | Tight coupling; harder to mock in tests; weaker layering; rejected (Claude's discretion) |
| `WsBridgeConsumer` from `game.events` | Direct gateway injection into `WalletDebitedHandler` / `CashOutUseCase` | Bypasses outbox-as-source-of-truth invariant from Phase 2 ADR-007; on WS slow consumer the event is lost; rejected |

**Installation:**
```bash
cd services/games && bun add @nestjs/websockets@^11.1.21 @nestjs/platform-socket.io@^11.1.21 socket.io@^4.8.1 @nestjs/event-emitter@^3.0.0
bun add -d socket.io-client@^4.8.1
```

**Version verification:** Versions above match the existing `@nestjs/*@^11.1.21` baseline already pinned in `services/games/package.json` (lines 18-26). `socket.io@4.8.x` is confirmed compatible with NestJS 11.1 in STACK §2.3 and SUMMARY §2. The planner must run `npm view <pkg> version` against each before committing to lock the exact patch level.

---

## Package Legitimacy Audit

> All packages listed are already part of the locked stack (STACK.md) or already installed in `services/games/package.json`. slopcheck was not available at research time, so packages new to this phase are tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task before `bun add`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@nestjs/websockets` | npm | 6+ yrs | several million/wk | github.com/nestjs/nest | unavailable | Approved (already in NestJS monorepo) [ASSUMED — verify before install] |
| `@nestjs/platform-socket.io` | npm | 6+ yrs | several million/wk | github.com/nestjs/nest | unavailable | Approved (already in NestJS monorepo) [ASSUMED — verify before install] |
| `socket.io` | npm | 13+ yrs | 7M+/wk | github.com/socketio/socket.io | unavailable | Approved (canonical) [ASSUMED — verify before install] |
| `socket.io-client` | npm | 13+ yrs | 8M+/wk | github.com/socketio/socket.io-client | unavailable | Approved (canonical) [ASSUMED — verify before install] |
| `@nestjs/event-emitter` | npm | 5+ yrs | 1M+/wk | github.com/nestjs/event-emitter | unavailable | Approved (official @nestjs/* scope) [ASSUMED — verify before install] |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time. All five new packages above MUST be gated behind a `checkpoint:human-verify` task in the plan (verify via `npm view <pkg> repository` against the GitHub URL listed above) before the `bun add` task executes.*

---

## Architecture Patterns

### System Architecture Diagram

```
                           ┌──────────────┐
                  HTTP/WS  │ Browser (FE) │ (Phase 7)
                           └──────┬───────┘
                                  │  WSS handshake: Authorization: Bearer <kc-token>
                                  ▼
                           ┌──────────────┐
                           │ Kong 3.9     │  /ws → games:4001 (NEW route in kong.yml)
                           └──────┬───────┘     /games/* (existing)
                                  │
                                  ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                  games-service (NestJS 11, :4001)               │
        │                                                                 │
        │  ┌─ presentation ──────────────────────────────────────────┐   │
        │  │  GameWsGateway (path: /ws)                              │   │
        │  │   • handleConnection(socket)                            │   │
        │  │       → socket.join('lobby')                            │   │
        │  │       → socket.join(`user:${socket.data.playerId}`)     │   │
        │  │       → emit('round:snapshot', {round, activeBets, my?})│   │
        │  │   • OnEvent('round.started') → broadcast                │   │
        │  │   • OnEvent('round.running') → broadcast                │   │
        │  │   • OnEvent('round.crashed') → broadcast                │   │
        │  │   • OnEvent('round.settled') → broadcast                │   │
        │  │                                                         │   │
        │  │  JwtIoAdapter extends IoAdapter                         │   │
        │  │   • io.use(async (s, next) => verify JWT then next())   │   │
        │  │   • sets socket.data.playerId on success                │   │
        │  │                                                         │   │
        │  │  BetCommandController (Phase 5 — unchanged)             │   │
        │  │   • POST /games/bet/cashout — acceptedAt at line 69     │   │
        │  └─────────────────────────────────────────────────────────┘   │
        │                                                                 │
        │  ┌─ application ───────────────────────────────────────────┐   │
        │  │  RoundLoopService (Phase 5 — emits domain events)       │   │
        │  │   • on BETTING start → emit 'round.started'             │   │
        │  │   • on RUNNING start → emit 'round.running'             │   │
        │  │   •                  → MultiplierBroadcastService.start │   │
        │  │   • on CRASHED      → MultiplierBroadcastService.stop   │   │
        │  │                     → emit 'round.crashed'              │   │
        │  │   • on SETTLED      → emit 'round.settled'              │   │
        │  │                                                         │   │
        │  │  MultiplierBroadcastService (NEW)                       │   │
        │  │   • recursive setTimeout(33ms) loop while RUNNING       │   │
        │  │   • each tick: roundLoop.getMultiplierAt(new Date())    │   │
        │  │   •            server.to('lobby').volatile.emit(...)    │   │
        │  │                                                         │   │
        │  │  WsBridgeConsumer (NEW, @RabbitSubscribe game.events)   │   │
        │  │   • bet.active → emit to user:{playerId} + lobby        │   │
        │  │   • bet.refunded → emit to user:{playerId}              │   │
        │  │   • bet.cashed_out → emit to user:{playerId} + lobby    │   │
        │  └─────────────────────────────────────────────────────────┘   │
        │                                                                 │
        │  ┌─ shared (NEW) ──────────────────────────────────────────┐   │
        │  │  JwtVerifierService                                     │   │
        │  │   • verify(token): Promise<{playerId, tokenExp}>        │   │
        │  │   • shared by JwtGuard (HTTP) + JwtIoAdapter (WS)       │   │
        │  └─────────────────────────────────────────────────────────┘   │
        └─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                      ┌───────────────────────┐
                      │ RabbitMQ game.events  │  (Phase 2/5 — unchanged)
                      └───────────────────────┘
```

Component responsibilities:

| Component | File (target) | Responsibility |
|-----------|---------------|----------------|
| `GameWsGateway` | `services/games/src/presentation/gateways/game-ws.gateway.ts` | Mount `/ws`; handle connection/disconnect; auto-join rooms; emit `round:snapshot`; subscribe via `@OnEvent` to round lifecycle events from `RoundLoopService` and broadcast to lobby |
| `JwtIoAdapter` | `services/games/src/presentation/adapters/jwt-io.adapter.ts` | Extend `IoAdapter`; override `createIOServer` to inject `io.use(...)` JWT-verification middleware; sets `socket.data.playerId` |
| `JwtVerifierService` | `services/games/src/presentation/auth/jwt-verifier.service.ts` | Pure verification service (extracted from `JwtGuard`); used by both HTTP `JwtGuard` and the WS adapter |
| `MultiplierBroadcastService` | `services/games/src/application/multiplier-broadcast.service.ts` | Recursive `setTimeout(33ms)` while round RUNNING; pulls multiplier from `RoundLoopService.getMultiplierAt(now)`; emits `round:tick` via `volatile.emit` to `lobby` |
| `WsBridgeConsumer` | `services/games/src/infrastructure/messaging/ws-bridge.consumer.ts` | `@RabbitSubscribe` to `game.events`; routes by `routingKey` to the right WS emit (lobby vs user:{id}) |
| `WsSnapshotAssembler` | `services/games/src/application/use-cases/get-ws-snapshot.use-case.ts` | Pure use case: fetches current round + non-self-masked active bets + (if authenticated) the player's own bet; assembles snapshot payload |
| `RoundLoopService` (existing) | `services/games/src/application/round-loop.service.ts` | Phase 5 file. Modified to `EventEmitter2.emit('round.started' | 'round.running' | 'round.crashed' | 'round.settled')` at each transition and to call `multiplierBroadcastService.start/stop()` on RUNNING/CRASHED. |
| `BetCommandController` (existing) | `services/games/src/presentation/controllers/bet-command.controller.ts` | UNCHANGED. Cashout `acceptedAt` at line 69 already satisfies REQ-WS-05; ADR-023 codifies the pattern. |
| `kong.yml` (existing) | `docker/kong/kong.yml` | Add a `games-ws` route on `~/ws$` with `protocols: [http, https]` so Kong forwards Connection/Upgrade headers per Kong WS docs. |

### Recommended Project Structure (delta)

```
services/games/src/
├── application/
│   ├── round-loop.service.ts            # MODIFIED — emit lifecycle events
│   ├── multiplier-broadcast.service.ts  # NEW
│   ├── game-core.module.ts              # MODIFIED — register new providers
│   └── use-cases/
│       └── get-ws-snapshot.use-case.ts   # NEW
├── infrastructure/messaging/
│   └── ws-bridge.consumer.ts             # NEW
├── presentation/
│   ├── adapters/
│   │   └── jwt-io.adapter.ts             # NEW
│   ├── auth/
│   │   └── jwt-verifier.service.ts       # NEW (extracted from guards/jwt.guard.ts)
│   ├── gateways/
│   │   └── game-ws.gateway.ts            # NEW
│   ├── guards/
│   │   └── jwt.guard.ts                  # MODIFIED — delegates to JwtVerifierService
│   └── dtos/
│       └── ws-event.payloads.ts          # NEW — zod schemas for outbound payloads
└── main.ts                               # MODIFIED — app.useWebSocketAdapter(new JwtIoAdapter(app, jwtVerifier))
```

### Pattern 1: Custom IoAdapter with handshake JWT middleware

**What:** A NestJS `IoAdapter` subclass that intercepts `createIOServer` to attach an `io.use(middleware)` chain that runs before the connection handler. The middleware verifies the JWT and either calls `next()` (success — connection proceeds) or `next(new Error(...))` (failure — client gets a `connect_error` event and the connection is rejected at upgrade).

**When to use:** Any WS surface that needs handshake-time authentication. This is the canonical NestJS+Socket.IO pattern for JWT at handshake — verified by official NestJS GitHub issue [#1059](https://github.com/nestjs/nest/issues/1059) and Socket.IO middleware docs.

**Example (verified against Socket.IO 4.8 middleware API + NestJS 11 IoAdapter):**
```typescript
// Source: NestJS docs + Socket.IO middleware pattern [CITED: https://docs.nestjs.com/websockets/adapter + https://socket.io/docs/v4/middlewares/]
import { IoAdapter } from "@nestjs/platform-socket.io";
import { INestApplicationContext } from "@nestjs/common";
import { ServerOptions, Server } from "socket.io";
import { JwtVerifierService } from "../auth/jwt-verifier.service";

export class JwtIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly verifier: JwtVerifierService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    server.use(async (socket, next) => {
      try {
        const token = this.extractToken(socket);
        if (!token) return next(new Error("UNAUTHORIZED"));
        const { playerId, tokenExp } = await this.verifier.verify(token);
        socket.data.playerId = playerId;
        socket.data.tokenExp = tokenExp;
        return next();
      } catch (err) {
        return next(new Error("UNAUTHORIZED"));
      }
    });
    return server;
  }

  private extractToken(socket: any): string | undefined {
    const auth = socket.handshake?.auth?.token;
    if (typeof auth === "string" && auth.length > 0) return auth;
    const header = socket.handshake?.headers?.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice(7).trim();
    }
    return undefined;
  }
}
```

Wired in `main.ts`:
```typescript
const app = await NestFactory.create(AppModule);
const verifier = app.get(JwtVerifierService);
app.useWebSocketAdapter(new JwtIoAdapter(app, verifier));
await app.listen(env.PORT, "0.0.0.0");
```

### Pattern 2: Gateway with `@OnEvent` handlers fed by `EventEmitter2`

**What:** The gateway lives in the presentation layer. To avoid a circular dependency between the gateway and `RoundLoopService`, the round loop emits in-process events via NestJS `@nestjs/event-emitter`; the gateway subscribes via `@OnEvent('round.started')` etc. and translates each into a Socket.IO broadcast.

**When to use:** Any time a domain/application service needs to fan-out into a presentation-layer concern without inverting the dependency direction.

**Example:**
```typescript
// Source: NestJS event-emitter docs [CITED: https://docs.nestjs.com/techniques/events]
@WebSocketGateway({ path: "/ws", cors: { origin: env.CORS_ORIGIN ?? true, credentials: true } })
export class GameWsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(private readonly snapshot: GetWsSnapshotUseCase) {}

  async handleConnection(socket: Socket): Promise<void> {
    const playerId = socket.data.playerId as string;
    socket.join("lobby");
    socket.join(`user:${playerId}`);
    const snap = await this.snapshot.execute(playerId);
    socket.emit("round:snapshot", snap);
  }

  handleDisconnect(_socket: Socket): void {
    // No-op — Socket.IO leaves rooms automatically; no in-memory state to clean.
  }

  @OnEvent("round.started")
  onRoundStarted(payload: RoundStartedPayload): void {
    this.server.to("lobby").emit("round:started", payload);
  }
  // …round.running, round.crashed, round.settled equivalent
}
```

### Pattern 3: Recursive `setTimeout` for the 30 Hz tick loop (ADR-017 pattern reused)

**What:** Same pattern Phase 4 plan 04-06 used for `RoundLoopService` — recursive `setTimeout` rather than `setInterval`. Drift-free under load (skips gracefully if a tick takes >33 ms instead of queuing missed ticks).

**Example:**
```typescript
@Injectable()
export class MultiplierBroadcastService {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly intervalMs = Math.round(1000 / env.SERVER_TICK_HZ); // 33ms at 30Hz

  constructor(
    private readonly roundLoop: RoundLoopService,
    @Inject(WS_SERVER) private readonly server: Server,
  ) {}

  start(roundId: string): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(roundId);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private scheduleNext(roundId: string): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      try {
        const now = new Date();
        const m = this.roundLoop.getMultiplierAt(now);
        this.server.to("lobby").volatile.emit("round:tick", {
          roundId,
          multiplier: m.toNumber(),
          t: now.getTime(),
        });
      } catch {
        // Round transitioned out of RUNNING between the schedule and the fire — drop tick.
      }
      this.scheduleNext(roundId);
    }, this.intervalMs);
  }
}
```

### Anti-Patterns to Avoid

- **Injecting `GameWsGateway` into `RoundLoopService` directly with `forwardRef`**: creates a cycle, hard to test in isolation. Use `EventEmitter2` instead.
- **`setInterval(emit, 33)` for the tick loop**: drifts under load per PITFALLS H1 + ADR-017. Use recursive setTimeout.
- **Emitting bet events from `WalletDebitedHandler` directly to the gateway**: bypasses the outbox-as-source-of-truth invariant (Phase 2 ADR-007). Use `WsBridgeConsumer` reading from `game.events`.
- **Using `volatile.emit` for lifecycle events** (round:started, round:crashed, round:snapshot, bet:*): these are NOT okay to drop; only `round:tick` may be lost (REQ-WS-06). Volatile drops on slow consumers are part of the spec for ticks but a bug for everything else. [CITED: https://socket.io/docs/v4/server-api/]
- **Putting business logic in `handleConnection`**: gateway is a thin fan-out. Snapshot assembly belongs in a `GetWsSnapshotUseCase`.
- **Trusting `socket.handshake.query.token`**: per PITFALLS H3, query params end up in proxy logs. Use `auth.token` payload OR `Authorization` header.
- **Mid-connection re-auth via `auth:refresh` control frame**: deferred to Phase 7 per Deferred Ideas. Phase 6 expires connections at token TTL.
- **Per-round room (`round:{roundId}`)**: ADR-021 explicitly forbids — adds join/leave churn every ~10s with zero scoping benefit (only one round at a time). Single `lobby` only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WS connection lifecycle | Custom HTTP-upgrade handshake | `@nestjs/platform-socket.io` + `socket.io@4.8` | Rooms, broadcasts, ack, volatile.emit, reconnect — all in 1 dep |
| Cached JWKS validation | Manual JWKS fetch + cache | `jose@6.2.3` `createRemoteJWKSet({cacheMaxAge, cooldownDuration})` | Already in use by `JwtGuard`; reuse |
| In-process pub/sub between services | EventEmitter pattern hand-rolled with arrays | `@nestjs/event-emitter@^3.0.0` (`EventEmitter2` based) | Type-safe, NestJS-native; `@OnEvent` decorator avoids boilerplate |
| Multi-instance Socket.IO scaling | Redis bridge yourself | `@socket.io/redis-adapter` — DEFERRED to Phase 10 if at all | Out of scope per Deferred Ideas |
| Cashout race resolution | Per-request timestamp comparison in DB query | Server-clock `acceptedAt = new Date()` as first executable line + `RoundLoopService.getMultiplierAt(acceptedAt)` | Already implemented Phase 5; ADR-023 codifies |
| Reconnect backoff | Custom backoff ladder | Socket.IO client built-in (`reconnection: true, reconnectionDelay, reconnectionDelayMax`) | Phase 7 frontend concern; default Socket.IO behavior is exponential w/ jitter |

**Key insight:** Phase 6 is mostly wiring. Every primitive — multiplier source, JWT validator, outbox events, server-clock — already exists. The ONE genuinely new piece of logic is the 30 Hz broadcast loop. Resist the urge to "improve" any existing primitive while in this phase.

---

## Common Pitfalls

### Pitfall 1: Volatile emit in rapid loops can drop ALL packets (not just on slow consumers)

**What goes wrong:** Issuing `volatile.emit` 30× per second in a tight loop on Socket.IO 4.8 can result in only the FIRST packet being delivered if the engine hasn't completed the previous send. Documented in [socketio/socket.io#3350](https://github.com/socketio/socket.io/issues/3350).

**Why it happens:** `volatile.emit` checks `transport.writable` and silently drops if false. Under contention from the broadcast hot path, writable can be false at the moment of every tick.

**How to avoid:** Use recursive `setTimeout` (NOT `setInterval`) so each tick is scheduled AFTER the previous one's send call returns — the writable check is more likely to pass. Also: keep tick payload tiny (~30 bytes JSON: `{roundId, multiplier, t}`); don't add bet-feed or balance to the tick. Confirm during smoke probe by observing `round:tick` count over 5 seconds at 30 Hz ≈ 150 ± 10 events.

**Warning signs:** Smoke probe receives 1-2 ticks per round instead of 150; client-side logs show large gaps between ticks; multiplier UI jumps rather than animates.

### Pitfall 2: Round transitions to CRASHED while a tick is in flight → spurious tick at the wrong multiplier

**What goes wrong:** Between `setTimeout` scheduling and execution, `RoundLoopService` transitions out of RUNNING. `getMultiplierAt(now)` throws (`"no RUNNING round available"`) and the loop crashes — or, if we silently `try/catch`, the tick emits the last cached multiplier which is now wrong.

**How to avoid:** The `MultiplierBroadcastService.start/stop()` calls must be made from `RoundLoopService` at the EXACT moments of RUNNING enter / CRASHED enter. The service's `stop()` clears its timer. Wrap the emit in `try/catch` defensively — if the service is racing and getMultiplierAt throws, drop the tick silently (don't log an error per missed tick — that floods logs at 30 Hz).

**Warning signs:** Log spam after every crash; client sees a post-crash tick with multiplier just under crashPoint; tests asserting tick count fail flakily.

### Pitfall 3: Slow consumer head-of-line blocking across rooms

**What goes wrong:** A single slow client on TCP backpressure can stall the broadcast loop for OTHER clients on the same Socket.IO worker per [socketio/socket.io discussion #5063](https://github.com/socketio/socket.io/discussions/5063).

**How to avoid:** `volatile.emit` for ticks already mitigates (drops at the slow consumer's transport). For lifecycle events (which use regular `emit`), accept that under heavy slow-consumer load, broadcast latency degrades — out of scope to optimize for Phase 6 (the Redis adapter for cluster scaling is Phase 10 if at all). Smoke test: artificially block one client (e.g., `clearTimeout` on its socket's send), confirm OTHER clients still receive ticks (volatile drops for the blocked one only).

**Warning signs:** Multiplier appears smooth for some clients but freezes for others during the same round; one blocked client correlates with broadcast latency spike for all.

### Pitfall 4: Snapshot race with concurrent round transition

**What goes wrong:** Client connects exactly at the BETTING → RUNNING boundary. `handleConnection` queries `getCurrentRound()` which still says BETTING; meanwhile `RoundLoopService` already transitioned and emitted `round.running`; the snapshot tells the client BETTING but the next event is `round:tick`.

**How to avoid:** Read the snapshot inside a single DB query that re-fetches the latest round state at the moment of emit. If a `round:tick` arrives before `round:snapshot` is processed client-side, the client must re-request a snapshot — make this the client contract (out of scope for Phase 6 backend; document for Phase 7 FE). Server-side: ensure `round:snapshot.round.startedAt` is always populated when the round is RUNNING so the client can render immediately.

**Warning signs:** New tab opens in the middle of a round → curve is blank for ~5s until the next round; integration test for "connect mid-round" flakes.

### Pitfall 5: Token expiry mid-connection silently drops connection

**What goes wrong:** Per PITFALLS H4, a long-lived WS connection outlives the JWT. Without a refresh mechanism, the next emit fails silently or the player's cashout is rejected with 401.

**How to avoid Phase 6 backend scope:** Server stores `socket.data.tokenExp`. On a low-frequency timer (e.g. every 30 s OR on each "inbound from client" — but we don't have any inbound messages in Phase 6), check if `Date.now() / 1000 > tokenExp - 30` and disconnect with a clear `auth:expired` event for the client to handle on reconnect. Phase 7 wires the FE silent renewal + reconnect.

**Warning signs:** Hour-long playtest sees players unable to cashout despite still being connected; access logs show 401 on every cashout.

### Pitfall 6: Kong WS upgrade route order matters (catch-all rules can hijack `/ws`)

**What goes wrong:** Kong matches routes in declaration order with path-priority rules. If the `~/ws` route is declared AFTER a broader path regex, the upgrade can be misrouted.

**How to avoid:** Put the WS route FIRST in `games-service.routes[]`, OR ensure it has a stricter PCRE anchor (`~/ws$`). Confirm via `curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:8000/ws` returning a 401 or 101 from `games:4001`, not a `no Route matched` 404 from Kong itself.

**Warning signs:** `wscat -c ws://localhost:8000/ws` returns 404; Kong logs show no matched route for `/ws`.

### Pitfall 7: Outbox-driven WS events arrive AFTER the round transitions

**What goes wrong:** `bet.active` flows: WalletDebitedHandler writes to outbox → OutboxPublisher polls (1 s baseline) → publishes to `game.events` → `WsBridgeConsumer` consumes → gateway emits. Total latency can be 1-2 s. Meanwhile the round is already RUNNING and the client never sees `bet:active`.

**How to avoid:** Document this latency as expected (Phase 5 P5.10 live trace showed bet.active at t+2 s). The client's "you have an active bet" UI must be driven by `round:snapshot` (which re-queries DB on every connect) AND `bet:my_active` (live). The 1-2 s lag is acceptable per ADR-020 (the bet placement asymmetry — 202 + downstream confirmation). Phase 6 does not optimize this. If the latency causes UX issues in Phase 7, the fix is to drop `OUTBOX_POLL_INTERVAL_MS` to 200 ms — not to bypass the outbox.

**Warning signs:** Player places bet at t=0, round goes RUNNING at t=5 s, `bet:my_active` arrives at t=5.5 s, FE has already shown the bet as confirmed from the 202 response — no actual bug, just confusing in logs.

---

## Runtime State Inventory

> Phase 6 is a NEW feature surface, not a rename/refactor. No legacy runtime state is being renamed. This section confirms what new runtime state Phase 6 introduces and where it lives.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — gateway is stateless beyond Socket.IO's in-memory connection table. | None |
| Live service config | One new Kong route (`games-ws` matching `~/ws$`) declared in `docker/kong/kong.yml` (in git). | New PR to `kong.yml`; reloaded automatically on `docker:up` |
| OS-registered state | None — no new systemd units, no pm2 tasks, no Windows Task Scheduler. | None |
| Secrets / env vars | Two NEW envs: `WS_PATH` (default `/ws`, from `defaults.ts`), and the existing `SERVER_TICK_HZ` (default 30 — already in REQ Open Configuration Values, never previously read because no consumer existed; Phase 6 is the first consumer). | Add `WS_PATH` to `.env.example` and each service's `defaults.ts` |
| Build artifacts / installed packages | Five new `bun add` installs (`@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@nestjs/event-emitter`, dev-dep `socket.io-client`). Bun lockfile rewritten. Docker image must be rebuilt. | `docker compose build games` (already covered by repeated `bun run docker:up`) |

**Nothing found in category** — explicitly: no stored data, no OS-registered state. Gateway is in-process, in-memory.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 18 | Snapshot use case (round + bet queries) | ✓ | 18 (Phase 1) | — |
| RabbitMQ 4.2 | `WsBridgeConsumer` on `game.events` | ✓ | 4.2 (Phase 1) | — |
| Keycloak 26.5 | JWT issuance for handshake tests | ✓ | 26.5 (Phase 1) | — |
| Kong 3.9 (DB-less) | `/ws` upgrade routing | ✓ | 3.9 (Phase 1) | — |
| Bun 1.3.11 | Runtime | ✓ | 1.3.11+ (Phase 1) | — |
| NestJS 11.1.21 | Framework | ✓ | 11.1.21 (Phase 1) | — |
| `wscat` (smoke probes) | CLI WS testing in `scripts/smoke-health.sh` | ✗ | — | Use `node -e "require('socket.io-client')(...)"` one-liner; OR `bun -e "..."`. `wscat` not strictly required. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `wscat` — smoke probes can use a Bun one-liner with `socket.io-client` (already a devDep).

---

## Code Examples

### Example 1: `JwtVerifierService` extracted from existing `JwtGuard`

```typescript
// services/games/src/presentation/auth/jwt-verifier.service.ts
// Source: extracted from existing services/games/src/presentation/guards/jwt.guard.ts lines 30-77
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../../config/defaults";

export interface VerifiedClaims {
  playerId: string;
  tokenExp: number;
}

@Injectable()
export class JwtVerifierService {
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer = env.KEYCLOAK_ISSUER;
  private readonly audience = env.KEYCLOAK_AUDIENCE;

  constructor() {
    this.jwks = createRemoteJWKSet(new URL(env.KEYCLOAK_JWKS_URI), {
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
    });
  }

  async verify(token: string): Promise<VerifiedClaims> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.audience,
    });
    const playerId = typeof payload.sub === "string" ? payload.sub : "";
    const tokenExp = typeof payload.exp === "number" ? payload.exp : 0;
    if (!playerId || !tokenExp) {
      throw new UnauthorizedException("INVALID_TOKEN");
    }
    return { playerId, tokenExp };
  }
}
```

The existing `JwtGuard` is rewritten to delegate:
```typescript
// services/games/src/presentation/guards/jwt.guard.ts (rewritten — Phase 6 change)
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly verifier: JwtVerifierService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(req.headers["authorization"]);
    if (!token) throw new UnauthorizedException("MISSING_BEARER_TOKEN");
    try {
      const { playerId, tokenExp } = await this.verifier.verify(token);
      req.user = { playerId, tokenExp };
      return true;
    } catch {
      throw new UnauthorizedException("INVALID_TOKEN");
    }
  }
}
```

### Example 2: Cashout race property test (REQ-TEST property)

```typescript
// services/games/tests/property/cashout-race.property.test.ts (NEW)
// Source: PITFALLS C2 — hammer ±50ms of crash; always valid OR 409, never double or post-crash.
// Uses fast-check@^3.23.0 (already devDep) — see services/games/tests/property/money-rounding.property.test.ts pattern.
import { test } from "bun:test";
import fc from "fast-check";

test("cashout requests ±50ms of crashAt resolve as valid OR 409 — never double payout, never post-crash", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: -50, max: 50 }), // dt relative to crashAt
      async (dtMs) => {
        const { app, getCashedOut, getRoundCrashed } = await bootRunningRoundFixture();
        const acceptedAt = new Date(roundCrashAt.getTime() + dtMs);
        try {
          await fetchCashout(app, { acceptedAt });
          // Accepted — must be either before crash with valid payout, or it raced before transition
          const cashout = await getCashedOut(playerId);
          const crashed = await getRoundCrashed();
          expect(cashout.acceptedAt.getTime()).toBeLessThan(crashed.crashedAt.getTime());
        } catch (err) {
          // 409 — must be ROUND_NOT_RUNNING or BET_NOT_CASHABLE
          expect(err.response.statusCode).toBe(409);
          expect(["ROUND_NOT_RUNNING", "BET_NOT_CASHABLE", "NO_ACTIVE_BET"]).toContain(err.body.code);
        }
        // INVARIANT: at most one CASHED_OUT row for this bet
        const cashoutCount = await countCashouts(betId);
        expect(cashoutCount).toBeLessThanOrEqual(1);
        await app.close();
      },
    ),
    { numRuns: 200 },
  );
});
```

### Example 3: Kong WS route declarative config

```yaml
# docker/kong/kong.yml — add to games-service.routes[] at the TOP (before games-current, etc.)
- name: games-ws
  paths:
    - ~/ws$
  protocols:
    - http
    - https
  strip_path: false
# (no methods array — WS handshake uses GET with Upgrade header; Kong forwards Connection/Upgrade per its WS docs)
```

Kong 3.9 supports WS over `http`/`https` protocols by forwarding the `Connection: Upgrade` and `Upgrade: websocket` headers transparently per [Kong proxying docs](https://developer.konghq.com/gateway/traffic-control/proxying/). No additional plugin needed.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setInterval` for periodic broadcasts | Recursive `setTimeout` | Node lifecycle docs canon since v14 | Drift-free; aligned with ADR-017 from Phase 4 |
| Validating JWT in `handleConnection` (after upgrade) | `io.use()` middleware at upgrade | Socket.IO 2.x+ middleware API | Upgrade is rejected before connection establishes (PITFALLS H3) |
| Per-round Socket.IO rooms | Single global `lobby` + `user:{id}` | ARCHITECTURE §7.2 (research synthesis) | No join/leave churn every ~10s |
| Server pushes every frame at 60 Hz | Server 30 Hz + client interpolation | Gabriel Gambetta canon, ARCHITECTURE §8 | Half the bandwidth, smoother render |
| `volatile.emit` for everything | `volatile.emit` ONLY for `round:tick` | REQ-WS-06 + Socket.IO docs | Lifecycle events guaranteed delivery; only ticks are droppable |

**Deprecated/outdated:**
- Validating JWT via `auth:authenticate` first-message pattern — replaced by `io.use()` handshake middleware (PITFALLS H3).
- Per-tick DB query for current multiplier — replaced by `RoundLoopService.getMultiplierAt(at)` synchronous in-memory call (Phase 5 plan 05-02).
- Two-pass `setInterval(33)` + `clearInterval` on every state change — racy and drift-prone; use recursive setTimeout pattern from ADR-017.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `socket.io@^4.8.1` is the current minor; exact patch level should be `npm view`'d during the install task. | Standard Stack | Low — minor versions are backward-compatible within 4.x. |
| A2 | `@nestjs/event-emitter@^3.0.0` is the version compatible with `@nestjs/common@^11.1.21`. Not verified via `npm view`. | Standard Stack | Low — peerDeps will surface the mismatch immediately on install. Planner must verify. |
| A3 | Kong 3.9 declarative `kong.yml` accepts `protocols: [http, https]` on a route without additional plugin to handle WS upgrade. Inferred from Kong docs that "Services and Routes using http/https are fully capable of handling WebSocket connections with no special configuration." Not tested locally yet for THIS specific kong.yml. | Architecture Patterns | Medium — if Kong drops the upgrade, smoke probe will fail at the first `wscat -c`. Mitigation: smoke probe is a hard gate. |
| A4 | The outbox `OUTBOX_POLL_INTERVAL_MS=1000` (default) creates 1-2 s latency for `bet:my_active` arriving at the client. Documented in Pitfall 7. | Common Pitfalls | Low — already proven live in Phase 5 P5.10 trace (~2 s). |
| A5 | The Kong route ordering (route declared first wins on PCRE tie) is correct for Kong 3.9 DB-less. | Common Pitfalls | Medium — verify via `curl /ws` after change. |
| A6 | NestJS `EventEmitter2` (via `@nestjs/event-emitter`) does not cross-talk across NestJS test modules — i.e., integration tests with two `Test.createTestingModule` instances do not see each other's events. Reasonable assumption but not verified. | Architecture Patterns | Low — only affects test isolation; mitigation is per-test app teardown. |
| A7 | The cashout race property test can boot a real games-service + Kong + Postgres + RabbitMQ stack within `fast-check` numRuns=200 in reasonable time. Phase 5 integration tests had broker-connection-refused race (logged as deferred in STATE.md). | Code Examples | Medium — may need to reduce `numRuns` to 50 or run as a flaky-tolerant test outside CI. Document in plan. |
| A8 | `round:snapshot` payload (round + activeBets + myBet) fits in a single Socket.IO frame (< 64 KB after JSON encode) for any realistic active-bet count. Bet feed = N players × ~80 bytes ≈ <10 KB at 100 players. | Architecture Patterns | Low. |
| A9 | `npm view @nestjs/event-emitter version` was not run at research time — version `^3.0.0` is a training-data guess. Planner MUST verify before the install task. | Standard Stack | Medium — wrong version may not exist or may have a peerDep conflict. |
| A10 | Slopcheck unavailable → all five Phase 6 new packages tagged [ASSUMED]. | Package Legitimacy Audit | Low — all five are well-known canonical packages; manual verification via `npm view <pkg> repository` is a cheap checkpoint. |

**If this table is empty:** N/A — assumptions present and gated above.

---

## Open Questions

1. **`@nestjs/event-emitter` vs. `forwardRef` injection for the `RoundLoopService` → gateway hook.**
   - What we know: both work in NestJS 11; `@nestjs/event-emitter` is the official recommendation per NestJS docs.
   - What's unclear: whether `EventEmitter2` adds material test friction (Open Question A6).
   - Recommendation: use `@nestjs/event-emitter`. If a Wave-0 plan-check finds it breaks integration test isolation, fall back to `forwardRef`.

2. **Should `WsBridgeConsumer` re-emit `bet.active` to the `lobby` (masked) AND `user:{playerId}` (private), or only `user:{playerId}`?**
   - What we know: REQ-WS-03 enumerates both `bet:placed` (lobby) and `bet:my_active` (user). The lobby variant uses a masked playerId.
   - What's unclear: whether `bet.active` (from the outbox) carries enough data to derive both, or if the gateway needs a separate `bet.placed.lobby` event.
   - Recommendation: emit BOTH from a single AMQP message. The bridge consumer reads `playerId` from payload → derives `playerIdMasked = sha256(playerId).slice(0, 8)` → emits `bet:placed` to `lobby` AND `bet:my_active` to `user:{playerId}`.

3. **What multiplier value does `round:tick` carry as a number — float JS or string?**
   - What we know: CLAUDE.md says "no `number` for amounts." Multiplier is NOT money — it's a dimensionless quantity.
   - What's unclear: whether the wire payload should encode multiplier as a float (`2.34`) or as a snapshot `{value: "23400", scale: 4}` like `Multiplier` VO internally.
   - Recommendation: tick payload uses a plain JS number for the multiplier (3-decimal float is acceptable for a display value at 30 Hz). The AUTHORITATIVE values (cashout payout, crash point) remain Money/Multiplier snapshots. This matches `CashoutResponseDto.multiplier: number` already locked at `bet-command.controller.ts:80`.

4. **Should `MultiplierBroadcastService` exist as its own provider, or be a private member of `RoundLoopService`?**
   - What we know: separation of concerns favors its own provider; testability favors its own provider; nothing else needs to consume it.
   - Recommendation: own provider. RoundLoopService calls `start()`/`stop()`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (Bun 1.3.11+) + `fast-check@^3.23.0` (property) + `socket.io-client@^4.8.1` (integration WS client) |
| Config file | `services/games/tsconfig.integration.json` (existing, from Phase 4) |
| Quick run command | `cd services/games && bun test tests/unit` |
| Full suite command | `cd services/games && bun test tests/unit tests/property && bunx tsc --noEmit -p tsconfig.integration.json && bun test tests/integration` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-WS-01 | WS handshake rejects missing/invalid JWT, accepts valid | integration | `bun test tests/integration/ws-handshake-jwt.test.ts` | Wave 0 — create |
| REQ-WS-02 | Connect joins `lobby` + `user:{playerId}` | integration | `bun test tests/integration/ws-rooms.test.ts` | Wave 0 — create |
| REQ-WS-03 | All catalogued S→C events fire over a round lifecycle | integration | `bun test tests/integration/ws-event-catalog.test.ts` | Wave 0 — create |
| REQ-WS-04 | `round:snapshot` on connect/reconnect carries full state | integration | `bun test tests/integration/ws-snapshot.test.ts` | Wave 0 — create |
| REQ-WS-05 | Cashout `acceptedAt` server-stamped first line (HTTP controller) | unit | `bun test tests/unit/bet-command.controller.cashout-accepted-at.test.ts` | Wave 0 — create |
| REQ-WS-06 | `volatile.emit` for ticks; slow consumer doesn't stall others | integration | `bun test tests/integration/ws-tick-volatile.test.ts` | Wave 0 — create |
| REQ-WS-07 | Reconnect → snapshot delivered; client backoff defaults from Socket.IO client | smoke | `scripts/smoke-health.sh` probes 39-44 | Wave 0 — add probes |
| Cashout race | Hammering ±50 ms of crash → valid OR 409, never double | property | `bun test tests/property/cashout-race.property.test.ts` | Wave 0 — create |

### Sampling Rate

- **Per task commit:** `bun test tests/unit` (< 1 s, 165+ assertions).
- **Per wave merge:** `bun test tests/unit tests/property && bunx tsc --noEmit -p tsconfig.integration.json` (~ 2-3 s).
- **Phase gate:** Full suite green INCLUDING `tests/integration/*` against `bun run docker:up` live stack PLUS new smoke probes 39-44 PASS.

### Wave 0 Gaps

- [ ] `services/games/tests/integration/ws-handshake-jwt.test.ts` — covers REQ-WS-01.
- [ ] `services/games/tests/integration/ws-rooms.test.ts` — covers REQ-WS-02.
- [ ] `services/games/tests/integration/ws-event-catalog.test.ts` — covers REQ-WS-03.
- [ ] `services/games/tests/integration/ws-snapshot.test.ts` — covers REQ-WS-04.
- [ ] `services/games/tests/integration/ws-tick-volatile.test.ts` — covers REQ-WS-06.
- [ ] `services/games/tests/unit/bet-command.controller.cashout-accepted-at.test.ts` — assert first-line `acceptedAt` invariant.
- [ ] `services/games/tests/property/cashout-race.property.test.ts` — fast-check property covering REQ-TEST-02 extension.
- [ ] `scripts/smoke-health.sh` probes 39-44: handshake denied without token, handshake accepted with token, snapshot received within 1 s, tick count ≥ 100 over 5 s, round lifecycle event sequence observed over one full BETTING→CRASHED→SETTLED arc, cashout race window probe.
- [ ] Framework install: `bun add -d socket.io-client@^4.8.1` — already noted in Standard Stack.

---

## Security Domain

`security_enforcement` is enabled (absent in `.planning/config.json` → defaults to enabled per CLAUDE.md convention).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `jose@6.2.3` cached JWKS via shared `JwtVerifierService`; `io.use()` middleware validates at handshake; same issuer + audience checks as HTTP `JwtGuard`. |
| V3 Session Management | yes (partial) | No server session — JWT is the session. Token TTL governed by Keycloak; mid-connection expiry handled by server disconnect (PITFALLS H4 mitigation deferred to Phase 7 FE). |
| V4 Access Control | yes | Private events emit ONLY to `user:{playerId}` room — strict per-player segregation. Lobby is intentionally public (round + masked bet feed). No cross-tenant data leak possible because there's one tenant. |
| V5 Input Validation | yes (low surface) | Phase 6 has NO inbound WS messages (server-push only) — input validation surface is only the WS handshake auth token, validated by `jose.jwtVerify`. Any future inbound message must use a zod schema (existing nestjs-zod baseline). |
| V6 Cryptography | yes | All crypto comes from `jose` (JWT/JWKS) — no hand-rolled. SHA-256 player masking uses Node's built-in `crypto.createHash('sha256')`. No new crypto primitives introduced. |
| V7 Error Handling | yes | Handshake middleware returns `next(new Error('UNAUTHORIZED'))` — client gets `connect_error` with NO detail (no stack trace leak). Lifecycle errors logged at server. |
| V12 API & Web Service | yes | WS endpoint is bidirectional but read-only (server-push). HTTP cashout endpoint retains existing JwtGuard. |

### Known Threat Patterns for {NestJS Socket.IO + Keycloak} stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| JWT in URL query (logged by Kong) | Information Disclosure | Use `socket.handshake.auth.token` payload (canonical Socket.IO pattern) OR `Authorization` header — NEVER query string. Documented in PITFALLS H3. |
| WS handshake without auth → anonymous subscription to bet feed | Information Disclosure / Spoofing | Reject at `io.use()` middleware before connection establishes. REQ-WS-01 enforces. |
| Slow-consumer DoS on broadcast loop | Denial of Service | `volatile.emit` for ticks drops at the slow socket's transport (REQ-WS-06). Lifecycle events accept degraded latency under heavy slow-consumer load. |
| Cross-player private event leak via WRONG room | Information Disclosure | `socket.join('user:${playerId}')` from `socket.data.playerId` (set ONLY by verified JWT in middleware). Never trust a client-supplied playerId. |
| Cashout request with client-supplied timestamp or multiplier | Tampering | `acceptedAt = new Date()` at controller line 69 (server-side); `multiplier` derived from `roundLoop.getMultiplierAt(acceptedAt)` (server-side). Client supplies NEITHER. ADR-023 codifies. |
| Token rotation race across tabs (refresh races) | Repudiation / Spoofing | Out of scope for Phase 6 backend; deferred to Phase 7 (`BroadcastChannel` per PITFALLS H4). |
| JWKS DoS via hammering on cold cache | Denial of Service | `createRemoteJWKSet` with `cacheMaxAge: 600_000` + `cooldownDuration: 30_000` (already configured in `JwtGuard`; reused by `JwtVerifierService`). |
| Replay of old `bet:cashed_out` event delivering double-credit notice to FE | Tampering | Idempotency is at the use-case level (Bet.cashOut returns `null` on already-CASHED_OUT race) — WS event re-delivery is benign noise, FE deduplicates by `betId`. |

---

## ADRs Anticipated

| ADR | Title | Decision Locked |
|-----|-------|-----------------|
| ADR-021 | Single global `lobby` room over per-round rooms | Per ARCHITECTURE §7.2 + SUMMARY §8 — only one round runs at a time; per-round room adds churn every ~10 s with no scoping benefit. Rejects: per-round room (Option A — every BETTING entry forces a `socket.join`), per-player segmentation only (Option C — loses the public bet feed visibility). |
| ADR-022 | 30 Hz server tick + 60 fps client interpolation via rAF | Per SUMMARY §8 + ARCHITECTURE §8. Rejects: 60 Hz server tick (2× bandwidth, no smoothness gain), 10 Hz tick (too coarse for accurate clock-offset EWMA), per-frame server broadcast (~600× bandwidth). |
| ADR-023 | Server-authoritative `cashoutAcceptedAt` at HTTP controller (NOT a WS message) | Locks the existing Phase 5 implementation pattern (`bet-command.controller.ts:69`) as the canon. Defines "gateway middleware" in REQ-WS-05 as the NestJS controller layer (which IS a kind of gateway). Documents why cashout was NOT migrated to a WS inbound message: a WS message handler runs concurrent with the tick broadcast loop on the same event loop; HTTP gives one isolated request thread. Rejects: WS inbound `cashout` message (would compete with tick loop and complicate the race window without benefit). |

---

## Order of Execution (preview for the planner)

The planner should expect roughly this dependency order (final plan-list is the planner's responsibility). Wave numbers are illustrative:

- **Wave 0 (test scaffolding)**: integration test files + property test file + smoke probes 39-44 — failing RED.
- **Wave 1 (dependencies + extraction)**:
  - `bun add` the five new packages (5 separate `checkpoint:human-verify` tasks per Package Legitimacy Audit) [parallelizable]
  - Extract `JwtVerifierService` from `JwtGuard`; rewrite `JwtGuard` to delegate [serial with above]
- **Wave 2 (JWT WS adapter)**: `JwtIoAdapter` + wire in `main.ts`. Integration test for handshake (REQ-WS-01) passes GREEN.
- **Wave 3 (gateway scaffolding + snapshot)**: `GameWsGateway` with handleConnection/Disconnect + `GetWsSnapshotUseCase` + room joins. Tests for REQ-WS-02 + REQ-WS-04 pass.
- **Wave 4 (round lifecycle events)**: `@nestjs/event-emitter` install; `RoundLoopService` emits `round.started`/`running`/`crashed`/`settled`; gateway `@OnEvent` handlers; tests for REQ-WS-03 lifecycle events pass.
- **Wave 5 (multiplier broadcast)**: `MultiplierBroadcastService` recursive setTimeout + start/stop hooks from `RoundLoopService`. Test for REQ-WS-06 (tick count + volatile semantics) passes.
- **Wave 6 (outbox-driven bet events)**: `WsBridgeConsumer` subscribing to `game.events`; emits `bet:placed` (lobby masked) + `bet:my_active`/`bet:my_refunded`/`bet:my_cashed_out` (user:{id}) + `bet:cashed_out` (lobby masked). Test for REQ-WS-03 bet events passes.
- **Wave 7 (Kong route + smoke)**: `kong.yml` games-ws route at top of routes[]. Smoke probes 39-44 pass.
- **Wave 8 (cashout race property test + REQ-WS-05 codification)**: property test green; ADR-023 authored.
- **Wave 9 (ADRs + closeout)**: ADR-021 + ADR-022 + ADR-023 + STATE/ROADMAP/REQUIREMENTS closeout.

Parallelization windows: Wave 1's `bun add` checkpoints are parallel; the `JwtVerifierService` extraction is serial. Wave 5 (broadcast) and Wave 6 (bridge consumer) can run in parallel since they touch disjoint files. Wave 7 (Kong) can start as soon as the gateway accepts upgrades from Wave 2.

---

## Phase 6 Risks

1. **Broadcast backpressure under integration test fan-out.** Spinning 10+ Socket.IO test clients against a single games-service worker for `ws-tick-volatile.test.ts` may saturate the event loop. Mitigation: run integration tests with smaller fan-out (3 clients); use `setImmediate` between tick simulation steps if needed.
2. **Kong WS route ordering breaks existing routes.** Inserting `games-ws` at the top of `routes[]` might shadow `games-current`/`games-history` if PCRE matches loosely. Mitigation: anchor with `~/ws$`; smoke probe each existing route after change.
3. **`@nestjs/event-emitter` event leak across test runs.** Bun test does not isolate module state cleanly; an `@OnEvent('round.started')` listener registered by one test's `Test.createTestingModule` may still be registered for the next test's app instance. Mitigation: `app.close()` in `afterEach`; if needed, switch to direct `forwardRef` injection.
4. **`OutboxPublisher` polling interval contention with tick loop.** Both run on the same event loop. Polling every 1 s at the moment the tick loop is most active should be fine, but a 200 ms poll for low-latency bet events could starve ticks. Mitigation: leave `OUTBOX_POLL_INTERVAL_MS=1000` default; document if Phase 7 demands lower latency.
5. **Token mid-connection expiry leaves "ghost" connections.** A 5-minute Keycloak token + 10-minute session = WS connection that can no longer cashout but stays connected. Mitigation: server-side timer disconnects at `tokenExp`. Phase 6 ships the disconnect; Phase 7 handles reconnect with refreshed token.
6. **Property-test flakiness around the crash boundary.** Booting a real round + RabbitMQ + Postgres + hammering 200 cashouts is heavyweight. Mitigation: use the `fakeClock` pattern from PITFALLS M3 if available; otherwise reduce `numRuns` to 50 with a documented justification.
7. **The cashout race property test depends on real RabbitMQ being available** — Phase 5 P5.09 had a broker-connection-refused boot race in 14/15 integration tests (deferred per STATE.md). Mitigation: gate the property test behind the same `bun run docker:up` precondition as other integration tests; document as a known flake risk.

---

## Sources

### Primary (HIGH confidence)

- [NestJS WebSocket adapter docs](https://docs.nestjs.com/websockets/adapter) — `IoAdapter` extension pattern, `createIOServer` override.
- [NestJS WebSocket gateways docs](https://docs.nestjs.com/websockets/gateways) — `@WebSocketGateway({path})`, `@WebSocketServer`, lifecycle hooks.
- [NestJS Events docs (`@nestjs/event-emitter`)](https://docs.nestjs.com/techniques/events) — `EventEmitter2` integration, `@OnEvent` decorator.
- [Socket.IO middleware docs](https://socket.io/docs/v4/middlewares/) — `io.use()` pattern, `next(err)` semantics.
- [Socket.IO Server API](https://socket.io/docs/v4/server-api/) — `volatile.emit`, room broadcast semantics.
- [Socket.IO JWT how-to](https://socket.io/how-to/use-with-jwt) — handshake auth via `socket.handshake.auth.token`.
- [Kong Gateway proxying docs](https://developer.konghq.com/gateway/traffic-control/proxying/) — WS upgrade transparency over http/https protocols.
- Existing Phase 5 sources: `services/games/src/application/round-loop.service.ts` (verified pattern for recursive setTimeout), `bet-command.controller.ts` (verified first-line `acceptedAt`), `JwtGuard` (verified jose JWKS setup), `kong.yml` (existing routes structure).
- `.planning/research/ARCHITECTURE.md` §7-§8 — WS gateway and multiplier sync design.
- `.planning/research/PITFALLS.md` C2, H1-H4, M7 — cashout race, multi-tab drift, WS auth, token expiry, reconnect storms.
- `.planning/research/STACK.md` §2.3 — Socket.IO 4.8 + NestJS 11 compatibility verification.

### Secondary (MEDIUM confidence)

- [NestJS github #1059](https://github.com/nestjs/nest/issues/1059) — community confirmation of `IoAdapter` middleware pattern.
- [Socket.IO discussion #5063](https://github.com/socketio/socket.io/discussions/5063) — slow-consumer head-of-line blocking documented.
- [Socket.IO issue #3350](https://github.com/socketio/socket.io/issues/3350) — volatile.emit dropping in rapid loops (Pitfall 1).
- [Demystifying NestJS WebSocket Gateways (DEV)](https://dev.to/jfrancai/demystifying-nestjs-websocket-gateways-a-step-by-step-guide-to-effective-testing-1a1f) — testing patterns for NestJS WS gateways.
- [WebSocket Authentication in NestJS with JWT (DEV)](https://dev.to/mouloud_hasrane_c99b0f49a/websocket-authentication-in-nestjs-handling-jwt-and-guards-4j27) — adapter + middleware combination.

### Tertiary (LOW confidence — flagged for validation during execution)

- WebSearch results on Kong 3.9 declarative WS — confirms Kong handles upgrade transparently but no specific 3.9 YAML schema example for `protocols: [http, https]` on a route was returned. The kong.yml change is small and verifiable via smoke probe — acceptable risk.
- `@nestjs/event-emitter@^3.0.0` exact patch version — needs `npm view` verification (Assumption A2/A9).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all five packages are canonical, four already in tree.
- Architecture: HIGH — gateway + EventEmitter + recursive setTimeout pattern verified against existing Phase 4/5 code.
- JWT adapter: HIGH — official NestJS pattern, existing JwtGuard provides the verifier logic verbatim.
- Multiplier broadcast: HIGH — `getMultiplierAt` already in place (Phase 5 plan 05-02); volatile.emit pattern is canonical.
- Outbox→WS bridge: MEDIUM — recommended pattern but not previously implemented in this codebase; alternative (direct handler injection) flagged as a discretion fork.
- Kong WS route: MEDIUM — confirmed by docs that no plugin is needed but the specific YAML idiom must be smoke-tested.
- Cashout race test: HIGH — REQ-WS-05 invariant already satisfied at `bet-command.controller.ts:69` from Phase 5; property test exercises the boundary.
- Pitfalls: HIGH — multiple authoritative sources (Socket.IO docs + GitHub issues + ARCHITECTURE/PITFALLS).

**Research date:** 2026-05-27
**Valid until:** 2026-06-26 (30 days — stable, well-documented stack; only `@nestjs/event-emitter` version needs re-verification at install time).
