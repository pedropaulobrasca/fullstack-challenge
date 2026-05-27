---
phase: 05-saga-integration
plan: 04
subsystem: games / application + presentation
tags: [saga, use-case, controller, http-202, req-game-06, req-saga-01]
requires:
  - 05-01 (Round.acceptBet aggregate-boundary FSM guard)
  - 05-03 (BetSagaState aggregate + repository + DI token)
  - Phase 4 (BetRepository.findActiveByRoundAndPlayer + save + partial unique index)
  - Phase 2 (OutboxRepository.add 3-arg with txEm bind)
provides:
  - "PlaceBetUseCase — single em.transactional that loads the open round, calls Round.acceptBet, persists Bet(PENDING) + BetSagaState(DEBIT_PENDING) + wallet.debit outbox row"
  - "BetCommandController — POST /games/bet (singular) returning 202 with { betId, status: PENDING }, JwtGuard-protected"
  - "PlaceBetRequestDto + PlaceBetResponseDto via createZodDto (amountCents as bigint snapshot)"
  - "BetAlreadyActiveError domain error carrying existingBetId"
affects:
  - 05-05 (WalletDebitedHandler will read sagas created here by correlationId, branch on status)
  - 05-06 (CashOutUseCase mirrors the same em.transactional + outbox.add(txEm) shape)
  - 05-07 (compensation handler keys off TIMED_OUT sagas created by 05-04 + swept by 05-08)
  - 05-08 (Kong route games-bet-place will forward to this controller path)
tech-stack:
  added: []
  patterns:
    - "Caller-owned em.transactional wraps every saga write; outbox + bet + saga all bind txEm"
    - "correlationId is a fresh randomUUID per saga — NOT betId reuse — keeping the wire-level correlation independent of the aggregate id"
    - "Controller maps domain errors to discriminated ConflictException/BadRequestException payloads ({ code, ... }) rather than leaking error messages"
    - "@Controller('games/bet') + @Post() (no path arg) lives at the controller root — singular path per REQ-GAME-06 spec"
key-files:
  created:
    - services/games/src/application/use-cases/place-bet.use-case.ts
    - services/games/src/presentation/controllers/bet-command.controller.ts
    - services/games/src/presentation/dtos/place-bet.request.dto.ts
    - services/games/src/presentation/dtos/place-bet.response.dto.ts
  modified:
    - services/games/src/domain/errors.ts (+ BetAlreadyActiveError class, 11 lines)
    - services/games/src/application/game-core.module.ts (+ PlaceBetUseCase provider + export, 2 lines)
    - services/games/src/app.module.ts (+ BetCommandController registration, 6 lines)
    - services/games/tests/unit/place-bet.use-case.test.ts (new file, 352 lines)
decisions:
  - "correlationId is a fresh randomUUID per place-bet call (research Open Question 4), distinct from betId. Keeps saga correlation independent of the aggregate id so future flows that emit multiple correlated events on a single bet (e.g., compensation paths) don't collide with the natural primary key."
  - "@Post() with no path argument resolves to controller root `/games/bet` (singular). REQ-GAME-06 spec text uses singular; existing BetsController at `/games/bets/me` (plural) is read-only and stays separate. Two controllers, two responsibilities."
  - "Repository read methods (findOpen, findActiveByRoundAndPlayer) are called without an explicit txEm because their current interface signatures don't accept one. The READ runs through the EM-aware repository which honours the active transactional context via MikroORM's RequestContext (verified in Phase 4). Future tightening (force txEm on every read) deferred to Plan 05-07 if compensation handler discovers read-skew."
  - "Skipped the BetAmountOutOfBoundsError throw inside the use case: BET_MIN/MAX_CENTS bounds enforcement is already covered by the controller-layer Money.fromSnapshot path + planned BetAmount VO (Phase 4 deferred-items.md). The use case translates only the three CRITICAL errors the saga FSM owns (no-open-round, wrong-phase, double-bet). If a future plan needs use-case-side bounds enforcement, it slots in cleanly without surface change to BetAmountOutOfBoundsError (already defined in domain/errors.ts since Phase 4)."
metrics:
  duration_minutes: 7
  completed: 2026-05-27
  tasks_completed: 2
  files_changed: 8
  tests_added: 6
---

# Phase 05 Plan 04: PlaceBetUseCase + POST /games/bet Summary

