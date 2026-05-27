---
phase: 05-saga-integration
plan: 05
subsystem: games / application (handlers)
tags: [saga, amqp-consumer, idempotent-subscribe, compensation, req-saga-01]
requires:
  - 05-03 (BetSagaState aggregate + BetSagaStateRepository + BET_SAGA_REPOSITORY token)
  - 05-04 (PlaceBetUseCase creates DEBIT_PENDING sagas this handler closes)
  - Phase 2 (@IdempotentSubscribe + InboxRepository + OutboxRepository 3-arg)
  - Phase 3 (WalletCreditHandler — terminal consumer of compensation envelopes)
  - Phase 4 (BetRepository.tryTransition for atomic PENDING -> ACTIVE | REFUNDED)
provides:
  - "WalletDebitedHandler — branches on saga.status: DEBIT_PENDING confirms bet (PENDING -> ACTIVE) + emits bet.active, TIMED_OUT emits compensating wallet.credit using bet.amount lookup"
  - "WalletDebitRejectedHandler — DEBIT_PENDING refunds bet (PENDING -> REFUNDED, patch.refundReason) + emits bet.refunded; non-pending states are no-ops"
  - "envelope-types.ts — WalletDebitedEnvelope + WalletDebitRejectedEnvelope type aliases mirroring services/wallets/src/application/handlers/envelope-types.ts"
  - "handler-internal handleEnvelope method that bypasses the @IdempotentSubscribe wrapper for unit-test pure FSM coverage"
affects:
  - 05-09 (live AMQP integration tests will drive both handlers end-to-end)
  - 05-10 (Phase 6 WS gateway subscribes to bet.active / bet.refunded emitted here)
tech-stack:
  added: []
  patterns:
    - "Split decorated entrypoint (handle) from pure FSM body (handleEnvelope) — decorator owns inbox dedupe + txEm opening, handleEnvelope is unit-testable without AMQP plumbing"
    - "Switch on saga.status inside a single txEm — saga read, bet transition, saga transition, outbox add all bind the same transaction the decorator opened"
    - "Compensation reads bet.amount from BetRepository.findById (single source of truth, research Open Question 3 Option 1)"
key-files:
  created:
    - services/games/src/application/handlers/envelope-types.ts
    - services/games/src/application/handlers/wallet-debited.handler.ts
    - services/games/src/application/handlers/wallet-debit-rejected.handler.ts
    - services/games/tests/unit/wallet-debited.handler.test.ts
    - services/games/tests/unit/wallet-debit-rejected.handler.test.ts
  modified:
    - services/games/src/application/game-core.module.ts
decisions:
  - "Split handle (decorated entrypoint) from handleEnvelope (pure FSM body). The @IdempotentSubscribe decorator overwrites descriptor.value with an AMQP-header-aware wrapper, so unit tests calling handler.handle(envelope, msg, txEm) crash inside amqpHeadersToEnvelopeMeta. Extracting handleEnvelope keeps the FSM testable in isolation; the decorated handle is one line that delegates. Same shape would work as the canonical pattern for future @IdempotentSubscribe handlers."
  - "Compensation branch reads bet.amount via bets.findById(saga.betId) (no txEm — interface signature locked in Phase 4). The active TX still flows through MikroORM's RequestContext per the Phase 4 + 05-04 verification. Forward-tightening to require txEm on every read is deferred until a real read-skew bug appears."
  - "Both handlers reuse queue QUEUES.GAMES_WALLET_EVENTS with binding `wallet.*` already established in services/games/src/app.module.ts — no topology changes needed (verified Phase 2 binding covers both routing keys: wallet.debited and wallet.debit.rejected)."
  - "Handler signatures cast saga.betId and confirmed.roundId via `as unknown as string` when building envelope payloads. The branded types (BetId, RoundId) are nominally distinct from string in TS but identical at runtime; the contracts package consumers (Phase 6) will parse with their own zod schemas. Avoids leaking shared-kernel constructors into the wire format."
metrics:
  duration_minutes: 4
  completed: 2026-05-27
  tasks: 2
  files_created: 5
  files_modified: 1
  tests_added: 9
---

# Phase 05 Plan 05: Saga-Side Wallet Event Handlers Summary

