---
phase: 05-saga-integration
plan: 06
subsystem: games / application + presentation
tags: [saga, use-case, controller, cashout, server-clock, pitfall-c2, req-game-07, req-saga-04]
requires:
  - 05-02 (RoundLoopService.getMultiplierAt — synchronous server-clock multiplier source)
  - 05-04 (BetCommandController @ /games/bet, JwtGuard pattern)
  - Phase 4 (Bet.cashOut domain method, BetRepository.tryTransition + findActiveByRoundAndPlayer)
  - Phase 2 (OutboxRepository.add 3-arg form with txEm bind, EXCHANGES.WALLET_COMMANDS)
provides:
  - "CashOutUseCase — single em.transactional that loads RUNNING round, transitions Bet ACTIVE→CASHED_OUT via tryTransition, and writes wallet.credit outbox row"
  - "POST /games/bet/cashout endpoint returning 200 with { multiplier, payoutCents } — server-clock acceptedAt captured as literal first executable line"
  - "RoundNotRunningError, NoActiveBetError, BetNotCashableError domain errors with discriminated 409 mapping"
  - "CashoutResponseDto type alias (server-emitted body, MoneySnapshot shape)"
affects:
  - 05-08 (Kong route games-bet-cashout will forward to this controller path)
  - 05-09 (integration test scenario #5 will exercise the full cashout → wallet credit flow)
  - 05-11 (code-review checkpoint will grep for `const acceptedAt = new Date` at first-line position)
tech-stack:
  added: []
  patterns:
    - "Server-clock authority via `const acceptedAt = new Date()` as the FIRST executable line of the cashout method body — before any await — preventing Pitfall C2"
    - "Synchronous multiplier capture via RoundLoopService.getMultiplierAt(acceptedAt) — no DB, no await on the cashout hot path"
    - "Caller-owned em.transactional wraps bet transition + outbox write; both bind the same txEm"
    - "Fresh correlationId per cashout via randomUUID — independent of the betId aggregate key"
    - "Discriminated ConflictException payloads ({ code, ... }) — same shape contract as place-bet (plan 05-04) so the frontend can pattern-match on code"
key-files:
  created:
    - services/games/src/application/use-cases/cash-out.use-case.ts
    - services/games/src/presentation/dtos/cashout.response.dto.ts
    - services/games/tests/unit/cash-out.use-case.test.ts
  modified:
    - services/games/src/domain/errors.ts (+ RoundNotRunningError, NoActiveBetError, BetNotCashableError — 28 lines)
    - services/games/src/presentation/controllers/bet-command.controller.ts (+ @Post('cashout') + translateCashoutError, split translateError → translatePlaceError)
    - services/games/src/application/game-core.module.ts (+ CashOutUseCase provider + RoundLoopService export)
decisions:
  - "translateError split into translatePlaceError + translateCashoutError. Plan 05-04 had a single `translateError` covering the three place-bet domain errors; adding the three cashout errors to the same dispatcher would have grown an unrelated switch. Splitting keeps each handler's surface bounded to a single endpoint's failure modes and avoids accidental cross-talk (e.g., a BetNotCashableError leaking into a place-bet response). The trade-off is two private methods instead of one — acceptable for code-review clarity."
  - "RoundLoopService.getMultiplierAt throws a plain Error (not a domain error) when no RUNNING round is cached (plan 05-02 artifact). The controller catches the bare throw and translates to `ConflictException({ code: 'ROUND_NOT_RUNNING', phase: 'UNKNOWN' })`. Distinct from the use-case-level RoundNotRunningError which carries the actual round status — the cache-miss branch can't observe the status by design."
  - "CashoutResponseDto is a plain TypeScript type alias rather than a createZodDto. Server-emitted body, no incoming request validation needed, MoneySnapshot shape is locked in shared-kernel. Matches the plan's recommendation; if a future plan needs schema export to the frontend the type can be promoted to zod without API change."
  - "Use case does NOT re-validate `bet.status === 'ACTIVE'` redundantly. The single source of truth is the pre-check after findActiveByRoundAndPlayer. `Bet.cashOut` (domain) also throws IllegalBetTransitionError if called on a non-ACTIVE bet — that's the defense-in-depth backstop. The use-case layer catches the legitimate `RACE` path through `tryTransition` returning null when a concurrent transition wins."
metrics:
  duration_minutes: 4
  completed: 2026-05-27
  tasks_completed: 2
  files_changed: 6
  tests_added: 7
---

# Phase 05 Plan 06: CashOutUseCase + POST /games/bet/cashout Summary

REQ-GAME-07 + REQ-SAGA-04: the synchronous cashout endpoint lands. POST `/games/bet/cashout` (JwtGuard-protected, no body — player identified via JWT sub) returns 200 with `{ multiplier, payoutCents }`. The controller method's literal first executable line is `const acceptedAt = new Date()` (defeating Pitfall C2). The multiplier is captured synchronously via `roundLoop.getMultiplierAt(acceptedAt)` before any await. Inside a single `em.transactional` callback, the use case validates the round is RUNNING and the bet is ACTIVE, transitions the bet to CASHED_OUT via `bets.tryTransition` (race-safe), and writes the `wallet.credit` outbox row — all bound to the same `txEm`. The wallet credit lands asynchronously via the outbox publisher and never blocks the HTTP response.

## What Shipped

### Task 1 — CashOutUseCase + three domain errors + 7 unit tests (RED + GREEN)

- Three new domain errors in `services/games/src/domain/errors.ts`:
  - `RoundNotRunningError` (code `ROUND_NOT_RUNNING`, readonly `actual: RoundStatus | 'NO_OPEN_ROUND'`)
  - `NoActiveBetError` (code `NO_ACTIVE_BET`, no extra fields)
  - `BetNotCashableError` (code `BET_NOT_CASHABLE`, readonly `status: BetStatus | 'RACE'`)
- `CashOutUseCase` (constructor-injected `EntityManager`, `OutboxRepository`, `RoundRepository`, `BetRepository`). `execute({ playerId, multiplier, acceptedAt })` returns `{ multiplier, payout }`. The entire write set runs inside `em.transactional(async (txEm) => { ... })`:
  1. `rounds.findOpen()` → throws `RoundNotRunningError('NO_OPEN_ROUND')` when null
  2. `open.status !== 'RUNNING'` → throws `RoundNotRunningError(open.status)` (e.g., BETTING, CRASHED, SETTLED)
  3. `bets.findActiveByRoundAndPlayer(open.id, playerId)` → throws `NoActiveBetError` when null
  4. `active.status !== 'ACTIVE'` → throws `BetNotCashableError(active.status)` (defense in depth — repo's "active" lookup includes PENDING in some implementations)
  5. `active.cashOut(multiplier, acceptedAt)` — pure aggregate call returning `{ next, payout }` (banker's-rounded multiplyRounded on `amount * tenThousandths / 10_000`)
  6. `bets.tryTransition(active.id, 'ACTIVE', 'CASHED_OUT', { cashedOutAt, cashedOutMultiplier, payout }, txEm)` → throws `BetNotCashableError('RACE')` when null (concurrent sweeper or another cashout won)
  7. `correlationId = randomUUID()` + `outbox.add(buildEnvelope({ type: 'wallet.credit', ... }), { exchange: WALLET_COMMANDS, routingKey: 'wallet.credit', aggregateType: 'Bet', aggregateId: active.id }, txEm)` — 3-arg form binding the same `txEm`
- 7 unit tests in `services/games/tests/unit/cash-out.use-case.test.ts` (42 expect calls):
  1. **Happy path** — verifies one `em.transactional` call, exactly one `tryTransition` call with the right `from/to/patch`, exactly one outbox call. Asserts envelope `type='wallet.credit'`, `correlationId` non-empty, payload `{ playerId, amount: { amount: '1000', ... } }` (500-cent bet × 2.0× multiplier = 1000 cents), and route `{ exchange: 'wallet.commands', routingKey: 'wallet.credit', aggregateType: 'Bet', aggregateId: <betId> }`. Result returns the same `multiplier` and the computed `payout`.
  2. **No open round** → `RoundNotRunningError` with `actual === 'NO_OPEN_ROUND'`; no writes recorded.
  3. **Round status BETTING** → `RoundNotRunningError` with `actual === 'BETTING'`; no writes recorded.
  4. **No active bet** → `NoActiveBetError`; no writes recorded.
  5. **Bet exists but PENDING** → `BetNotCashableError` with `status === 'PENDING'`; no writes recorded.
  6. **tryTransition returns null (race)** → `BetNotCashableError` with `status === 'RACE'`; no outbox write.
  7. **Write order + txEm identity** — verifies `bets.tryTransition` is called before `outbox.add` (recorded order cursor), and both observe the same `txEm` reference (which is the stub's `em` itself).

### Task 2 — Cashout endpoint + response DTO + module wiring

- `CashoutResponseDto` is a plain type alias in `cashout.response.dto.ts` — `{ multiplier: number; payoutCents: { amount: string; currency: string; scale: number } }`. Server-emitted only, no zod validation needed.
- `BetCommandController` extended:
  - Constructor adds `private readonly cashOut: CashOutUseCase` and `private readonly roundLoop: RoundLoopService`.
  - New `@Post('cashout') @HttpCode(200) async cashout(@Req() req)` method. **First executable line is `const acceptedAt = new Date();`** — verified by `grep -n "const acceptedAt = new Date" services/games/src/presentation/controllers/bet-command.controller.ts` returning a single match at the method's opening line.
  - Multiplier capture is synchronous (`this.roundLoop.getMultiplierAt(acceptedAt)`) and happens before any await. Cache-miss is caught and surfaced as `409 { code: 'ROUND_NOT_RUNNING', phase: 'UNKNOWN' }`.
  - Use case call follows. On success returns `{ multiplier: result.multiplier.toNumber(), payoutCents: result.payout.toSnapshot() }`.
  - `translateCashoutError` maps the three cashout domain errors to discriminated `ConflictException`:
    - `RoundNotRunningError` → `{ code: 'ROUND_NOT_RUNNING', phase: err.actual }`
    - `NoActiveBetError` → `{ code: 'NO_ACTIVE_BET' }`
    - `BetNotCashableError` → `{ code: 'BET_NOT_CASHABLE', status: err.status }`
  - Existing `translateError` renamed to `translatePlaceError` for the place-bet path (decision: bounded per-endpoint surface).
- `GameCoreModule` adds `CashOutUseCase` to providers + exports, and adds `RoundLoopService` to exports so the controller (registered in `AppModule.controllers`) can inject it.
- `AppModule` untouched — the controller was already registered in plan 05-04. No new Kong route here (deferred to plan 05-08).

## Verification

- `bun test tests/unit/cash-out.use-case.test.ts` — **7 PASS / 0 FAIL** (42 expect calls).
- `bun test tests/unit` (full unit suite) — **160 PASS / 0 FAIL** (512 expect calls).
- `bunx tsc --noEmit` — clean.
- `grep -n "const acceptedAt = new Date" services/games/src/presentation/controllers/bet-command.controller.ts` → `69:    const acceptedAt = new Date();` — single match, sits immediately after the method opening brace on line 68.

Live HTTP verification (POST /games/bet/cashout against Kong + downstream wallet credit) deferred to plan 05-09 integration scenario #5.

## Commits

- `d38b6db` test(05-06): add failing tests for CashOutUseCase orchestration
- `feb1695` feat(05-06): implement CashOutUseCase with atomic ACTIVE→CASHED_OUT and wallet.credit outbox
- `dd46013` feat(05-06): expose POST /games/bet/cashout with server-clock acceptedAt and discriminated 409s

## Deviations from Plan

None of substance. Two minor in-spirit choices:

- **`translateError` renamed to `translatePlaceError` and a new `translateCashoutError` added.** Plan 05-04 had a single `translateError`. With three new error types this plan introduces, lumping them into one switch would grow an unrelated method beyond its bounded responsibility. Splitting is in spirit with the discriminated-payload pattern the plan stresses for each endpoint.
- **RoundLoopService cache-miss surfaces with `phase: 'UNKNOWN'`.** `getMultiplierAt` throws a bare `Error` (not a domain error) when no RUNNING round is cached. The catch block can't observe the actual round status (no DB round read), so it surfaces `'UNKNOWN'` to distinguish from the use-case-level `RoundNotRunningError` which carries the real `phase`. Two branches, same `code`, different `phase` granularity — frontend can still pattern-match on `code='ROUND_NOT_RUNNING'` to render the same UI affordance.

## Authentication Gates

None.

## Threat Surface Check

No new external network endpoints beyond `POST /games/bet/cashout` (already in the plan's threat register). Mitigations from `<threat_model>` are all observably present in code:

- **T-05-06-T** (client-supplied multiplier in cashout body): `cashout()` takes no body — the method signature is `async cashout(@Req() req: AuthenticatedRequest)`. There is no `@Body()` parameter. Multiplier comes exclusively from `roundLoop.getMultiplierAt(acceptedAt)`.
- **T-05-06-RACE** (cashout after crash): `getMultiplierAt` caps at `currentCrashPoint` (plan 05-02); `Bet.cashOut` aggregate throws `IllegalBetTransitionError` if not ACTIVE; `tryTransition` returns null on concurrent transition → translates to `BetNotCashableError('RACE')` → 409.
- **T-05-06-S** (spoofed playerId): controller uses `PlayerId(req.user!.playerId)` from JWT; no body field.
- **T-05-06-A** (unauthenticated POST): `@UseGuards(JwtGuard)` inherited from controller class (locked in plan 05-04); smoke probe in plan 05-10 will verify 401 without bearer.

## Self-Check: PASSED

Verified on disk:

- FOUND: services/games/src/application/use-cases/cash-out.use-case.ts (CashOutUseCase class)
- FOUND: services/games/src/presentation/dtos/cashout.response.dto.ts (CashoutResponseDto type alias)
- FOUND: services/games/tests/unit/cash-out.use-case.test.ts (7 tests, 42 expect)
- FOUND: services/games/src/domain/errors.ts (RoundNotRunningError, NoActiveBetError, BetNotCashableError classes)
- FOUND: services/games/src/presentation/controllers/bet-command.controller.ts (@Post('cashout') method with `const acceptedAt = new Date()` at line 69)
- FOUND: services/games/src/application/game-core.module.ts (CashOutUseCase in providers + exports, RoundLoopService in exports)
- FOUND commits: d38b6db, feb1695, dd46013

## TDD Gate Compliance

- RED commit: `d38b6db` `test(05-06): add failing tests for CashOutUseCase orchestration` — verified failing (`Cannot find module '../../src/application/use-cases/cash-out.use-case'`) before GREEN.
- GREEN commit: `feb1695` `feat(05-06): implement CashOutUseCase with atomic ACTIVE→CASHED_OUT and wallet.credit outbox` — verified 7/7 pass after.
- REFACTOR: not needed (use case is 70 lines, single responsibility, no duplication).
