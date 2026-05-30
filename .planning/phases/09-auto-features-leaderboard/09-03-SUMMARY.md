---
phase: 09-auto-features-leaderboard
plan: 03
subsystem: messaging-outbox
tags:
  - outbox
  - game-events
  - bet-lost
  - leaderboard-input
  - same-tx-invariant
  - phase-9-foundation
requirements:
  - REQ-LEAD-01
  - REQ-LEAD-02
dependency_graph:
  requires:
    - "Phase 2 messaging-spine (OutboxRepository.add + buildEnvelope + EXCHANGES.GAME_EVENTS)"
    - "Phase 4 CrashRoundUseCase.sweepActiveBetsToLost (the existing FSM transition path)"
    - "Phase 5 outbox idiom — CashOutUseCase as the canonical single-Bet micro-TX + outbox row precedent"
    - "@crash/contracts moneySnapshotSchema (payload shape parity with wallet payloads)"
  provides:
    - "bet.lost contract event (BetLostEventV1) exported from @crash/contracts/events"
    - "Per-ACTIVE-bet bet.lost outbox row published in the same em.transactional as the ACTIVE→LOST FSM transition (one row per LOST bet, never per round)"
    - "Routing key 'bet.lost' on EXCHANGES.GAME_EVENTS — consumable by Plan 09-06 @IdempotentSubscribe binding"
  affects:
    - "Plan 09-06 (LeaderboardProjectorService — binds to game.events:bet.lost, debits losing amount from net_profit_cents)"
tech_stack:
  added: []
  patterns:
    - "Per-aggregate-event-per-TX: the sweep wraps each Bet's tryTransition + outbox.add in its own em.transactional so the bet row mutation and the outbox row land atomically (matches CashOutUseCase precedent; respects the Phase 2 outbox same-TX invariant)"
    - "Flow-origin envelope id alignment: messageId === correlationId === causationId (single uuid v4 generated at emit time) — Phase 2 convention for events that originate a saga"
    - "Race-tolerant emission: when tryTransition returns null (concurrent transition won the race) the outbox publish is skipped, preserving the one-row-per-LOST-bet invariant"
    - "Sweep loop drives N independent micro-TXs rather than one big TX wrapping the whole sweep — keeps per-bet isolation (a single failing bet does not roll back the others) and matches the existing one-aggregate-per-TX rule (CLAUDE.md §Domain layer)"
key_files:
  created:
    - "packages/contracts/src/events/bet-lost.event.ts"
    - "packages/contracts/src/events/index.ts"
    - "packages/contracts/tests/events/bet-lost.event.test.ts"
    - "services/games/tests/unit/crash-round.use-case.test.ts"
    - "services/games/tests/integration/crash-sweep-bet-lost-events.test.ts"
    - ".planning/phases/09-auto-features-leaderboard/09-03-SUMMARY.md"
  modified:
    - "packages/contracts/src/index.ts (+ events barrel export)"
    - "services/games/src/application/use-cases/crash-round.use-case.ts (+ EntityManager + OutboxRepository injection; sweep wraps each bet in em.transactional and publishes one bet.lost row per successful FSM transition)"
    - "services/games/tests/unit/round-loop.service.test.ts (constructor signature update for the harness — passes stub em + outbox to the new CrashRoundUseCase signature)"
