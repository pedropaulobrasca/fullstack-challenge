---
phase: 06-websocket-multiplier-sync
plan: 03
subsystem: games-service / presentation websocket
tags: [websocket, jwt, socket.io, snapshot, gateway]
dependency_graph:
  requires:
    - services/games/src/presentation/auth/jwt-verifier.service.ts (Phase 6 Plan 01)
    - services/games/src/config/defaults.ts WS_PATH (Phase 6 Plan 02)
    - services/games/src/application/use-cases/get-current-round.use-case.ts (Phase 4 Plan 08)
    - services/games/src/domain/bet.repository.ts findActiveByRound (Phase 4)
  provides:
    - services/games/src/presentation/adapters/jwt-io.adapter.ts
    - services/games/src/presentation/gateways/game-ws.gateway.ts
    - services/games/src/application/use-cases/get-ws-snapshot.use-case.ts
    - services/games/src/application/use-cases/mask-player-id.ts
    - services/games/src/presentation/dtos/ws-event.payloads.ts
  affects:
    - services/games/src/main.ts (wires JwtIoAdapter)
    - services/games/src/app.module.ts (registers GameWsGateway)
    - services/games/src/application/game-core.module.ts (registers GetWsSnapshotUseCase)
    - services/games/src/application/use-cases/get-current-round.use-case.ts (delegates to shared mask helper)
tech_stack:
  added: []
  patterns:
    - custom IoAdapter installing io.use middleware for JWT-at-handshake auth
    - WebSocket gateway as a thin presentation-layer fan-out (no domain access)
    - per-socket round:snapshot emit on handleConnection for idempotent reconnects
    - sha256 8-char prefix masking for lobby-visible playerId references
    - Clock seam in use-case allows deterministic serverTime under test
key_files:
  created:
    - services/games/src/presentation/adapters/jwt-io.adapter.ts
    - services/games/src/presentation/gateways/game-ws.gateway.ts
    - services/games/src/application/use-cases/get-ws-snapshot.use-case.ts
    - services/games/src/application/use-cases/mask-player-id.ts
    - services/games/src/presentation/dtos/ws-event.payloads.ts
    - services/games/tests/unit/ws-event-payloads.test.ts
    - services/games/tests/unit/get-ws-snapshot.use-case.test.ts
    - services/games/tests/unit/jwt-io.adapter.test.ts
    - services/games/tests/unit/game-ws.gateway.connection.test.ts
  modified:
    - services/games/src/main.ts
    - services/games/src/app.module.ts
    - services/games/src/application/game-core.module.ts
    - services/games/src/application/use-cases/get-current-round.use-case.ts
decisions:
  - Reused existing BetRepository.findActiveByRound rather than adding a parallel findActiveByRoundId — the existing method already returns PENDING + ACTIVE for a round, identical to plan intent
  - Hoisted maskPlayerId from get-current-round.use-case.ts to a shared application/use-cases/mask-player-id.ts so the snapshot use case and the existing round view share one masking implementation
  - GetWsSnapshotUseCase composes RoundRepository + BetRepository directly instead of wrapping GetCurrentRoundUseCase — the snapshot payload shape diverges from the HTTP CurrentRoundView (no currentMultiplier, no formulaVersion exposure, different bet entry shape) so composition would have required two transforms
  - JwtIoAdapter emits debug log (not warn) on handshake rejection to avoid log spam from probing clients
  - GameWsGateway disconnects rather than logs+continues when snapshot fails — a stale connection without a snapshot violates the REQ-WS-04 contract
metrics:
  duration_minutes: 14
  completed: 2026-05-28
  tasks_completed: 3
  files_changed: 13
  commits: 3
requirements:
  - REQ-WS-01
  - REQ-WS-02
  - REQ-WS-04
---

# Phase 6 Plan 03: WebSocket Gateway Scaffold Summary

WebSocket presentation surface: `JwtIoAdapter` validates Keycloak JWTs at the Socket.IO handshake, `GameWsGateway` auto-joins each authenticated socket to `lobby` + `user:{playerId}` and emits `round:snapshot` per connection. Snapshot assembly lives in `GetWsSnapshotUseCase` — a pure application service that re-queries Round + active bets through the existing repositories, masks bystander playerIds, and includes the caller's un-masked bet when present.

## Goal

