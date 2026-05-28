---
phase: 06-websocket-multiplier-sync
plan: 04
subsystem: games-service / application multiplier broadcast
tags: [websocket, multiplier, volatile-emit, 30hz, broadcast]
dependency_graph:
  requires:
    - services/games/src/application/round-loop.service.ts getMultiplierAt (Phase 5 Plan 02)
    - services/games/src/presentation/gateways/game-ws.gateway.ts server reference (Phase 6 Plan 03)
    - services/games/src/config/defaults.ts SERVER_TICK_HZ (Phase 6 Plan 02)
  provides:
    - services/games/src/application/multiplier-broadcast.service.ts
  affects:
    - services/games/src/application/game-core.module.ts (provider + export)
tech_stack:
  added: []
  patterns:
    - recursive setTimeout (no setInterval) for drift-free 30Hz tick scheduling
    - volatile.emit ONLY at this service — gateway has zero volatile references
    - defensive try/catch in fireTick so a mid-tick round transition drops a single tick rather than killing the loop
    - finally-block reschedule guarantees the loop keeps ticking across thrown errors
key_files:
  created:
    - services/games/src/application/multiplier-broadcast.service.ts
    - services/games/tests/unit/multiplier-broadcast.service.test.ts
  modified:
    - services/games/src/application/game-core.module.ts
decisions:
  - Service uses recursive setTimeout (not setInterval) per RESEARCH §Architecture Pattern 3 and Pitfall 1 — Socket.IO volatile.emit drops more cleanly when scheduling waits for the previous send to complete
  - volatile.emit lives ONLY in this service — gateway file has zero volatile references (grep verified) — keeps the slow-consumer-safe semantics isolated from lifecycle emit paths
  - currentRoundId is set on start() and used inside fireTick rather than passed through scheduleNext closure — keeps stop() semantics clean (clearing state in one place)
  - getMultiplierAt throwing mid-tick is silently swallowed with no log entry — per RESEARCH Pitfall 2, logging at 30Hz floods logs and the throw is the expected signal that the round has transitioned out of RUNNING
  - Service is registered in GameCoreModule (not AppModule) so Plan 06-05 can inject it into RoundLoopService for start/stop on RUNNING/CRASHED transitions
metrics:
  duration_minutes: 18
  completed: 2026-05-28
  tasks_completed: 1
  files_changed: 3
  commits: 2
requirements:
  - REQ-WS-03
  - REQ-WS-06
---

# Phase 6 Plan 04: MultiplierBroadcastService Summary

30 Hz recursive-setTimeout loop that pulls the server-authoritative multiplier from `RoundLoopService.getMultiplierAt(now)` and emits `round:tick` to the `lobby` room via `volatile.emit`. The service exposes `start(roundId)` / `stop()` for Plan 06-05's lifecycle bridge to drive on RUNNING/CRASHED transitions. The service is the single owner of `volatile.emit` in the codebase — all lifecycle and bet events continue to use regular `emit`.

## Goal

Ship the multiplier broadcast loop with slow-consumer-safe semantics, idempotent start/stop, and defensive handling of mid-tick round transitions, fully unit-tested without booting Socket.IO or NestJS.

## Tasks Completed

| Task | Description                                                                                                 | Commit  | Files                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.RED   | Failing unit tests for start/stop idempotency, payload shape, mid-tick throw handling                       | 7d8ae37 | tests/unit/multiplier-broadcast.service.test.ts (new)                                                                                                                            |
| 1.GREEN | MultiplierBroadcastService implementation + GameCoreModule wiring                                            | 71f614b | services/games/src/application/multiplier-broadcast.service.ts (new), services/games/src/application/game-core.module.ts (provider + export)                                    |

## Behavior Locked

- `start(roundId: string)` is idempotent — second call without intervening `stop()` returns immediately.
- Each scheduled tick computes `now = new Date()`, calls `roundLoop.getMultiplierAt(now)`, and emits `round:tick` with `{ roundId, multiplier: m.toNumber(), t: now.getTime() }` to room `lobby` via `volatile.emit`.
- If `getMultiplierAt` throws (round transitioned out of RUNNING between schedule and fire), the tick is silently dropped, the loop reschedules normally via the `finally` block.
- `stop()` clears the active timer (`clearTimeout` + `timer = null`), sets `running = false`, nulls `currentRoundId`. Subsequent calls are no-ops.
- Tick interval = `Math.max(1, Math.round(1000 / env.SERVER_TICK_HZ))` — 33 ms at the default 30 Hz; the `Math.max(1, …)` guards against degenerate high-Hz config.
- No log entries per tick (would flood at 30 Hz). The service-level logger is constructed but only emits at construction time via NestJS.

## Verification

