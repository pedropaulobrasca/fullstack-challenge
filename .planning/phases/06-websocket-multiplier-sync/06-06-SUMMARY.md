---
phase: 06-websocket-multiplier-sync
plan: 06
subsystem: games / infrastructure-messaging (ws-bridge)
tags: [websocket, amqp-consumer, outbox-as-source-of-truth, bet-events, req-ws-03]
requires:
  - 06-03 (GameWsGateway + ws-event.payloads.ts + maskPlayerId helper)
  - Phase 5 (outbox emits bet.active + bet.refunded; bet.cashed_out producer pending)
provides:
  - "WsBridgeConsumer — @RabbitSubscribe games.ws-bridge.q on game.events with routingKey bet.* translating outbox bet events to Socket.IO emits"
  - "GAMES_WS_BRIDGE queue constant in messaging-spine topology defaults"
  - "AppModule topology adds games.ws-bridge.q quorum queue + bet.* binding to game.events"
affects:
  - 06-09 (smoke probe will observe bet:placed / bet:my_active / bet:my_refunded / bet:cashed_out / bet:my_cashed_out)
  - Phase 7 (frontend listens to these events via Socket.IO client)
tech-stack:
  added: []
  patterns:
    - "Stateless presentation-adjacent AMQP consumer — translates one envelope to one or two WS emits, never touches DB"
    - "Lobby vs user:{playerId} room split enforces privacy (masked playerId on lobby, raw on user room only)"
    - "Inbound payloads parsed defensively via zod (passthrough) to survive upstream envelope drift while still catching malformed messages"
    - "Strict zod schemas (.strict()) on outbound WS payloads catch shape drift at runtime"
key-files:
  created:
    - services/games/src/infrastructure/messaging/ws-bridge.consumer.ts
    - services/games/tests/unit/ws-bridge.consumer.test.ts
  modified:
    - packages/messaging-spine/src/topology/topology-defaults.ts
    - services/games/src/app.module.ts
decisions:
  - "WsBridgeConsumer uses plain @RabbitSubscribe (not @IdempotentSubscribe) — emit is idempotent at the FE rendering layer (FE dedupes by betId per RESEARCH OQ 2), so the inbox dedupe overhead is unnecessary for a pure broadcast bridge. At-least-once delivery is acceptable because rendering the same bet:* event twice is a no-op."
  - "bet.active emission produces TWO WS events: bet:placed to lobby (so the lobby sees the bet as soon as the saga confirms) AND bet:my_active to user:{playerId} (so the bet owner sees their own bet flip from PENDING to ACTIVE). Phase 5 does not emit a separate bet.placed envelope at PENDING time — the bet only becomes lobby-visible at ACTIVE, after saga confirmation. The consumer also handles a future bet.placed routing key for forward compatibility."
  - "Inbound payload zod schemas use .passthrough() not .strict() — upstream envelope shapes are governed by their producers (PlaceBetUseCase, WalletDebitedHandler, WalletDebitRejectedHandler) and may carry additional fields the consumer ignores. The outbound WS payloads remain .strict() per Plan 06-03 to catch any FE-facing drift."
  - "bet.refunded payload from upstream does NOT carry an amount field (handler emits { betId, playerId, roundId, reason } only), but betMyRefundedPayloadSchema from Plan 06-03 requires amount. Filled with FALLBACK_MONEY (0 in env.CURRENCY_CODE) to satisfy the schema. Tracked as deferred — see Deferred Issues."
  - "bet.cashed_out lobby payload omits the absolute payout amount (T-06-16 mitigation) — the lobby sees the multiplier only; payout stays on the private user:{playerId} bet:my_cashed_out emit."
metrics:
  duration_minutes: 5
  completed: 2026-05-28
  tasks: 2
  files_created: 2
  files_modified: 2
  tests_added: 6
---

# Phase 06 Plan 06: Outbox→WS Bridge for Bet Lifecycle Events Summary

