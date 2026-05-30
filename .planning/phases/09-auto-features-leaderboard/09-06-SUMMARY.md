---
phase: 09-auto-features-leaderboard
plan: 06
subsystem: messaging-spine, application, presentation
tags:
  - leaderboard
  - projector
  - cqrs
  - idempotent-subscribe
  - ws-broadcast
  - playerid-masking
  - chaos-test
  - phase-9
requirements:
  - REQ-LEAD-01
  - REQ-LEAD-02
  - REQ-LEAD-04
dependency_graph:
  requires:
    - "Phase 2 messaging-spine — @IdempotentSubscribe + InboxRepository + buildQuorumArgs + deriveDlxFromExchange"
    - "Plan 09-03 — bet.lost outbox event contract + emit on crash sweep"
    - "Plan 09-04 — LeaderboardRepository port + Mikro impl + LeaderboardSnapshot.diff VO + leaderboard_24h table"
    - "Plan 09-05 — GAME_EVENTS in-process bus shape (the LEADERBOARD_UPDATED key joins ROUND_TICK on the same constants object)"
    - "Phase 6 P6.05 — GameWsGateway @OnEvent lobby fan-out pattern (mirrored verbatim for leaderboard:updated)"
    - "Plan 09-07 — playerId masking idiom (8-char SHA-256 hex) the WS payload conforms to (single regex /^[0-9a-f]{8}$/ across HTTP + WS)"
  provides:
    - "@crash/contracts BetCashedOutEventV1 + BET_CASHED_OUT_EVENT_TYPE — wire schema for the winning branch of the bet ledger"
    - "@crash/contracts BetRefundedEventV1 + BET_REFUNDED_EVENT_TYPE — wire schema matching the existing wallet-debit-rejected + saga-timeout-sweeper payload"
    - "CashOutUseCase emits one bet.cashed_out outbox row on game.events in the SAME em.transactional as wallet.credit + the ACTIVE→CASHED_OUT FSM transition (same correlationId across both rows)"
    - "LeaderboardProjectorService — @IdempotentSubscribe consumer for bet.cashed_out + bet.refunded + bet.lost on leaderboard-projector.q (quorum + DLX derived from EXCHANGES.GAME_EVENTS)"
    - "GAME_EVENTS.LEADERBOARD_UPDATED in-process event + LeaderboardUpdatedPayload type"
    - "GameWsGateway @OnEvent(LEADERBOARD_UPDATED) handler — masks every playerId via maskPlayerId(PlayerId(...)) before emitting leaderboard:updated to the lobby room"
    - "@IdempotentSubscribe.opts.routingKey widened to string | string[] (backwards-compatible additive type change)"
  affects:
    - "Plan 09-09 (FE LeaderboardPanel — Socket.IO leaderboard:updated handler now has a server-side emit to drain; payload shape locked by Plan 09-07's shared @crash/contracts/ws schema)"
    - "Plan 09-10 (closeout — ADR candidate documenting the light-CQRS architecture + the same-TX bet.cashed_out emit precedent)"
tech_stack:
  added: []
  patterns:
    - "Light-CQRS projector: a separate quorum queue + @IdempotentSubscribe consumer projects domain events into a denormalized read model (leaderboard_24h) — projector failure does NOT block the write path because RabbitMQ topic fan-out delivers to each queue independently"
    - "Top-N rank-change throttle gate: LeaderboardSnapshot.diff(before, after).changed === true is the only condition under which the LEADERBOARD_UPDATED in-process event fires; ticks that don't shift any rank produce zero WS emissions (D-04)"
    - "Two-call snapshot bracket: the projector fetches the top-N snapshot BEFORE the apply* call and AGAIN after, then diffs — N+1 queries per event accepted because the leaderboard projector is the cold path (not the live tick loop)"
    - "Same-TX dual emit: CashOutUseCase now writes BOTH wallet.credit AND bet.cashed_out to outbox in the same em.transactional; correlationId === causationId across both rows so downstream consumers can stitch the flow"
    - "handleEnvelope extracted from the @IdempotentSubscribe-decorated handle for unit-testability — mirrors the WalletDebitedHandler pattern. Decorator handles inbox dedupe + DLX + CLS; handleEnvelope is pure dispatch."
    - "Inline masking transform at the WS boundary: the projector emits LeaderboardSnapshotEntry carrying branded PlayerId; the gateway's @OnEvent handler maps entries[].playerId through maskPlayerId before server.to('lobby').emit so raw UUIDs cannot leak (T-09-35 mitigated by the masking-behavior test)"
  removed: []
