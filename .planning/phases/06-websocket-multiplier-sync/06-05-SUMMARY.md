---
phase: 06-websocket-multiplier-sync
plan: 05
subsystem: presentation + application
tags: [websocket, event-emitter, round-lifecycle, decoupling]
requires:
  - 06-03 (GameWsGateway scaffold)
  - 06-04 (MultiplierBroadcastService)
provides:
  - GAME_EVENTS constants for in-process domain event bus
  - RoundLoopService lifecycle emission (round.started, round.running, round.crashed, round.settled)
  - GameWsGateway @OnEvent fan-out to lobby room
affects:
  - services/games/src/application/round-loop.service.ts
  - services/games/src/application/multiplier-broadcast.service.ts
  - services/games/src/application/game-events.ts (new)
  - services/games/src/application/game-core.module.ts (string-token registrations)
  - services/games/src/application/tokens.ts
  - services/games/src/app.module.ts (EventEmitterModule.forRoot)
  - services/games/src/presentation/gateways/game-ws.gateway.ts
tech-stack:
  added: []
  patterns:
    - "@nestjs/event-emitter EventEmitter2 in-process pub/sub"
    - "@OnEvent decorator for gateway fan-out"
    - "string DI tokens with type-only imports to break ESM circular deps"
key-files:
  created:
    - services/games/src/application/game-events.ts
    - services/games/tests/unit/game-ws.gateway.lifecycle.test.ts
  modified:
    - services/games/src/application/round-loop.service.ts
    - services/games/src/application/multiplier-broadcast.service.ts
    - services/games/src/application/tokens.ts
    - services/games/src/presentation/gateways/game-ws.gateway.ts
    - services/games/tests/unit/round-loop.service.test.ts
    - services/games/tests/unit/round-loop.get-multiplier-at.test.ts
decisions:
  - "String DI tokens (ROUND_LOOP_SERVICE, MULTIPLIER_BROADCAST_SERVICE) with type-only imports avoid both forwardRef and ESM circular evaluation errors between RoundLoopService and MultiplierBroadcastService"
  - "Internal event payloads structurally identical to the wire payloads in ws-event.payloads.ts — gateway @OnEvent handlers pass payload through without transformation"
  - "multiplierBroadcast.stop() runs BEFORE eventEmitter.emit(round.crashed) so no in-flight tick can land after the crash event"
metrics:
  duration: "single execution wave"
  tasks_completed: 2
  files_changed: 8
  commits:
    - 47f15f3: "feat(06-05): emit round lifecycle events via EventEmitter2 in RoundLoopService"
    - 0ae6ef7: "feat(06-05): add @OnEvent lifecycle handlers to GameWsGateway"
---

# Phase 6 Plan 05: Round Lifecycle Event Bus Summary

In-process EventEmitter2 wires RoundLoopService state transitions to GameWsGateway lobby broadcasts; multiplier broadcast loop bracketed by RUNNING/CRASHED transitions to eliminate post-crash tick leaks.

## What changed

### `services/games/src/application/game-events.ts` (new)

Canonical event-name constants `GAME_EVENTS = { ROUND_STARTED, ROUND_RUNNING, ROUND_CRASHED, ROUND_SETTLED }` plus re-exported payload types aliased from the wire DTOs in `ws-event.payloads.ts`. Internal event shape is structurally identical to the wire format, so the gateway never re-maps.

### `services/games/src/application/round-loop.service.ts`

Constructor extended with two new dependencies:

- `EventEmitter2` (resolved by NestJS via the `EventEmitterModule.forRoot()` registration done in 06-02's previous app.module work; the module is now invoked from `AppModule.imports`).
- `MultiplierBroadcastService` injected via the string token `MULTIPLIER_BROADCAST_SERVICE` with a `type-only` import. The string token short-circuits the ESM module-graph cycle (`RoundLoopService` ↔ `MultiplierBroadcastService`) that classic class-identifier injection would create.

Lifecycle hook insertions:

| Method | Emit | Side effect | Order |
|---|---|---|---|
| `startNewRound` | `round.started` | — | emit AFTER `scheduleAt` |
| `transitionToRunning` | `round.running` | `multiplierBroadcast.start(roundId)` | start FIRST, then emit |
| `crashRound` | `round.crashed` | `multiplierBroadcast.stop()` | **stop BEFORE emit** (T-06-12 mitigation) |
| `settleRound` | `round.settled` | — | emit AFTER `scheduleAt` |

The `crashRound` ordering is the key correctness invariant: stopping the broadcast loop before publishing `round.crashed` guarantees no `round:tick` lands after `round:crashed` on the wire.

### `services/games/src/application/multiplier-broadcast.service.ts`

Switched its `RoundLoopService` dependency to the string token `ROUND_LOOP_SERVICE` with a `type-only` import — the second half of the ESM cycle break.

### `services/games/src/application/game-core.module.ts`

`MultiplierBroadcastService` and `RoundLoopService` are registered both under their class identifiers AND under their string tokens (`useExisting`), so existing class-based consumers (e.g. cashout controller) keep working while the cycle-prone pair uses tokens.

### `services/games/src/presentation/gateways/game-ws.gateway.ts`

Four new `@OnEvent`-decorated methods:

```ts
@OnEvent(GAME_EVENTS.ROUND_STARTED)
onRoundStarted(payload: RoundStartedPayload): void {
  this.server.to("lobby").emit("round:started", payload);
}
// ...running, crashed, settled identical shape
```

All four use regular `emit`, NOT `volatile.emit`. Per REQ-WS-06 and the research anti-patterns list, `volatile.emit` is reserved for `round:tick` ONLY — lifecycle events are guaranteed-delivery.

## Verification (plan §verification)

| Check | Result |
|---|---|
| `grep -c '@OnEvent' services/games/src/presentation/gateways/game-ws.gateway.ts` | 4 |
| `grep -c 'GAME_EVENTS' services/games/src/application/round-loop.service.ts` | 5 |
| `grep -v '^//' services/games/src/presentation/gateways/game-ws.gateway.ts \| grep -c 'volatile'` | 0 |
| `grep -c 'forwardRef' services/games/src/application/round-loop.service.ts` | 0 |
| `grep -c 'EventEmitterModule.forRoot' services/games/src/app.module.ts` | 1 |
| `grep -c 'multiplierBroadcast.start\|multiplierBroadcast.stop' services/games/src/application/round-loop.service.ts` | 2 |
| `cd services/games && bunx tsc --noEmit` | clean |
| `cd services/games && bun test tests/unit` | 221 pass / 0 fail / 729 expect() calls |

## Deviations from Plan

### Rule 3 — auto-fix blocking issue: ESM circular dependency via string DI tokens

The plan's `<action>` block suggested injecting `MultiplierBroadcastService` directly into `RoundLoopService` and using `forwardRef` only between `RoundLoopService` and the gateway. In practice, `MultiplierBroadcastService` already injects `RoundLoopService` (per 06-04), so adding `RoundLoopService → MultiplierBroadcastService` creates a NestJS DI cycle AND a hard ESM module-graph cycle that the runtime catches before DI even starts:

```
ReferenceError: Cannot access 'RoundLoopService' before initialization
```

`forwardRef(() => X)` does not help here because `X` must be resolvable as a value at the time the decorator runs — under ESM with a cycle, the identifier is hoisted but the binding is in the temporal-dead-zone until the other module finishes loading.

Fix: introduce two string DI tokens (`ROUND_LOOP_SERVICE`, `MULTIPLIER_BROADCAST_SERVICE`) in `tokens.ts`. Each consumer uses `@Inject(TOKEN)` with a `type-only` import of the peer class. The module registers each concrete class plus an alias provider via `{ provide: TOKEN, useExisting: ConcreteClass }` so the runtime resolution path resolves through the existing singleton.

This preserves the plan's explicit constraint "NO forwardRef between RoundLoopService and Gateway" (still true — the gateway-vs-round-loop coupling is decoupled via the event bus) while resolving the orthogonal RoundLoopService-vs-MultiplierBroadcastService cycle that the plan's action block did not anticipate.

### Rule 1 — bug fix: payload shape aligned to wire schema

The plan's `<action>` block for `crashRound` proposed emitting `{ roundId, crashPoint, serverSeed: null, nextSeedHash: null }` and for `settleRound` `{ roundId, settledAt, serverSeed, nextSeedHash }`. The `must_haves.truths` block however locks the four payloads to conform to the schemas in 06-03's `ws-event.payloads.ts`:

- `roundCrashedPayloadSchema` = `{ roundId, crashPoint, crashedAt }`
- `roundSettledPayloadSchema` = `{ roundId, serverSeed, settledAt }`

There is no `serverSeed` / `nextSeedHash` field on the wire crash payload, and no `nextSeedHash` on the wire settle payload. Following the must-have truth (wire-stable) over the action hint, the emit calls produce schema-conformant payloads. This also removes the unnecessary `chain.findHashByNonce(nonce + 1n)` lookup the action block would have required — the next round's `seedHash` is already published on the subsequent `round.started` event.

If a future plan wants the seed-chain hash exposed at crash or settle time, it can extend the schema in `ws-event.payloads.ts` and update the emit + gateway pass-through in lockstep.

## Threat Flags

None. The three threats in the plan's `<threat_model>` are all mitigated:

| Threat | Mitigation |
|---|---|
| T-06-12 (post-crash tick leak) | `multiplierBroadcast.stop()` precedes `emit(ROUND_CRASHED)` in `crashRound` |
| T-06-13 (premature seed disclosure) | `round.crashed` payload contains NO `serverSeed`; the field only appears on `round.settled` per the wire schema |
| T-06-14 (out-of-order delivery) | `EventEmitter2.emit` is synchronous; `@OnEvent` handlers run in the same tick; per-round order is preserved by the existing recursive `setTimeout` schedule |

## Known Stubs

None. All four lifecycle emits have populated payloads sourced from the live round aggregate.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`), but both tasks are `tdd="true"`. The commits combine RED+GREEN per task into a single `feat(...)` commit for atomicity; pre-commit each task ran with the test suite failing first (4 fail for Task 1, 5 fail for Task 2) then passing after implementation.

## Self-Check: PASSED

- `services/games/src/application/game-events.ts` FOUND
- `services/games/tests/unit/game-ws.gateway.lifecycle.test.ts` FOUND
- Commit `47f15f3` FOUND
- Commit `0ae6ef7` FOUND
- 221/221 unit tests passing
- `bunx tsc --noEmit` clean