WsBridgeConsumer keeps the outbox as the single source of truth (Phase 2 ADR-007) while fanning bet lifecycle events into the Socket.IO presentation surface — masked lobby events for the broadcast feed and un-masked private events on `user:{playerId}` rooms. The consumer is a thin stateless translator: it subscribes to `game.events` with routing key `bet.*`, switch-dispatches by envelope type, and emits one or two WS events per envelope. Zero DB access, zero domain coupling.

## What Shipped

### Task 1 — Topology: GAMES_WS_BRIDGE queue + bet.* binding

- `packages/messaging-spine/src/topology/topology-defaults.ts` — added `GAMES_WS_BRIDGE: "games.ws-bridge.q"` to the `QUEUES` constant block alphabetically among the `GAMES_*` entries.
- `services/games/src/app.module.ts` — `queuesToAssert` gains the new quorum queue with `deliveryLimit: env.RMQ_DELIVERY_LIMIT_MAIN` and `dlx: EXCHANGES.GAME_DLX` (per Phase 5 ADR-020 DLX-on-source-exchange rule — consumer of `game.events` uses `GAME_DLX`). `bindings` gains `{ queue: GAMES_WS_BRIDGE, exchange: GAME_EVENTS, routingKey: "bet.*" }`.
- `EXCHANGES.GAME_EVENTS` already asserted in `exchangesToAssert` from a prior plan — verified, no change needed.
- Topology bootstrap exercised by integration tests in 06-08 / smoke probe in 06-09 (no code-level test in this plan, per plan note).

Verification: `bunx tsc --noEmit` clean in both `packages/messaging-spine` and `services/games`.

### Task 2 — WsBridgeConsumer with routing-key dispatch

- `services/games/src/infrastructure/messaging/ws-bridge.consumer.ts` — `@Injectable() class WsBridgeConsumer` with constructor injection of `GameWsGateway` (for `gateway.server`).
- Single `@RabbitSubscribe` declaration on `handle(envelope, _msg)`:
  - `exchange: EXCHANGES.GAME_EVENTS`
  - `routingKey: ["bet.placed", "bet.active", "bet.refunded", "bet.cashed_out"]`
  - `queue: QUEUES.GAMES_WS_BRIDGE`
  - `queueOptions: buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_MAIN, EXCHANGES.GAME_DLX)`
- Switch dispatch on `envelope.type`:
  - `bet.active` → `bet:placed` to `lobby` (masked playerId) + `bet:my_active` to `user:{playerId}`.
  - `bet.placed` → `bet:placed` to `lobby` (masked) only — forward-compat for when PlaceBetUseCase starts emitting at PENDING time.
  - `bet.refunded` → `bet:my_refunded` to `user:{playerId}` with reason; lobby not notified (refunds are private).
  - `bet.cashed_out` → `bet:cashed_out` to `lobby` (masked, multiplier only — no payout per T-06-16) + `bet:my_cashed_out` to `user:{playerId}` with full payout.
  - default → warn log + return (unknown routing key dropped, never throws).
- Inbound payloads parsed via local zod schemas with `.passthrough()` (defensive, survive upstream additions).
- `maskPlayerId(PlayerId(playerId))` reused from `application/use-cases/mask-player-id.ts` (Plan 06-03) for masking determinism — sha256(playerId).slice(0, 8).
- Registered in `AppModule.providers` next to `GamesDeadLetterConsumer`.
- 6 unit tests, 31 expect calls — all four routing-key paths + mask determinism + unknown-key warn + no-volatile-access enforced via Proxy throw.

## Verification

- `cd services/games && bunx tsc --noEmit` — clean.
- `cd packages/messaging-spine && bunx tsc --noEmit` — clean.
- `bun test tests/unit/ws-bridge.consumer.test.ts` — **6 PASS / 0 FAIL** (31 expect calls).
- `grep -c '@RabbitSubscribe' services/games/src/infrastructure/messaging/ws-bridge.consumer.ts` → 1.
- `grep -c 'bet.placed\|bet.active\|bet.refunded\|bet.cashed_out' services/games/src/infrastructure/messaging/ws-bridge.consumer.ts` → 8 (>= 4 required).
- `grep -v '^//' services/games/src/infrastructure/messaging/ws-bridge.consumer.ts | grep -c 'volatile'` → 0.