- `cd services/games && bunx tsc --noEmit` — clean
- `cd services/games && bun test tests/unit/multiplier-broadcast.service.test.ts` — 6 pass / 0 fail / 35 expect()
- `grep -v '^//' services/games/src/application/multiplier-broadcast.service.ts | grep -c 'setInterval'` returns **0**
- `grep -c 'volatile.emit' services/games/src/application/multiplier-broadcast.service.ts` returns **1**
- `grep -c 'MultiplierBroadcastService' services/games/src/application/game-core.module.ts` returns **3** (import + provider + export)
- `grep -c 'volatile' services/games/src/presentation/gateways/game-ws.gateway.ts` returns **0**

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 3 — Blocking parallel-wave interaction] Plan 06-05's WIP introduced a circular dependency between `RoundLoopService` and `MultiplierBroadcastService`.** The plan body explicitly anticipated this: "if the planner discovers a cycle during execution, switch to `Inject(forwardRef(...))` and document in SUMMARY as a Rule-3 deviation". My commit for 06-04 lands with the **direct injection form** (no forwardRef, no string token) as the plan body's `<action>` describes. Plan 06-05's agent committed a refactor on top that switches my service to `@Inject(ROUND_LOOP_SERVICE)` with `import type` to break both the Nest DI cycle and the ESM import cycle. That refactor is properly scoped to 06-05 (cycle-resolution belongs to the plan that introduced the cycle).
   - Files affected in my commits: none beyond the plan's scope
   - Files affected in 06-05's follow-up rewrite: `services/games/src/application/multiplier-broadcast.service.ts` (token-based injection)
   - Commit hash for my work: `71f614b` (direct-injection form preserved in history)

2. **[Rule 3 — Cross-plan ordering] Plan 06-05's parallel WIP modified `RoundLoopService` and its test file, causing 5 transient failures in `round-loop.get-multiplier-at.test.ts` during my development.** Verified those failures are NOT regressions from my changes — `git stash` reproducing the pre-06-05 tree shows the multiplier tests pass. Failures are 06-05 territory and will resolve when 06-05's wave-3 commit lands cleanly.
   - Files affected: none in my scope
   - Resolution: deferred to 06-05 plan execution

### Non-blocking observations

- `app.module.ts` currently still registers `GameWsGateway` only in `AppModule.providers` (per plan 06-03). NestJS providers in a parent module are NOT visible to child-module providers by default; the runtime DI graph would fail to construct `MultiplierBroadcastService` because `GameCoreModule` cannot resolve `GameWsGateway`. The plan body asserted "this works because `AppModule` imports `GameCoreModule`, so DI resolves `GameWsGateway` from the parent module" — that assertion is incorrect for plain (non-`@Global()`) modules. This is a known wiring gap that the integration plan (likely 06-07 or 06-08) must address by either (a) moving `GameWsGateway` to `GameCoreModule.providers` and re-exporting, (b) marking the gateway's host module as `@Global()`, or (c) introducing a dedicated `WsModule` exported and imported wherever needed. I did NOT touch `app.module.ts` to honor the parallel-wave scope ("Touch ONLY four files"). Unit tests pass because they mock the gateway entirely.

## Threat Coverage

| Threat ID | Disposition | Implementation site                                                                                                   | Verified by                                                                                            |
| --------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| T-06-09   | mitigated   | `volatile.emit` in `fireTick` drops tick packets at the slow consumer's transport rather than queueing                | `multiplier-broadcast.service.test.ts` — the stub captures `.volatile.emit` access (not `.emit`)        |
| T-06-10   | mitigated   | `try/catch` around `getMultiplierAt` + `finally`-block reschedule — a mid-tick CRASHED transition drops the tick silently | `multiplier-broadcast.service.test.ts` case "when getMultiplierAt throws, tick is dropped silently AND scheduling continues" |
| T-06-11   | accept      | Tick payload carries only `{ roundId, multiplier, t }` — no player-level data leaks to `lobby`                        | Manual inspection of the emitted payload shape; the test asserts exact payload keys                    |

## Out-of-Scope Pre-Existing Modifications Observed

- Plan 06-05 wave-3 WIP present in working tree (uncommitted at time of my commit): modifications to `app.module.ts` (`EventEmitterModule.forRoot()`), `round-loop.service.ts` (EventEmitter2 injection, lifecycle event emits), `round-loop.service.test.ts`, and a new `game-events.ts`. None staged or committed by 06-04.
- Plan 06-06 wave-3 work landed before my final commit: `WsBridgeConsumer` + bindings in `app.module.ts`. Did not interact with my code paths.

## Known Stubs

None — the service has its full intended behavior. The integration of `start()`/`stop()` calls from `RoundLoopService` state transitions is plan 06-05's surface (not a stub here — by design).

## Next Plans

- 06-05 — `EventEmitter2`-based lifecycle bridge in `RoundLoopService` will call `MultiplierBroadcastService.start(roundId)` on RUNNING entry and `.stop()` on CRASHED entry; resolves the gateway-DI wiring as a side-effect (06-05 already committed a token-based injection refactor on top of my work).
- 06-06 — `WsBridgeConsumer` (committed in parallel) consumes `game.events` and emits bet events via gateway — orthogonal to this tick path.
- 06-07/08 — integration tests + Kong route — will exercise the full runtime DI graph and catch any residual wiring gap.

## Self-Check: PASSED

- `services/games/src/application/multiplier-broadcast.service.ts` — FOUND
- `services/games/tests/unit/multiplier-broadcast.service.test.ts` — FOUND
- Commit `7d8ae37` (RED) — FOUND in `git log`
- Commit `71f614b` (GREEN) — FOUND in `git log`
- `bunx tsc --noEmit` clean — VERIFIED
- `bun test tests/unit/multiplier-broadcast.service.test.ts` 6 pass / 0 fail — VERIFIED
- All four grep verifications pass — VERIFIED