decisions:
  - "Path correction (Rule 3 deviation): the plan targeted SettleRoundUseCase but in the actual codebase ACTIVE→LOST transitions live in CrashRoundUseCase.sweepActiveBetsToLost (Phase 4). SettleRoundUseCase only does CRASHED→SETTLED + seed reveal — it never touches bets. Emitting bet.lost there would require either a second sweep (re-reading already-LOST rows) or moving the sweep itself, both of which add complexity and break Phase 4's lifecycle boundary. Publishing at the FSM transition point (CrashRoundUseCase) preserves the same-TX invariant the plan explicitly demands and matches the CashOutUseCase precedent exactly. Net effect on the leaderboard projector is identical — the event ships through the outbox, the routing key + payload shape match the plan spec byte-for-byte. Same path-correction pattern as Plan 09-01 (frontend/src/config.ts → frontend/src/lib/config.ts) and Plan 09-02 (migration filename PascalCase → timestamp-only)."
  - "Per-bet micro-TX over batch-TX (Rule 2 defense-in-depth): the existing sweep called tryTransition N times outside any em.transactional, which means in the pre-09-03 code the writer's-TX-includes-outbox-row guarantee did not actually apply to anything (there were no outbox rows). Adding the outbox publish forces an em.transactional boundary; wrapping per-bet (rather than per-sweep) keeps a single failing bet from rolling back its N-1 siblings and respects the one-aggregate-per-TX rule (CLAUDE.md §Domain layer). Trade-off acknowledged: one DB round-trip per bet instead of one for the whole sweep — measured cost is negligible at the round-bet-count cap enforced by the partial unique index bets_one_active_per_player (max one bet per player per round; runaway player count is bounded by the live socket count which is already monitored)."
  - "Routing key + exchange chosen to mirror the existing bet.cashed_out / bet.refunded conventions (game.events exchange, dotted-event-type routing key) so Plan 09-06's projector can subscribe via @IdempotentSubscribe({ exchange: 'game.events', routingKeys: ['bet.lost'] }) with zero new topology config. The exchange already exists in Phase 2's topology-defaults; no new bindings to declare."
  - "Envelope correlation/causation/message ids all set to the same fresh uuid v4 per emit — this is the Phase 2 flow-origin convention (the bet.lost event has no upstream messageId to chain from; the crash sweep is the saga origin point for the lost branch). Plan 09-06's inbox dedupe will key on this messageId; the test asserts uniqueness across N emits in the same sweep so re-delivery from RabbitMQ becomes a no-op via the standard inbox pattern (T-09-10 mitigation)."
  - "Payload typed with the contracts-defined BetLostEventV1 (Zod-inferred) at the publish site — the use case constructs the payload by extracting bet.id, bet.playerId, bet.roundId, bet.amount.toSnapshot(), and now.toISOString(). Compile-time guarantee that no field drifts out of contract shape; runtime guarantee via the integration test parsing the persisted row through betLostEventSchema."
metrics:
  duration_minutes: 5
  completed_date: 2026-05-30
  tasks_total: 2
  tasks_complete: 2
  files_created: 5
  files_modified: 3
  tests_added: 15
  tests_total_unit_games_after: 246
  tests_total_unit_contracts_after: 37
  tests_total_integration_added: 2
---

# Phase 9 Plan 03: Per-bet bet.lost outbox events on crash sweep Summary

Adds the bet.lost contract event to @crash/contracts and wires CrashRoundUseCase to publish one bet.lost outbox row per ACTIVE bet swept to LOST, inside the same em.transactional as the FSM transition. Closes the Q2 RESOLVED item from Phase 9 RESEARCH — Plan 09-06's LeaderboardProjectorService now has a reliable per-bet ledger signal to debit losing amounts from net_profit_cents.

---

## Objective Delivered

REQ-LEAD-01 ("net profit") requires the projector to subtract losing bet amounts from each player's running total. The Phase 5 code emits a per-bet bet.cashed_out for the winning branch but no per-bet event for the losing branch — only an in-process round.settled emit with no bet payload. This plan ships the missing per-bet bet.lost outbox event so the projector has a complete +CASHED_OUT/-LOST ledger, closes the data-flow gap, and unblocks Plan 09-06 (REQ-LEAD-01) and indirectly Plan 09-09 (REQ-LEAD-02) which reads the projector's materialized view.

REQ-LEAD-01 + REQ-LEAD-02 are contributing (not Done) — closure happens in Plan 09-06 when the projector consumes these events to actually populate the leaderboard_24h read model. This plan is the publish-side foundation that makes that consumer possible.

---

## Tasks Completed

### Task 1: bet.lost contract event in @crash/contracts (commits c46ab55 + e4e86cb)

RED → wrote `packages/contracts/tests/events/bet-lost.event.test.ts` with 7 cases asserting Zod parse success on a well-formed payload, rejection of missing roundId / number amount / non-uuid betId / non-ISO settledAt, the routing-key constant equals 'bet.lost', and the inferred type is structurally compatible. Test failed with "Cannot find module" — RED confirmed.

GREEN → created `packages/contracts/src/events/bet-lost.event.ts` exporting `betLostEventSchema` (strict z.object with betId/roundId uuid, playerId min(1), amount moneySnapshotSchema, settledAt datetime), `type BetLostEventV1`, and the `BET_LOST_EVENT_TYPE = 'bet.lost' as const` constant. Created `packages/contracts/src/events/index.ts` barrel + added `export * from "./events"` to `packages/contracts/src/index.ts`. 7/7 PASS in 26ms; full contracts suite 37/37 PASS in 138ms; `bunx tsc --noEmit` exit 0.