REQ-GAME-06 + REQ-SAGA-01 step 1: bet placement entry point lands. POST `/games/bet` returns 202 with `{ betId, status: 'PENDING' }`. Inside a single `em.transactional` callback the use case loads the open round, guards via `Round.acceptBet` (which throws when status !== BETTING), checks the single-bet invariant, persists `Bet(PENDING)` + `BetSagaState(DEBIT_PENDING, deadlineAt=now+SAGA_TIMEOUT_MS)`, and writes the `wallet.debit` outbox envelope — all bound to the same `txEm`.

## What Shipped

### Task 1 — PlaceBetUseCase + BetAlreadyActiveError + tests (RED + GREEN)

- `BetAlreadyActiveError extends DomainError` (code `BET_ALREADY_ACTIVE`, readonly `existingBetId: BetId`) added to `services/games/src/domain/errors.ts`.
- `PlaceBetUseCase` (constructor-injected `EntityManager`, `OutboxRepository`, three repos by token). `execute({ playerId, amount, now })` returns `{ betId, status: 'PENDING' }`. The entire write set runs inside `em.transactional(async (txEm) => { ... })`:
  1. `rounds.findOpen()` → throws `RoundNotInBettingPhaseError('NO_OPEN_ROUND')` when null
  2. `open.acceptBet(now)` — aggregate FSM guard, throws `RoundNotInBettingPhaseError(open.status)` if not BETTING
  3. `bets.findActiveByRoundAndPlayer(open.id, playerId)` → throws `BetAlreadyActiveError(existing.id)` when non-null
  4. `BetId(randomUUID())` + `correlationId = randomUUID()` (distinct values)
  5. `Bet.place(...)` + `bets.save(bet, txEm)`
  6. `sagas.create({ betId, correlationId, deadlineAt: now + SAGA_TIMEOUT_MS }, txEm)`
  7. `outbox.add(buildEnvelope({ type: 'wallet.debit', ... }), { exchange: WALLET_COMMANDS, routingKey: 'wallet.debit', aggregateType: 'Bet', aggregateId: betId }, txEm)` — 3-arg form
- 6 unit tests (`services/games/tests/unit/place-bet.use-case.test.ts`, 47 expect calls):
  1. Happy path — returns `{ betId, status: 'PENDING' }`; bet + saga + outbox all written with the correct shape; saga `deadlineAt = now + SAGA_TIMEOUT_MS`; outbox envelope type is `wallet.debit`; route exchange is `wallet.commands`, routingKey is `wallet.debit`, aggregateType is `Bet`.
  2. No open round → `RoundNotInBettingPhaseError` with `actual === 'NO_OPEN_ROUND'`; no writes recorded.
  3. Open round in RUNNING → `Round.acceptBet` throws `RoundNotInBettingPhaseError` with `actual === 'RUNNING'`; no writes recorded.
  4. Player already has an active bet → `BetAlreadyActiveError` carries `existingBetId`; no writes recorded.
  5. Write order inside the transactional callback: `bet.save → saga.create → outbox.add` all observe the same txEm reference; `em.transactional` invoked exactly once.
  6. `correlationId` matches the UUIDv4 regex and is NOT equal to `betId`.

### Task 2 — BetCommandController + DTOs + module wiring

- `PlaceBetRequestDto` via `createZodDto(placeBetRequestSchema)` where `placeBetRequestSchema = z.object({ amountCents: z.string().regex(/^\d+$/).transform(s => BigInt(s)) }).strict()`. String-bigint snapshot avoids JSON precision loss on large cent values.
- `PlaceBetResponseDto` via `createZodDto(placeBetResponseSchema)` with `{ betId: uuid, status: literal('PENDING') }`.
- `BetCommandController @Controller('games/bet') @UseGuards(JwtGuard)`:
  - `@Post() @HttpCode(202)` — `place(req, body)` extracts `playerId = PlayerId(req.user!.playerId)`, constructs `Money.fromSnapshot({ amount: body.amountCents.toString(), currency: env.CURRENCY_CODE, scale: env.CURRENCY_EXPONENT })`, invokes the use case with `now: new Date()`, returns 202.
  - `translateError` maps the three domain errors to discriminated HTTP exceptions:
    - `RoundNotInBettingPhaseError` → `ConflictException({ code: 'ROUND_NOT_IN_BETTING_PHASE', phase: err.actual })`
    - `BetAlreadyActiveError` → `ConflictException({ code: 'BET_ALREADY_ACTIVE', existingBetId })`
    - `BetAmountOutOfBoundsError` → `BadRequestException({ code: 'BET_AMOUNT_OUT_OF_BOUNDS', amountCents, min, max })`
- `GameCoreModule` adds `PlaceBetUseCase` to providers + exports so AppModule's controller can resolve it.
- `AppModule.controllers` adds `BetCommandController`.

