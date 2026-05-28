# ADR-021: Single global `lobby` room over per-round rooms

**Status**: Accepted
**Date**: 2026-05-28
**Phase**: 6

## Context

Phase 6 wires the `GameWsGateway` into the existing `games-service` NestJS app. Every connected socket needs to receive two distinct classes of message: public broadcast traffic that every player sees identically (round lifecycle events, the 30 Hz multiplier tick, the masked bet/cashout feed) and private traffic addressed to exactly one player (`bet:my_active`, `bet:my_cashed_out`, `bet:my_refunded`). Socket.IO's room primitive is the mechanism for fanning a single emit to a set of sockets, so the design question is: what is the room topology that maps the game's broadcast surface onto Socket.IO rooms?

The constraint that shapes the answer is the game's single-round-at-a-time invariant. The `RoundLoopService` (ADR-017) runs ONE autonomous round at any instant — `BETTING → RUNNING → CRASHED → SETTLED` then the next round begins. There is never a moment where two rounds are live and a socket needs to choose which round's traffic to follow. Every connected player is watching the same round; the "current round" is global state, not per-socket state. This is the structural difference between Crash and a lobby-based game (poker, blackjack) where each table is an independent room and players genuinely partition across concurrent games.

REQ-WS-02 specifies the room model directly: each socket joins "a single global `lobby` room plus a per-user `user:{playerId}` private room." The Phase 6 RESEARCH (§4 Room model; §"ADRs Anticipated" ADR-021) flags this as the locked decision, citing ARCHITECTURE §7.2 and SUMMARY §8 (conflict resolution: "single `lobby` room"). REQ-WS-03 enumerates the events that ride each room: lobby carries `round:started` / `round:running` / `round:tick` / `round:crashed` / `round:settled` / `bet:placed` (masked) / `bet:cashed_out` (masked); `user:{playerId}` carries the three private `bet:my_*` events.

The `handleConnection` wiring (Plan 06-03, `game-ws.gateway.ts`) joins both rooms before emitting the per-socket `round:snapshot`, and the `WsBridgeConsumer` (Plan 06-06) reads `playerId` off each `game.events` AMQP envelope to fan a single bet event to BOTH `lobby` (masked `playerIdMasked = sha256(playerId).slice(0,8)`) and `user:{playerId}` (raw). Three room topologies were on the table at the Plan 06-03 design point.

## Considered

- **Option A — Per-round room (`round:{roundId}`)** — each socket joins a room named for the current round id; on every `round:settled → round:started` transition the gateway moves every socket from `round:{oldId}` to `round:{newId}`. Pros: textbook room-per-game-session pattern; theoretically supports concurrent rounds if the game ever became multi-table. Cons: introduces a `socket.join(round:{newId})` + `socket.leave(round:{oldId})` churn for every connected socket on every round boundary — at the default `BETTING_WINDOW_MS=5000` + `COOLDOWN_MS=2000` cadence that is a full room reshuffle roughly every 7-15 seconds, for zero scoping benefit because there is only ever one round. The join/leave storm scales linearly with connected sockets and recurs forever. Worse, the round-boundary reshuffle races the snapshot-on-connect logic: a socket connecting exactly at the `round:started` edge could join the old room, miss the migration, and silently stop receiving ticks. The RESEARCH §"Anti-Patterns to Avoid" calls this out explicitly: "Per-round room (`round:{roundId}`): ADR-021 explicitly forbids — adds join/leave churn every ~10s with zero scoping benefit (only one round at a time). Single `lobby` only."
- **Option B — Single global `lobby` + per-user `user:{playerId}` (chosen)** — every socket joins exactly two rooms at `handleConnection` and never leaves them until disconnect: `lobby` (the public broadcast surface, shared by all sockets) and `user:{playerId}` (the private surface, derived solely from the verified-JWT `sub` claim). Round transitions emit to `lobby` with no membership change — `server.to('lobby').emit('round:started', …)`. The multiplier tick is `server.to('lobby').volatile.emit('round:tick', …)`. Private bet confirmations emit to `server.to('user:{playerId}')`. Pros: zero room churn — membership is set once at connect and is stable for the connection's lifetime; `handleConnection` wiring is two `socket.join` calls and one snapshot emit, nothing to undo on round boundaries; the snapshot-race window collapses because there is no migration to race against; the `user:{playerId}` room gives strict per-player privacy (a socket can only be in its own user room because the room name comes from the server-verified `sub`, never from client input — T-06-07 mitigation). Cons: the topology is implicitly single-round — if the product ever ran concurrent rounds, the lobby would need re-partitioning; documented as a non-concern at Crash's scale (one round at a time by design).
- **Option C — Per-player segmentation only (no shared lobby)** — every socket joins only its `user:{playerId}` room; public events are delivered by iterating connected sockets or by `server.emit` (broadcast to all). Pros: no shared-room concept; simplest mental model for private events. Cons: loses the clean public/private split — `server.emit` (broadcast-to-everyone) cannot be scoped or namespaced, so any future need to address "everyone watching the lobby" versus "everyone connected for any reason" (e.g., a future admin socket, a metrics socket) becomes ambiguous; the masked bet feed (`bet:placed`) has no natural target room and would have to broadcast globally; loses the idiomatic Socket.IO room semantics that make the broadcast surface self-documenting. The lobby room IS the public broadcast surface as a first-class named concept; collapsing it into `server.emit` throws that away for no gain.