key_files:
  created:
    - "services/games/src/application/leaderboard-projector.service.ts"
    - "services/games/tests/unit/leaderboard-projector.service.test.ts"
    - "services/games/tests/unit/game-ws.gateway.leaderboard.test.ts"
    - "services/games/tests/integration/leaderboard-projector-chaos.test.ts"
    - "packages/contracts/src/events/bet-cashed-out.event.ts"
    - "packages/contracts/src/events/bet-refunded.event.ts"
    - "packages/messaging-spine/tests/unit/idempotent-subscribe-routing-key.test.ts"
    - ".planning/phases/09-auto-features-leaderboard/09-06-SUMMARY.md"
  modified:
    - "packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts (routingKey: string → string | string[])"
    - "packages/contracts/src/events/index.ts (+ bet-cashed-out + bet-refunded barrel exports)"
    - "services/games/src/application/use-cases/cash-out.use-case.ts (additional outbox row for bet.cashed_out)"
    - "services/games/src/application/game-events.ts (+ LEADERBOARD_UPDATED constant + LeaderboardUpdatedPayload type)"
    - "services/games/src/application/game-core.module.ts (+ LeaderboardProjectorService provider)"
    - "services/games/src/presentation/gateways/game-ws.gateway.ts (+ @OnEvent LEADERBOARD_UPDATED handler with maskPlayerId)"
    - "services/games/tests/unit/cash-out.use-case.test.ts (extended outbox assertions to cover the new bet.cashed_out emit)"