Make the games-service WebSocket endpoint exist, authenticate clients at upgrade, and replay the current round state to every connecting socket in a way that is idempotent across reconnects — without bolting on any tick or lifecycle broadcast logic (those are 06-04 and 06-05).

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | WS event payload zod schemas (snapshot, lifecycle, tick, bet) | 5d8fd38 | ws-event.payloads.ts (new), ws-event-payloads.test.ts (new) |
| 2 | GetWsSnapshotUseCase + hoist maskPlayerId helper + module wiring | 6b7e170 | get-ws-snapshot.use-case.ts (new), mask-player-id.ts (new), get-current-round.use-case.ts (refactor), game-core.module.ts (provider), get-ws-snapshot.use-case.test.ts (new) |
| 3 | JwtIoAdapter + GameWsGateway + main.ts adapter wiring | 53a4068 | jwt-io.adapter.ts (new), game-ws.gateway.ts (new), app.module.ts (provider), main.ts (adapter), jwt-io.adapter.test.ts (new), game-ws.gateway.connection.test.ts (new) |

## Behavior Locked

- WS handshake without a token rejects at `io.use()` with `Error("UNAUTHORIZED")` — the client receives `connect_error`.
- WS handshake with a valid Keycloak JWT proceeds and `socket.data.playerId` carries the verified `sub` claim into `handleConnection`.
- `handleConnection` joins the socket to both `lobby` and `user:{playerId}` rooms before emitting the snapshot.
- `round:snapshot` is emitted exactly once per connection via `socket.emit` (per-socket, NOT broadcast) — idempotent across reconnects.
- Snapshot's `activeBets[].playerIdMasked` is `sha256(playerId).slice(0, 8)` matching the existing Phase 4 HTTP-endpoint masking pattern.
- Snapshot's `myBet` is populated with un-masked detail when the caller has a PENDING or ACTIVE bet on the current round; null otherwise.
- Snapshot is null when no open round exists.
- Token extraction tries `handshake.auth.token` then `Authorization: Bearer …`; `handshake.query.token` is explicitly ignored (T-06-06 mitigation — token never reaches Kong access logs as a URL parameter).
- All outbound payload shapes are typed against strict zod schemas in `ws-event.payloads.ts`.

## Verification

- `cd services/games && bunx tsc --noEmit` — clean
- `cd services/games && bun test tests/unit` — 200 pass / 0 fail / 627 expect() calls
- `grep -c '@WebSocketGateway' services/games/src/presentation/gateways/game-ws.gateway.ts` returns 1
- `grep -c 'app.useWebSocketAdapter' services/games/src/main.ts` returns 1
- `grep -c 'JwtIoAdapter' services/games/src/main.ts` returns 2 (import + new)
- `grep -v '^#' services/games/src/presentation/adapters/jwt-io.adapter.ts | grep -c 'handshake.query'` returns 0

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 3 - Blocking issue] BetRepository already has the active-bets-by-round method under a different name.** The plan asked for `findActiveByRoundId(roundId)`. The repository already exposes `findActiveByRound(roundId)` with identical semantics (PENDING + ACTIVE filter, returns `Bet[]`). Adding a second method with the alternate name would have been redundant, so the snapshot use case calls the existing method. No new method added.
   - Files affected: none (existing API consumed)
   - Commit: encoded as the absence of changes to `bet.repository.ts` / `mikro-bet.repository.ts`

2. **[Rule 3 - Refactor] Hoisted `maskPlayerId` from get-current-round.use-case to a shared helper.** The plan flagged this as a possible refactor; doing it now keeps the masking implementation single-sourced between the HTTP `GET /games/rounds/current` view and the WS snapshot. Both use cases now import from `application/use-cases/mask-player-id.ts`.
   - Files modified: `get-current-round.use-case.ts` (delete inline function + add import)
   - New file: `application/use-cases/mask-player-id.ts`
   - Commit: 6b7e170

3. **[Rule 1 - Test bug, caught during initial Task 3 run] `buildSocket(undefined)` was hitting the default parameter and producing a populated `socket.data.playerId` instead of an empty `data`.** TypeScript default parameters activate when the argument is `undefined`, so `buildSocket(undefined)` resolved to `buildSocket("player-alice")`. Switched the helper signature to `string | null` with `null` as the explicit "no playerId" sentinel — call sites updated. Fixed in the same Task 3 commit (53a4068).
   - File: `tests/unit/game-ws.gateway.connection.test.ts`