## Decision

**Option B — a single global `lobby` room plus a per-user `user:{playerId}` private room.** No per-round rooms exist anywhere in the gateway.

`handleConnection` (Plan 06-03, `services/games/src/presentation/gateways/game-ws.gateway.ts`) performs exactly:

```
socket.join("lobby");
socket.join(`user:${socket.data.playerId}`);
socket.emit("round:snapshot", snapshot);  // per-socket, idempotent across reconnects
```

`socket.data.playerId` is set ONLY by the `io.use()` JWT-verification middleware in `JwtIoAdapter` (Plan 06-03) from the verified `sub` claim — the client cannot influence which `user:{playerId}` room it joins. The room is never left or renamed for the connection's lifetime; the only membership change is the implicit leave-all on disconnect that Socket.IO handles internally.

Public broadcast surface (`lobby`):
- Round lifecycle: `round:started`, `round:running`, `round:crashed`, `round:settled` — emitted via `server.to('lobby').emit(...)` from `GameWsGateway` `@OnEvent` handlers driven by `RoundLoopService` transitions (Plan 06-05).
- Multiplier tick: `round:tick` — emitted via `server.to('lobby').volatile.emit(...)` at 30 Hz by `MultiplierBroadcastService` (Plan 06-04, ADR-022).
- Masked bet feed: `bet:placed`, `bet:cashed_out` — emitted via `server.to('lobby').emit(...)` by `WsBridgeConsumer` (Plan 06-06) with `playerIdMasked = sha256(playerId).slice(0,8)`.

Private surface (`user:{playerId}`):
- `bet:my_active`, `bet:my_cashed_out`, `bet:my_refunded` — emitted via `server.to('user:{playerId}').emit(...)` by `WsBridgeConsumer`, derived from the `playerId` carried in the `game.events` AMQP envelope.

Justified by REQ-WS-02 (literal room specification) + the single-round-at-a-time invariant (ADR-017 — only one autonomous round runs at any instant, so per-round partitioning has no subject to partition) + the join/leave churn cost of Option A recurring every ~7-15 s forever for zero benefit + the snapshot-race-window elimination (no membership migration to race against) + the strict per-player privacy of the `user:{playerId}` room sourced from the server-verified `sub` claim.

## Consequences