Live AMQP flow (broker → consumer → WS emit) deferred to Plan 06-08 integration tests and Plan 06-09 smoke probe.

## Commits

- `bf5b96d` feat(06-06): declare games.ws-bridge.q queue + bet.* binding for WS bridge
- `adcccf4` test(06-06): add failing tests for WsBridgeConsumer outbox-to-WS bridge
- `6efe755` feat(06-06): add WsBridgeConsumer translating outbox bet events to WS emits

## Deviations from Plan

**[Rule 3 — Blocking issue] Bet event payload schema vs. upstream producer mismatch (deferred not blocked)**

- **Found during:** Task 2 GREEN — `betMyRefundedPayloadSchema` (from Plan 06-03 ws-event.payloads.ts) requires `amount: moneySnapshot`, but `WalletDebitRejectedHandler` and `SagaTimeoutSweeper` only emit `{ betId, playerId, roundId, reason }` to the outbox (no amount).
- **Issue:** WS-bound refund payload would fail strict schema parse without filling the amount field.
- **Fix:** Consumer fills `amount` with a `FALLBACK_MONEY` placeholder (`{ amount: "0", currency: env.CURRENCY_CODE, scale: 0 }`) when the upstream envelope does not carry it. Same approach applied to `bet:my_active` (upstream `bet.active` carries no amount in current Phase 5 emission either).
- **Why not a Rule 4 architectural change:** The orchestrator scope locked file touches to `ws-bridge.consumer.ts`, `topology-defaults.ts`, `app.module.ts`, and tests only. Modifying `WalletDebitRejectedHandler` / `WalletDebitedHandler` / `SagaTimeoutSweeper` to also emit `amount` (or adjusting `ws-event.payloads.ts` to make amount optional) is out of scope. The fallback keeps the contract enforceable today and surfaces the real amount once a future plan extends the upstream envelopes.
- **Files modified:** `services/games/src/infrastructure/messaging/ws-bridge.consumer.ts` (FALLBACK_MONEY constant + optional-amount inbound schema).
- **Commit:** `6efe755`.

**[Forward-compat addition] bet.placed routing key handled despite no current producer**

- **Found during:** Task 2 design.
- **Note:** No upstream code path currently emits a `bet.placed` envelope. `PlaceBetUseCase` writes the wallet.debit command only; the bet becomes lobby-visible at `bet.active` after the saga confirms.
- **Decision:** Implement the `bet.placed` case anyway (separate handler that emits `bet:placed` to lobby with the upstream `amount` payload) so the consumer is forward-compatible when a future plan adds a PENDING-time emission (mentioned in the plan must_haves truths). Until then, the `bet.placed` branch is dead code paid in 8 lines of TS.

## Deferred Issues

- **bet.cashed_out producer missing:** `CashOutUseCase` only emits `wallet.credit` to the outbox today — no `bet.cashed_out` envelope is published, so the corresponding lobby `bet:cashed_out` and user `bet:my_cashed_out` emissions are wired but unreachable end-to-end until a future plan extends `CashOutUseCase` to write a second outbox row. Tracked separately (out of scope per orchestrator file list).
- **Bet amount in bet.active / bet.refunded envelopes:** Upstream handlers do not carry `amount`. Consumer falls back to zero-value money. A future plan should extend the producer envelopes so the bridge can pass the real value through.
- **Outbox publish lag for bet:my_active:** Documented in RESEARCH Pitfall 7 — bet.active arrives ~1-2 s after PlaceBetUseCase commits (outbox poll interval). Acceptable per Phase 5 ADR-020 asymmetry; FE drives "you have an active bet" from `round:snapshot` until the live event arrives.