REQ-SAGA-01 step 2 lands the games-side AMQP consumers that close the bet placement saga. `WalletDebitedHandler` branches on `bet_saga_state.status` — confirming the bet (PENDING -> ACTIVE) for DEBIT_PENDING sagas, or emitting a compensating `wallet.credit` for TIMED_OUT sagas (research Pattern 3 — the slow `wallet.debited` arriving after sweeper-driven refund must restore the player's balance). `WalletDebitRejectedHandler` refunds the bet on `INSUFFICIENT_FUNDS` / `WALLET_NOT_FOUND` payloads. Both decorated with `@IdempotentSubscribe` so inbox dedupe + same-TX outbox propagation come from the spine.

## What Shipped

### Task 1 — WalletDebitedHandler (RED + GREEN)

- `services/games/src/application/handlers/envelope-types.ts` — `AmqpEnvelope<TType, TPayload>` alias + `WalletDebitedEnvelope` + `WalletDebitRejectedEnvelope` (mirrors the wallets-service shape).
- `WalletDebitedHandler` with the four required spine fields (`em`, `cls`, `inbox`, `logger`) as public-readonly + outbox/bets/sagas injected by token. `@IdempotentSubscribe({ consumerName: 'games.wallet-debited', exchange: EXCHANGES.WALLET_EVENTS, routingKey: 'wallet.debited', queue: QUEUES.GAMES_WALLET_EVENTS })` on the `handle` method, which delegates to `handleEnvelope`.
- FSM branches inside `handleEnvelope`:
  - `saga === null` -> warn + return (unknown correlationId).
  - `DEBIT_PENDING` -> `bets.tryTransition(saga.betId, 'PENDING', 'ACTIVE', {}, txEm)`; if null (race lost) -> warn + return; else `sagas.transition(... 'CONFIRMED', txEm)` + `outbox.add(bet.active, { exchange: GAME_EVENTS, routingKey: 'bet.active', aggregateType: 'Bet', aggregateId: betId }, txEm)`.
  - `TIMED_OUT` -> `bets.findById(saga.betId)` for original amount; if null -> error log + return; else `outbox.add(wallet.credit, { exchange: WALLET_COMMANDS, routingKey: 'wallet.credit', ... }, txEm)` with `bet.amount.toSnapshot()` payload + `sagas.transition(... 'COMPENSATED', txEm)`.
  - `CONFIRMED | REFUNDED | COMPENSATED` -> debug log + return (terminal-state idempotency).
- 5 unit tests, 43 expect calls — all FSM branches covered including the CONFIRM race (`tryTransition` returns null) which skips saga transition and bet.active emission.

### Task 2 — WalletDebitRejectedHandler + module wiring (RED + GREEN)

- `WalletDebitRejectedHandler` mirrors the WalletDebitedHandler shape. `@IdempotentSubscribe({ consumerName: 'games.wallet-debit-rejected', exchange: WALLET_EVENTS, routingKey: 'wallet.debit.rejected', queue: GAMES_WALLET_EVENTS })`.
- FSM:
  - unknown correlationId -> warn + return.
  - `saga.status !== 'DEBIT_PENDING'` -> debug log + return (terminal idempotency for retries / late deliveries).
  - DEBIT_PENDING -> `bets.tryTransition(saga.betId, 'PENDING', 'REFUNDED', { refundReason: payload.reason }, txEm)`; if null -> warn + return; else `sagas.transition('DEBIT_PENDING' -> 'REFUNDED', txEm)` + `outbox.add(bet.refunded, { exchange: GAME_EVENTS, routingKey: 'bet.refunded', aggregateType: 'Bet', aggregateId: betId }, txEm)` carrying `{ betId, playerId, reason }`.
- `GameCoreModule` providers extended with both handlers; no exports (handlers are activated by `@IdempotentSubscribe` queue binding via `@golevelup/nestjs-rabbitmq`, not via DI consumption from other modules).
- 4 unit tests, 29 expect calls — INSUFFICIENT_FUNDS + WALLET_NOT_FOUND happy paths, non-pending saga skip, unknown correlationId.

## Verification

- `bun test tests/unit/wallet-debited.handler.test.ts` — **5 PASS / 0 FAIL** (43 expect calls).
- `bun test tests/unit/wallet-debit-rejected.handler.test.ts` — **4 PASS / 0 FAIL** (29 expect calls).
- `bun test tests/unit` (full games unit suite) — **153 PASS / 0 FAIL** (470 expect calls).
- `bunx tsc --noEmit` — clean.

Live AMQP flow (broker -> handler -> outbox publish) deferred to Plan 05-09 integration tests; queue + binding for both routing keys already exists in `services/games/src/app.module.ts` (`{ queue: GAMES_WALLET_EVENTS, exchange: WALLET_EVENTS, routingKey: 'wallet.*' }`).

## Commits

- `fdf0592` test(05-05): add failing tests for WalletDebitedHandler FSM branches
- `4a5241e` feat(05-05): implement WalletDebitedHandler with confirm and compensation branches
- `56ba721` test(05-05): add failing tests for WalletDebitRejectedHandler
- `7b19bed` feat(05-05): implement WalletDebitRejectedHandler and wire saga handlers as providers

## Deviations from Plan

**[Rule 3 — Blocking issue] Extracted `handleEnvelope` from decorated `handle`**

- **Found during:** Task 1 GREEN run — initial implementation followed the plan verbatim (single `handle` method decorated with `@IdempotentSubscribe`), and tests crashed inside `amqpHeadersToEnvelopeMeta` because the decorator overwrites `descriptor.value` and the wrapper expects AMQP message headers. Calling `handler.handle(envelope, msg, txEm)` from a unit test therefore goes through the wrapper, not the original method.
- **Issue:** Plan `<action>` step 3 said "call `handler.handle(envelope, msg, txEm)` directly with a stub txEm" — that's impossible because the decorator captures the original in closure and replaces the descriptor.
- **Fix:** Split into `handle` (decorated entrypoint, one-line delegation) + `handleEnvelope` (pure FSM body the tests call directly). Same pattern applied to both handlers for symmetry.
- **Files modified:** wallet-debited.handler.ts, wallet-debit-rejected.handler.ts (both expose `handleEnvelope`); tests call `handler.handleEnvelope(...)`.
- **Commits:** `4a5241e` and `7b19bed`

No other deviations.

## Authentication Gates

None.

## Threat Surface Check

No new external network endpoints. Both handlers run on the trusted broker side (Phase 5 plan's threat model T-05-05-T / T-05-05-R / T-05-05-COMP all confirmed mitigated):

- **T-05-05-T (forged envelope):** zod parse of `walletDebitedPayloadSchema` / `walletDebitRejectedPayloadSchema` + correlationId lookup against `bet_saga_state` — unknown correlationIds are dropped with a warn log, never instantiate domain state.
- **T-05-05-R (replay / duplicate delivery):** inbox dedupe in `@IdempotentSubscribe` (Phase 2 contract) + explicit terminal-state no-op branches in both handlers (`CONFIRMED | REFUNDED | COMPENSATED` for debited; `!= DEBIT_PENDING` for rejected).
- **T-05-05-COMP (compensation reveals private bet amount):** accepted in plan — envelope flows the trusted broker, payload contains the player's own money.

## Self-Check: PASSED

Verified on disk:

- FOUND: services/games/src/application/handlers/envelope-types.ts (WalletDebitedEnvelope + WalletDebitRejectedEnvelope)
- FOUND: services/games/src/application/handlers/wallet-debited.handler.ts (@IdempotentSubscribe games.wallet-debited)
- FOUND: services/games/src/application/handlers/wallet-debit-rejected.handler.ts (@IdempotentSubscribe games.wallet-debit-rejected)
- FOUND: services/games/tests/unit/wallet-debited.handler.test.ts (5 tests)
- FOUND: services/games/tests/unit/wallet-debit-rejected.handler.test.ts (4 tests)
- FOUND: services/games/src/application/game-core.module.ts contains WalletDebitedHandler + WalletDebitRejectedHandler in providers
- FOUND commits: fdf0592, 4a5241e, 56ba721, 7b19bed

## TDD Gate Compliance

- **Task 1 RED:** `fdf0592` `test(05-05): add failing tests for WalletDebitedHandler FSM branches` — verified failing (`Cannot find module ../../src/application/handlers/wallet-debited.handler`).
- **Task 1 GREEN:** `4a5241e` `feat(05-05): implement WalletDebitedHandler with confirm and compensation branches` — verified 5/5 pass after extracting `handleEnvelope`.
- **Task 2 RED:** `56ba721` `test(05-05): add failing tests for WalletDebitRejectedHandler` — verified failing (`Cannot find module ../../src/application/handlers/wallet-debit-rejected.handler`).
- **Task 2 GREEN:** `7b19bed` `feat(05-05): implement WalletDebitRejectedHandler and wire saga handlers as providers` — verified 4/4 pass + 153/153 full unit suite.
- REFACTOR: not needed. Each handler is one switch / one happy-path linear flow; no duplication between them beyond the host-class shape (which is the spine's contract, not a smell).