- **Locked in (room topology)**: every socket is in exactly `lobby` + `user:{playerId}`, set once at `handleConnection`, never changed until disconnect. Any future event added to the catalog must choose lobby (public, masked) or `user:{playerId}` (private, raw) — there is no third room. New room types require an ADR amendment.
- **Locked in (privacy boundary)**: the `user:{playerId}` room name is derived solely from `socket.data.playerId`, which is set only by the verified-JWT middleware. A client cannot join another player's user room because it cannot influence the room name. This is the T-06-07 (cross-player private events) mitigation, verified by `game-ws.gateway.connection.test.ts`.
- **Locked in (lobby is the public broadcast surface)**: `server.to('lobby')` is the canonical target for every public event. The masked bet feed, the multiplier tick, and round lifecycle all ride `lobby`. `server.emit` (broadcast-to-all-sockets-unconditionally) is NOT used for game traffic — every emit is room-scoped.
- **Locked in (dual-emit for bet events)**: `WsBridgeConsumer` emits each confirmed bet event TWICE — once masked to `lobby` (`bet:placed` / `bet:cashed_out`) and once raw to `user:{playerId}` (`bet:my_active` / `bet:my_cashed_out`) — from a single `game.events` AMQP message, deriving both room targets from the envelope's `playerId` (RESEARCH OQ 2 recommendation).
- **Foreclosed**: Option A per-round rooms (join/leave churn every round boundary; snapshot-race; no scoping benefit at single-round scale); Option C per-player-only (loses the named public broadcast surface; masked feed has no target room).
- **Operational cost**: none beyond two `socket.join` calls per connection. Room membership is O(1) per connection and stable; no per-round bookkeeping.
- **Scale-out note**: the single-`lobby` topology is implicitly single-round. If the product ever ran concurrent rounds (multi-table Crash), the lobby would need re-partitioning into per-table rooms — but that is a different product. At v1 scale (one autonomous round loop per ADR-017, documented `pg_try_advisory_lock` single-instance scope) the single lobby is correct. A multi-instance WS fan-out would additionally require the Socket.IO Redis adapter for cross-node room broadcast; out of scope per REQUIREMENTS "Distributed multi-instance horizontal scaling."
- **Test surface**: `tests/integration/ws-rooms.test.ts` (Plan 06-08) asserts a connecting socket joins `lobby` + `user:{id}` and that events route to the correct room; `game-ws.gateway.connection.test.ts` (Plan 06-03) covers the room-join logic at the unit level. Smoke probe 41 (Plan 06-09) confirmed snapshot-on-connect through Kong with `socket.data.playerId` set live.
- **Anticipated recruiter question**: "Why not a room per round? Isn't that the standard Socket.IO pattern for game sessions?" — defended by the single-round-at-a-time invariant: per-round rooms are correct when players partition across concurrent independent games (poker tables), but Crash runs exactly one global round at a time, so a per-round room would force a full membership reshuffle every ~7-15 s for zero scoping benefit, and would race the snapshot-on-connect logic at the round boundary.
- **Anticipated recruiter question**: "How do you guarantee a player can't subscribe to another player's private events?" — defended by the room-name derivation: `user:{playerId}` is built from `socket.data.playerId`, set only by the JWT-verification middleware from the verified `sub` claim, never from any client-supplied value (query, auth payload, or message body).

Cross-references: ADR-017 (autonomous round loop — the single-round-at-a-time invariant that makes per-round rooms pointless); ADR-022 (30 Hz tick — `round:tick` is the highest-volume traffic on the lobby room and uses `volatile.emit`); REQ-WS-02 (the literal room specification this ADR satisfies); Plan 06-03 SUMMARY (T-06-05/06/07 handshake + room-privacy mitigations).

## Alternatives Rejected

- **Option A — Per-round room (`round:{roundId}`)** — forces a `socket.join`/`socket.leave` reshuffle for every connected socket on every round boundary (~7-15 s cadence) with zero scoping benefit because only one round runs at a time; races the snapshot-on-connect logic at the round edge; RESEARCH §Anti-Patterns explicitly forbids it.
- **Option C — Per-player segmentation only (no shared lobby)** — loses the named public broadcast surface; the masked bet feed and round lifecycle would fall back to unconditional `server.emit` with no scoping handle; throws away idiomatic Socket.IO room semantics for no gain.