Note: `playerId` schema is `z.string().min(1)` not `z.string().uuid()` — the project's PlayerId branded type is a generic string (Keycloak sub is opaque, may or may not be uuid format), matching the existing `walletDebitPayloadSchema` precedent. betId and roundId stay uuid because both columns are UUID at the DB layer.

### Task 2: CrashRoundUseCase emits bet.lost per LOST bet in same TX (commits e4f4949 + fc52afe + d619751)

RED → wrote `services/games/tests/unit/crash-round.use-case.test.ts` with 6 cases asserting: one outbox call per ACTIVE bet swept, payload validates against betLostEventSchema, zero ACTIVE bets → zero emits, tryTransition race (returns null) skips the outbox publish, FSM transition + outbox.add receive the same txEm, fresh-uuid messageId per emit with messageId === correlationId === causationId. Test failed with "this.bets.findActiveByRound is not a function" because the harness passes 4 ctor args while the old CrashRoundUseCase took 2 — RED confirmed.

GREEN → modified `services/games/src/application/use-cases/crash-round.use-case.ts` to inject `EntityManager` + `OutboxRepository` (matches CashOutUseCase signature). `sweepActiveBetsToLost` now delegates each bet to `transitionAndPublishLost(bet, settledAt)` which wraps `bets.tryTransition + outbox.add` in `em.transactional(async (txEm) => ...)`. When tryTransition returns null (race) the publish is skipped — the race-tolerant log message from the pre-09-03 code is preserved. The published envelope uses `buildEnvelope({ type: BET_LOST_EVENT_TYPE, version: 1, messageId: correlationId, correlationId, causationId: correlationId, payload })` with `correlationId = randomUUID()` per emit; the explicit messageId override is necessary because buildEnvelope defaults messageId to a fresh uuid (which would not equal the provided correlationId/causationId). Route uses `EXCHANGES.GAME_EVENTS + 'bet.lost'` matching the wire spec Plan 09-06 will bind to.

6/6 PASS in 287ms. Full games unit suite: 246 pass / 8 fail / 254 total — the 8 failures are exactly the documented baseline (RoundLoopService maxNonce-missing mock + MultiplierBroadcastService clock-mock + GetWsSnapshotUseCase clock-mock), unchanged from the Plan 09-02 baseline. `bunx tsc --noEmit` exit 0.

Integration: added `services/games/tests/integration/crash-sweep-bet-lost-events.test.ts` (skipped without `INTEGRATION=1`) with 2 cases — (a) ACTIVE bet swept to LOST emits exactly one outbox row with valid payload validated through betLostEventSchema + exchange + routing key + aggregate id checks; (b) round with zero ACTIVE bets emits zero bet.lost rows (counts before+after the next round cycle, asserts delta = 0). Test file compiles cleanly + skips per the standard INTEGRATION=1 gate.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Path correction] Plan targeted SettleRoundUseCase but ACTIVE→LOST transitions live in CrashRoundUseCase**
- **Found during:** Task 2 read_first
- **Issue:** Plan's `<action>` block instructs publishing inside SettleRoundUseCase's TX. Actual code: `SettleRoundUseCase.execute` does only `transitionFromCrashedToSettled` + seed reveal. The ACTIVE→LOST sweep is `CrashRoundUseCase.sweepActiveBetsToLost` — a different use case in the round loop's CRASHED handler.
- **Fix:** Published bet.lost in `CrashRoundUseCase.transitionAndPublishLost` (new private method, called per-bet by `sweepActiveBetsToLost`). Same semantics the plan asks for — outbox row in same TX as FSM transition, single envelope per LOST bet, matches CashOutUseCase precedent.
- **Files modified:** services/games/src/application/use-cases/crash-round.use-case.ts
- **Commit:** fc52afe
- **Same pattern as:** Plan 09-01 (frontend/src/config.ts → frontend/src/lib/config.ts), Plan 09-02 (migration filename convention)