### Non-blocking observations
- The plan referenced `services/games/src/infrastructure/persistence/mikro-bet.repository.ts` in its `files_modified` frontmatter, but the actual file lives at `infrastructure/repositories/mikro-bet.repository.ts`. The frontmatter path is informational only; no code changes were required there because of deviation #1 above.
- Plan-suggested `findActiveByRoundId` test scope (insert ACTIVE + PENDING + CASHED_OUT bets) is already covered indirectly by the existing repo's e2e/integration suites — no additional unit test added.

## Threat Coverage

| Threat ID | Disposition | Implementation site | Verified by |
|-----------|-------------|---------------------|-------------|
| T-06-05 (spoofing at handshake) | mitigated | `io.use()` middleware in `JwtIoAdapter.createIOServer` rejects any handshake whose token does not verify against the cached Keycloak JWKS | `jwt-io.adapter.test.ts` cases 1, 4, 5 |
| T-06-06 (token in proxy logs) | mitigated | `extractToken` reads only from `handshake.auth.token` and `Authorization: Bearer …`; `handshake.query` is never touched | `jwt-io.adapter.test.ts` case 4 (`query.token` path explicitly rejected); grep verification confirms zero `handshake.query` reads in the adapter source |
| T-06-07 (cross-player private events) | mitigated | `handleConnection` derives the `user:{playerId}` room name solely from `socket.data.playerId`, which is set only by the verified-JWT middleware — client cannot influence room membership | `game-ws.gateway.connection.test.ts` cases 1, 2 |
| T-06-08 (outbound payload tampering) | mitigated | All payload shapes are defined in `ws-event.payloads.ts` as strict zod schemas (`.strict()`) with masked-playerId regex enforcement on lobby-visible bet entries | `ws-event-payloads.test.ts` (13 cases, including rejection of unmasked playerId in `activeBets`) |

## Out-of-Scope Pre-Existing Modifications Observed

None new. The pre-existing modifications flagged in Plan 06-01's summary (`.env.example`, `services/games/.env.example`, etc.) remain in the working tree and were not committed by this plan either.

## Known Stubs

None — the gateway is fully wired (real JwtVerifierService, real repositories, real snapshot assembly). Downstream broadcast surfaces (`emitToLobby`, `emitToPlayer`) are exposed on the gateway but not yet called; that wiring lands in 06-04 (tick broadcast), 06-05 (lifecycle events), and 06-06 (outbox→WS bridge).

## Next Plans

- 06-04 — `MultiplierBroadcastService` 30 Hz `volatile.emit` tick loop hooked into `RoundLoopService` RUNNING/CRASHED transitions and broadcast via `gateway.emitToLobby("round:tick", …)`
- 06-05 — `EventEmitter2`-based lifecycle event bridge (`round:started`, `round:running`, `round:crashed`, `round:settled`) from `RoundLoopService` into `GameWsGateway`
- 06-06 — `WsBridgeConsumer` subscribing to `game.events` exchange for outbox-driven bet event broadcast

## Self-Check: PASSED

- `services/games/src/presentation/adapters/jwt-io.adapter.ts` — FOUND
- `services/games/src/presentation/gateways/game-ws.gateway.ts` — FOUND
- `services/games/src/application/use-cases/get-ws-snapshot.use-case.ts` — FOUND
- `services/games/src/application/use-cases/mask-player-id.ts` — FOUND
- `services/games/src/presentation/dtos/ws-event.payloads.ts` — FOUND
- `services/games/tests/unit/ws-event-payloads.test.ts` — FOUND
- `services/games/tests/unit/get-ws-snapshot.use-case.test.ts` — FOUND
- `services/games/tests/unit/jwt-io.adapter.test.ts` — FOUND
- `services/games/tests/unit/game-ws.gateway.connection.test.ts` — FOUND
- Commit `5d8fd38` (Task 1) — FOUND in `git log`
- Commit `6b7e170` (Task 2) — FOUND in `git log`
- Commit `53a4068` (Task 3) — FOUND in `git log`
- `bunx tsc --noEmit` clean — VERIFIED
- `bun test tests/unit` 200 pass / 0 fail — VERIFIED
- `grep` verification commands all pass — VERIFIED