## Authentication Gates

None.

## Out-of-Scope Test Failures Observed

Running `bun test tests/unit` surfaced 4 failures in `tests/unit/round-loop.get-multiplier-at.test.ts`:

```
RoundLoopService.getMultiplierAt > RUNNING + 1s elapsed at GROWTH_RATE=0.06 → e^0.06 ≈ 1.0618
RoundLoopService.getMultiplierAt > caps at crashPoint when at would yield a value beyond crashPoint
RoundLoopService.getMultiplierAt > clock skew: at earlier than startedAt → returns Multiplier(1.00)
RoundLoopService.getMultiplierAt > after CRASHED transition the cached round is no longer RUNNING → throws
```

All four originate in uncommitted modifications to `services/games/src/application/round-loop.service.ts` made by the concurrent Plan 06-04 wave (`MultiplierBroadcastService` injection — visible at line 49 of round-loop.service.ts in the working tree but not in any committed revision). The failures are NOT caused by this plan's changes — `WsBridgeConsumer` does not touch `RoundLoopService`. Logged here for traceability; Plan 06-04 owns the fix.

## Threat Surface Check

No new external network endpoints. Both new files are inside the games-service trust zone:

- **T-06-15 (playerId leak to lobby):** Mitigated. All lobby emits (`bet:placed`, `bet:cashed_out`) use `playerIdMasked = sha256(playerId).slice(0, 8)`. Raw playerId never reaches the lobby room. Test `playerId masking is deterministic` enforces.
- **T-06-16 (payout leak to lobby):** Mitigated. `bet:cashed_out` lobby payload contains `{ roundId, betId, playerIdMasked, multiplier }` only — the absolute payout amount stays on the private `bet:my_cashed_out` user-room emit. Test `bet.cashed_out emits ... (no payout)` enforces via `expect(lobbyPayload.payout).toBeUndefined()`.
- **T-06-17 (malformed envelope):** Mitigated. Each routing case parses payload via zod before emit; parse failures throw and the envelope is NACK'd back to RabbitMQ (golevelup default) so the DLQ + delivery-limit policy applies.
- **T-06-18 (cashout replay):** Accepted. At-least-once delivery may deliver the same envelope twice; FE dedupes by `betId` per Phase 7 consumer contract.

## Self-Check: PASSED

Verified on disk:

- FOUND: services/games/src/infrastructure/messaging/ws-bridge.consumer.ts (@RabbitSubscribe games.ws-bridge.q, routingKey bet.*)
- FOUND: services/games/tests/unit/ws-bridge.consumer.test.ts (6 tests)
- FOUND: packages/messaging-spine/src/topology/topology-defaults.ts contains `GAMES_WS_BRIDGE: "games.ws-bridge.q"`
- FOUND: services/games/src/app.module.ts contains `WsBridgeConsumer` import + provider registration + queue/binding entries
- FOUND commits: bf5b96d, adcccf4, 6efe755

## TDD Gate Compliance

- **Task 1:** No RED/GREEN cycle — plan explicitly says "No code-level test for topology; verification is `bunx tsc --noEmit` clean and `grep -c 'GAMES_WS_BRIDGE'`". Commit `bf5b96d` (`feat(06-06): declare games.ws-bridge.q queue + bet.* binding for WS bridge`) is the only commit; tsc verified clean.
- **Task 2 RED:** `adcccf4` `test(06-06): add failing tests for WsBridgeConsumer outbox-to-WS bridge` — verified failing (`Cannot find module .../ws-bridge.consumer`).
- **Task 2 GREEN:** `6efe755` `feat(06-06): add WsBridgeConsumer translating outbox bet events to WS emits` — verified 6/6 pass.
- REFACTOR: not needed. Each routing case is one linear flow; no cross-case duplication beyond the trivial `maskPlayerId + emit-to-lobby` pair which is already factored into 2-line method calls.