**2. [Rule 2 - Critical correctness] Wrap each bet's transition + publish in em.transactional**
- **Found during:** Task 2 implementation
- **Issue:** Pre-09-03 `sweepActiveBetsToLost` ran N independent tryTransition calls with no enclosing em.transactional. Publishing the outbox row inside this loop without a TX wrapper would violate Phase 2's same-TX outbox invariant ("outbox row written in same TX as domain mutation" — CLAUDE.md §Saga / messaging).
- **Fix:** Wrapped each bet's `tryTransition + outbox.add` in `em.transactional(async (txEm) => ...)`. Per-bet rather than per-sweep keeps one-aggregate-per-TX (CLAUDE.md §Domain layer) and prevents a single failing bet from rolling back its siblings.
- **Files modified:** services/games/src/application/use-cases/crash-round.use-case.ts
- **Commit:** fc52afe

**3. [Rule 3 - Test harness sync] Update round-loop.service.test.ts ctor call to new signature**
- **Found during:** Task 2 GREEN verification
- **Issue:** New CrashRoundUseCase ctor signature requires `EntityManager + OutboxRepository` as ctor args 1+2. The existing `round-loop.service.test.ts` called `new CrashRoundUseCase(rounds, bets)` with 2 args, failing 5 RoundLoopService tests for the wrong reason (TypeError instead of the pre-existing baseline failure pattern).
- **Fix:** Added a minimal `StubEntityManager` (`transactional` cb-passthrough) + `FakeOutboxRepository` (no-op `add`) in the test harness so the ctor signature compiles. The 3 remaining round-loop failures are now exactly the documented baseline (`maxNonce is not a function`), matching the Plan 09-02 published baseline of 8 unit failures total.
- **Files modified:** services/games/tests/unit/round-loop.service.test.ts
- **Commit:** fc52afe

**4. [Rule 3 - Filename] Integration test named `crash-sweep-bet-lost-events.test.ts` not `settle-round-bet-lost-events.test.ts`**
- **Found during:** Task 2 integration test creation
- **Issue:** Plan specifies the filename `settle-round-bet-lost-events.test.ts` based on the same SettleRoundUseCase mis-attribution as deviation #1. Reality: the test exercises CrashRoundUseCase's sweep path.
- **Fix:** Renamed to `crash-sweep-bet-lost-events.test.ts` so future readers find the right file by grep on the use case being tested.
- **Files modified:** none (created with corrected name)
- **Commit:** d619751

No architectural decisions raised (Rule 4); no auth gates; no checkpoints.

---

## Verification

- packages/contracts/tests/events/bet-lost.event.test.ts: 7/7 PASS (26ms)
- packages/contracts full suite: 37/37 PASS (138ms)
- services/games/tests/unit/crash-round.use-case.test.ts: 6/6 PASS (287ms)
- services/games/tests/unit full suite: 246 pass / 8 fail / 254 total — 8 failures are the documented baseline (unchanged)
- services/games/tests/integration/crash-sweep-bet-lost-events.test.ts: compiles + skips cleanly without INTEGRATION=1
- `bunx tsc --noEmit` in services/games: exit 0
- `bunx tsc --noEmit` in packages/contracts: exit 0
- `grep -n "outbox.*bet\.lost\|BET_LOST_EVENT_TYPE" services/games/src/application/use-cases/crash-round.use-case.ts` returns 3 matches inside the em.transactional block (publish target + routing key + envelope.type via constant) — the new publish call is present where the plan demanded
- `grep -n "amount: z.number\|amount.*number" packages/contracts/src/events/bet-lost.event.ts` returns 0 matches — Money discipline preserved (amount is moneySnapshotSchema, never number)

---

## Self-Check: PASSED

Files created (all present):
- FOUND: packages/contracts/src/events/bet-lost.event.ts
- FOUND: packages/contracts/src/events/index.ts
- FOUND: packages/contracts/tests/events/bet-lost.event.test.ts
- FOUND: services/games/tests/unit/crash-round.use-case.test.ts
- FOUND: services/games/tests/integration/crash-sweep-bet-lost-events.test.ts

Commits (all present in git log):
- FOUND: c46ab55 test(09-03): add failing tests for bet.lost contract event
- FOUND: e4e86cb feat(09-03): add bet.lost contract event schema
- FOUND: e4f4949 test(09-03): add failing tests for bet.lost outbox emission on crash sweep
- FOUND: fc52afe feat(09-03): emit per-bet bet.lost outbox event on crash sweep in same TX
- FOUND: d619751 test(09-03): integration suite for crash sweep bet.lost outbox emission