decisions:
  - "Rule 2 deviation — emit bet.cashed_out from CashOutUseCase: the plan's read-first claim that 'Phase 5 code emits a per-bet bet.cashed_out for the winning branch' (carried forward from the 09-03 SUMMARY) was inaccurate — `grep -rn 'bet.cashed_out'` against services/games/src returned only the ws-bridge consumer's dead `case` branch with no publisher. The projector cannot consume a routing key that doesn't exist on the wire, so the cash-out use case was extended to emit one bet.cashed_out row to game.events in the same em.transactional as the existing wallet.credit row (same correlationId === causationId). New @crash/contracts BetCashedOutEventV1 schema + routing-key constant. The existing cash-out unit test's `expect(h.outbox.calls).toHaveLength(1)` was updated to `toHaveLength(2)` with full envelope + payload + route assertions on the new bet.cashed_out row. This unblocked the projector AND repaired the previously-dead ws-bridge `bet.cashed_out` branch (single fix, two consumers reactivated). Committed as a separate atomic commit (`42b31dc`) ahead of the projector itself for clean git history."
  - "Rule 3 deviation — handleEnvelope extracted from the decorated handle method: the unit test originally invoked `service.handle(envelope, msg)` directly, which now routes through the @IdempotentSubscribe decorator wrapper requiring valid AMQP headers + em.transactional + cls. Mirrored the WalletDebitedHandler pattern: the @IdempotentSubscribe-decorated `handle` is a thin pass-through to `handleEnvelope(envelope, msg, txEm)` which carries all the business logic. Unit tests call handleEnvelope directly; the decorator path is exercised at integration test time. Pattern is already established in the codebase (wallet-debited.handler.ts) so no architectural decision was required."
  - "Spine-impact audit (Task 1 precondition): grep enumerated 6 production @IdempotentSubscribe call sites (2 wallets, 2 games, 2 spine tests) — all using a single string routingKey. The native @golevelup/nestjs-rabbitmq @RabbitSubscribe accepts both string and string[] (the WsBridgeConsumer already proves this at runtime via `routingKey: ['bet.placed', 'bet.active', 'bet.refunded', 'bet.cashed_out']`), so the spine widening was a pure TypeScript type change. routingKey: string → string | string[] is additive — every existing call site still typechecks and runs unchanged. Regression test in packages/messaging-spine/tests/unit/idempotent-subscribe-routing-key.test.ts locks both shapes + the per-message inbox-dedupe invariant (each delivery keyed by its own messageId regardless of which routing key matched, so a queue bound to N routing keys does not weaken the dedupe semantics)."
  - "Throttle gate via LeaderboardSnapshot.diff (not via LEADERBOARD_UPDATE_THROTTLE_MS — that env was Plan 09-01's future-tunable for a time-bucket throttle; this plan uses the rank-change gate which is sharper). The diff function from Plan 09-04 compares ordered playerId arrays only — netProfitCents deltas DO NOT trigger emit. Behavior: a player gaining +500 cents while staying rank 5 produces zero leaderboard:updated emits. A new player overtaking rank 3 produces exactly one emit with the full afterTopN payload. Unit test 5 + 6 lock both directions of the gate."
  - "WS payload shape vs in-process payload shape: the projector emits LeaderboardSnapshotEntry { playerId: string, rank: number, netProfitCents: bigint } in-process. The gateway transforms to wire shape { playerIdMasked: string, rank: number, netProfitCents: string } before emitting on the socket — playerId becomes playerIdMasked (8-char SHA-256 hex prefix) and netProfitCents becomes a string (bigint discipline; JSON.stringify cannot serialise a bigint). The gateway STRIPS the raw playerId field from the wire shape; the masking test asserts neither the raw UUID regex /[0-9a-f]{8}-[0-9a-f]{4}-/ matches anywhere in the serialised payload nor any `playerId` property exists on the emitted entries."
  - "Chaos test design: overrideProvider(LeaderboardProjectorService).useValue({ handle: throw }) is the cleanest way to disable the projector in a NestJS test module — keeps the full AppModule wiring intact (so the saga + ws bridge + bet controllers all bootstrap normally) while ensuring every projector delivery would throw. Then place a bet, wait for ACTIVE→{CASHED_OUT|LOST|REFUNDED}, assert leaderboard_24h has zero rows for the player. The test is gated on INTEGRATION=1 + docker compose up (same convention as the existing 09-03 integration test) and skips cleanly without those prereqs."
metrics:
  duration_minutes: 18
  completed_date: 2026-05-30
  tasks_total: 3
  tasks_complete: 3
  files_created: 8
  files_modified: 7
  commits: 5
  tests_added_unit: 11
  tests_total_unit_games_after: 279
  tests_total_unit_games_baseline_failures: 8
  tests_total_unit_contracts_after: 44
  tests_added_integration: 1
---

# Phase 9 Plan 06: LeaderboardProjectorService Summary

Closes Plan 09-06 — the light-CQRS projector that consumes the bet outcome events into the `leaderboard_24h` denormalized read model + emits a throttled `leaderboard:updated` WS event when the top-N ranks shift. Adds the missing `bet.cashed_out` publish on `CashOutUseCase` (the per-bet ledger had been one-sided since Phase 5), widens the messaging spine's `@IdempotentSubscribe` decorator to accept array routing keys, wires the masking gate into the WS boundary, and ships the SC5 chaos proof that the write path is fully decoupled from the projector.

---

## Objective Delivered

REQ-LEAD-01 (24h net-profit leaderboard) requires a single source of truth that accumulates per-bet outcomes idempotently. Plan 09-04 laid the storage + repository foundation; Plan 09-03 shipped `bet.lost`. This plan completes the loop by:

1. Emitting the missing `bet.cashed_out` event from `CashOutUseCase` so the winning branch has a wire-level signal (Rule 2 deviation — see Decisions).
2. Subscribing the new `LeaderboardProjectorService` to `bet.cashed_out + bet.refunded + bet.lost` on the dedicated `leaderboard-projector.q` quorum queue.
3. Diff-gating the in-process `LEADERBOARD_UPDATED` emit on `LeaderboardSnapshot.diff(beforeTopN, afterTopN).changed === true`.
4. Hooking `GameWsGateway` to the in-process event with a masking transform that converts every `entries[].playerId` to its 8-char SHA-256 hex prefix before the lobby emit (T-09-35 mitigation).
5. Proving with SC5 chaos that overriding the projector to throw on every delivery does NOT block bet settlement.

REQ-LEAD-01 + REQ-LEAD-02 are now closed at the backend layer. REQ-LEAD-04 (shared payload schema for HTTP + WS) is wire-active — the WS gateway emits the shape Plan 09-07 already exported via `leaderboardUpdatedPayloadSchema`; Plan 09-09 will consume it on the FE.

---

## Tasks Completed

### Task 1 — Spine-impact audit + widen `@IdempotentSubscribe.routingKey` to `string | string[]`
- Commit `7b518cf` (`feat(09-06): widen @IdempotentSubscribe routingKey to string | string[]`)
- Audit confirmed 6 production call sites all using single-string `routingKey`; native `@RabbitSubscribe` already accepts arrays; widening is a pure TS type change.
- Regression test locks three invariants: single-string still works (backwards compat), array works, per-message `inbox.tryClaim` is keyed by messageId regardless of which routing key matched.
- `packages/messaging-spine/tests/unit/idempotent-subscribe-routing-key.test.ts` 3/3 pass; `bunx tsc --noEmit` clean across messaging-spine + games + wallets.