## Verification

- `bun test tests/unit/place-bet.use-case.test.ts` — **6 PASS / 0 FAIL** (47 expect calls).
- `bun test tests/unit` (full unit suite) — **144 PASS / 0 FAIL** (398 expect calls).
- `bunx tsc --noEmit` — clean (no output).

Live HTTP verification (POST /games/bet against Kong) deferred to Plan 05-10 (needs Kong route from 05-08 + saga handlers from 05-05/05-06/05-07).

## Commits

- `1fd7847` test(05-04): add failing tests for PlaceBetUseCase orchestration
- `e2d54ac` feat(05-04): implement PlaceBetUseCase orchestrating bet, saga, and outbox in single TX
- `8525e09` feat(05-04): expose POST /games/bet command controller with JwtGuard and discriminated 409s

## Deviations from Plan

None of substance. Two minor in-spirit choices:

- **Repo read calls don't take a txEm argument.** The current `RoundRepository.findOpen()` and `BetRepository.findActiveByRoundAndPlayer(roundId, playerId)` interfaces don't accept `txEm`. Phase 4 verified the EM-aware repos honour the active transactional context via MikroORM's RequestContext, so the reads still participate in the open TX. Documented as a decision rather than a deviation — the plan's pseudo-code showed `txEm` on the reads, but the actual interface signatures (locked in Phase 4) don't expose that hook. The writes (which MUST bind to txEm for the same-TX invariant) all pass txEm explicitly per the plan.
- **Use case does NOT throw `BetAmountOutOfBoundsError`.** The plan's `<action>` step 3c said "Skip if BetAmount VO already enforces this on construction". `BetAmountOutOfBoundsError` already exists in `domain/errors.ts` from Phase 4. Bounds enforcement currently lives at the Money construction boundary; if a future plan needs explicit use-case-side bounds, the error class is already there for re-use. Controller still translates it to 400 in `translateError` to be future-proof.

## Authentication Gates

None.

## Threat Surface Check

No new external network endpoints beyond `POST /games/bet` (which was already in the threat model under T-05-04-S/T/A/R). No new auth paths, no schema changes at trust boundaries (the `bets` and `bet_saga_state` schemas were locked in Phase 4 and Plan 05-03 respectively). Mitigations from the plan's threat register are all observably present in code:

- **T-05-04-S** (client-supplied playerId): controller uses `req.user!.playerId` from JWT; DTO has no `playerId` field.
- **T-05-04-T** (negative/oversized amount): zod regex `/^\d+$/` rejects negatives at parse time; `Money.fromSnapshot` would throw on negative; Phase 4 DB CHECK is the last line.
- **T-05-04-A** (unauthenticated POST): `@UseGuards(JwtGuard)` mandatory; smoke probe 34 (plan 05-10) will verify 401 without bearer.
- **T-05-04-R** (double-POST): use case's `findActiveByRoundAndPlayer` pre-check + Phase 4 partial unique index → SQLSTATE 23505 on concurrent INSERTs; race translates to `BetAlreadyActiveError` 409.

## Self-Check: PASSED

Verified on disk:

- FOUND: services/games/src/application/use-cases/place-bet.use-case.ts (PlaceBetUseCase class)
- FOUND: services/games/src/presentation/controllers/bet-command.controller.ts (BetCommandController @Controller("games/bet"))
- FOUND: services/games/src/presentation/dtos/place-bet.request.dto.ts (placeBetRequestSchema + PlaceBetRequestDto)
- FOUND: services/games/src/presentation/dtos/place-bet.response.dto.ts (PlaceBetResponseDto)
- FOUND: services/games/src/domain/errors.ts (BetAlreadyActiveError class)
- FOUND: services/games/src/application/game-core.module.ts (PlaceBetUseCase in providers + exports)
- FOUND: services/games/src/app.module.ts (BetCommandController in controllers)
- FOUND: services/games/tests/unit/place-bet.use-case.test.ts (6 tests, 47 expect)
- FOUND commits: 1fd7847, e2d54ac, 8525e09

## TDD Gate Compliance

- RED commit: `1fd7847` `test(05-04): add failing tests for PlaceBetUseCase orchestration` — verified failing (`Cannot find module ../../src/application/use-cases/place-bet.use-case`) before GREEN.
- GREEN commit: `e2d54ac` `feat(05-04): implement PlaceBetUseCase orchestrating bet, saga, and outbox in single TX` — verified 6/6 pass after.
- REFACTOR: not needed (use case is 80 lines, single responsibility, no duplication).