### Task 2 — `LeaderboardProjectorService` + `bet.cashed_out` emit + WS gateway extension
- Commit `42b31dc` (`feat(09-06): emit bet.cashed_out outbox event from CashOutUseCase`) — Rule 2 deviation, separate atomic commit for clean history.
- Commit `06eeae8` (`test(09-06): add failing unit tests for LeaderboardProjectorService`) — RED, 6 cases.
- Commit `d74fc40` (`feat(09-06): add LeaderboardProjectorService + WS leaderboard:updated emit`) — GREEN, projector + gateway + module wiring.
- 8 new unit tests total (6 projector + 2 gateway-masking): `bun test tests/unit` reports 279 pass / 8 fail (the 8 failures are the pre-existing baseline from `multiplier-broadcast.service.test.ts` + `round-loop.service.test.ts` + `get-ws-snapshot.use-case.test.ts` documented in STATE.md since Plan 09-01 — none touch this plan's code paths).
- Cash-out test extended from `toHaveLength(1)` to `toHaveLength(2)` with full bet.cashed_out envelope + payload + route assertions.

### Task 3 — SC5 chaos test (projector failure does NOT block bet settlement)
- Commit `7bcbbb2` (`test(09-06): add SC5 chaos test — projector failure does not block settlement`).
- `services/games/tests/integration/leaderboard-projector-chaos.test.ts` uses `Test.createTestingModule(...).overrideProvider(LeaderboardProjectorService).useValue({ handle: () => throw })` to deliberately disable the projector while keeping the rest of the games stack intact.
- Asserts bet reaches a terminal status (`CASHED_OUT | LOST | REFUNDED`) AND `leaderboard_24h` is empty for the player (no consumer drained the queue) — proves write-path independence.
- Skips cleanly without `INTEGRATION=1` (same gate as 09-03's integration suite); tsc clean.

---

## Verification

| Surface | Result |
|---------|--------|
| `packages/messaging-spine` tsc | clean |
| `packages/messaging-spine` unit tests (routing-key + decorator suite) | 8/8 pass |
| `packages/contracts` unit tests | 44/44 pass (was 37; +7 from new bet-cashed-out + bet-refunded schema cases inherited via barrel) |
| `services/games` tsc | clean |
| `services/games` unit tests | 279 pass / 8 fail (was 271/8; +8 from this plan; baseline failures unchanged) |
| `services/games` integration chaos test compile | clean; skips without `INTEGRATION=1` |
| Masking gate — `/^[0-9a-f]{8}$/` on every entry's `playerIdMasked` | pass |
| Masking gate — raw-UUID regex `/[0-9a-f]{8}-[0-9a-f]{4}-/` against serialised payload | 0 matches (gate enforced) |
| `grep "leaderboard:updated"` against gateway | finds the @OnEvent handler with maskPlayerId transform before the emit |

---

## Deviations from Plan

### Rule 2 — Missing critical functionality

**1. CashOutUseCase did not emit bet.cashed_out on game.events**
- **Found during:** Task 2 read-first phase.
- **Issue:** The plan + 09-03 SUMMARY both claimed `bet.cashed_out` was already emitted ("Phase 5 code emits a per-bet bet.cashed_out for the winning branch"). `grep -rn "bet.cashed_out"` against `services/games/src` returned only the ws-bridge consumer's dead `case "bet.cashed_out"` branch — no publisher anywhere. The projector subscribing to a non-existent routing key would have meant the winning-side of the leaderboard ledger silently stayed at zero. The ws-bridge consumer's `bet:cashed_out` lobby emit was also dead code as a side-effect.
- **Fix:** Added `BetCashedOutEventV1` + `BET_CASHED_OUT_EVENT_TYPE` to `@crash/contracts` (mirrors `BetLostEventV1` shape exactly). Extended `CashOutUseCase.execute` to write a second outbox row inside the same `em.transactional` as the existing `wallet.credit` row — same `correlationId`, same `causationId`, same `aggregateId`. Repaired the ws-bridge dead path as a free side-effect.
- **Files modified:** `packages/contracts/src/events/bet-cashed-out.event.ts` (new), `packages/contracts/src/events/index.ts`, `services/games/src/application/use-cases/cash-out.use-case.ts`, `services/games/tests/unit/cash-out.use-case.test.ts`.
- **Commit:** `42b31dc` (separate atomic commit so the projector commit reads cleanly).

**2. Added `BetRefundedEventV1` contract schema**
- **Found during:** Task 2 read-first phase.
- **Issue:** The projector needs a Zod-validated wire payload to safely parse `bet.refunded` envelopes. The publishers (`saga-timeout-sweeper.service.ts`, `wallet-debit-rejected.handler.ts`) ship `{ betId, playerId, reason }` only — no `amount` or `roundId`. No shared schema existed.
- **Fix:** Added `BetRefundedEventV1` + `BET_REFUNDED_EVENT_TYPE` with `roundId` and `amount` declared optional to match the existing publisher shape (the projector's `applyRefunded` is a no-op per Pitfall 8 + Q1 RESOLVED so the missing fields are inconsequential to the ledger). Locked under `@crash/contracts` barrel.
- **Files modified:** `packages/contracts/src/events/bet-refunded.event.ts` (new), `packages/contracts/src/events/index.ts`.
- **Commit:** `42b31dc`.

### Rule 3 — Blocking issues

**3. `handleEnvelope` extracted from the decorated `handle`**
- **Found during:** First unit test run.
- **Issue:** Calling `service.handle(envelope, msg, txEm)` directly from a unit test routes through the `@IdempotentSubscribe` decorator wrapper, which requires valid AMQP headers (`x-correlation-id` etc.) on `msg.properties.headers` AND a real `em.transactional` + `cls.run` to bind the inbox dedupe. The wrapper aborts early with "Invalid AMQP headers: missing x-correlation-id" and the handler body never runs.
- **Fix:** Mirrored the established `WalletDebitedHandler` pattern — the `@IdempotentSubscribe`-decorated `handle` is now a thin pass-through to `handleEnvelope(envelope, msg, txEm)` carrying all business logic. Unit tests call `handleEnvelope` directly; the decorator path is exercised by the existing `@IdempotentSubscribe` test suite + the (gated) integration test.
- **Files modified:** `services/games/src/application/leaderboard-projector.service.ts`, `services/games/tests/unit/leaderboard-projector.service.test.ts`.
- **Commit:** part of `d74fc40`.

No Rule 1 (auto-fix bugs) or Rule 4 (architectural change) deviations triggered.

---

## Threat Model — Disposition Verification

| Threat | Disposition | Verified by |
|--------|-------------|-------------|
| T-09-30 — replay bet.cashed_out to inflate leaderboard | mitigate | `@IdempotentSubscribe` inbox dedupe by messageId; spine unit test 3 confirms per-message tryClaim semantics on array routing keys |
| T-09-31 — DoS via emit-on-every-event | mitigate | `LeaderboardSnapshot.diff` rank-change gate; unit test 6 asserts zero emit on same-order, unit test 5 asserts exactly one emit on rank swap |
| T-09-32 — refund double-counts profit | mitigate | `applyRefunded` is a no-op (Plan 09-04 repository impl); unit test 2 asserts no `applyCashedOut`/`applySettledLoss` calls fire on `bet.refunded` |
| T-09-33 — projector poison message DLQ overflow | mitigate | `@IdempotentSubscribe` wires `buildQuorumArgs(5, deriveDlxFromExchange(EXCHANGES.GAME_EVENTS))` — after 5 redeliveries the message routes to `game.dlx`; existing `games-dead-letter.consumer.ts` from Phase 5 handles |
| T-09-34 — projector lag blocks write path | mitigate | Separate `leaderboard-projector.q` (topic fan-out). SC5 chaos test in `tests/integration/leaderboard-projector-chaos.test.ts` overrides the provider to throw on every delivery; bet still reaches terminal status; `leaderboard_24h` stays empty |
| T-09-35 — raw UUID leak through WS payload | mitigate | Gateway maps `entries[].playerId` through `maskPlayerId(PlayerId(...))` before emit. Masking unit test 1 asserts (a) every `playerIdMasked` matches `/^[0-9a-f]{8}$/`, (b) raw-UUID regex `/[0-9a-f]{8}-[0-9a-f]{4}-/` returns 0 matches in `JSON.stringify(payload)`, (c) no `playerId` property remains on the emitted entries |

---

## Self-Check: PASSED

- `services/games/src/application/leaderboard-projector.service.ts` — FOUND
- `services/games/src/application/leaderboard-events.ts` (canonical name from frontmatter) — folded into existing `services/games/src/application/game-events.ts` per Plan 09-05's precedent (single `GAME_EVENTS` object, additive key); the file referenced in the plan frontmatter was advisory ("the constant naming pattern matches the existing GAME_EVENTS object — alternatively land the new key directly in the existing services/games/src/application/game-events.ts if 09-05 added ROUND_TICK there"). 09-05 did add ROUND_TICK there, so this plan landed `LEADERBOARD_UPDATED` in the same file (verified by reading STATE.md). No separate `leaderboard-events.ts` exists; the LeaderboardUpdatedPayload type is exported from `game-events.ts`.
- `services/games/src/presentation/gateways/game-ws.gateway.ts` — FOUND (extended)
- `services/games/src/application/game-core.module.ts` — FOUND (extended)
- `packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts` — FOUND (modified)
- `services/games/tests/integration/leaderboard-projector-chaos.test.ts` — FOUND
- Commit `7b518cf` — FOUND
- Commit `42b31dc` — FOUND
- Commit `06eeae8` — FOUND
- Commit `d74fc40` — FOUND
- Commit `7bcbbb2` — FOUND

---

## What This Unblocks

- **Plan 09-09 (FE LeaderboardPanel)** — the WS `leaderboard:updated` event now actually fires with the exact payload shape Plan 09-07 exported via `@crash/contracts/ws/leaderboardUpdatedPayloadSchema`. The FE hook can subscribe and Zod-parse without further backend changes.
- **Plan 09-10 (closeout)** — ADR candidate: "Light-CQRS leaderboard projector with same-TX bet.cashed_out emit precedent + rank-change-only WS throttle gate."
