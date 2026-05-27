---
phase: 05-saga-integration
plan: 10
subsystem: scripts / smoke / live-walkthrough-checkpoint
tags: [smoke, saga, blocking-checkpoint, req-game-06, req-game-07, blocked]
requires:
  - 05-08 (POST /games/bet + /games/bet/cashout routes opened at Kong)
  - 05-09 (integration test suite landed; awaiting live execution)
provides:
  - "Six new smoke probes (33-38) covering end-to-end bet -> cashout -> balance-delta at the Kong perimeter"
  - "Updated probe 32 to reflect post-05-08 reality (POST /games/bet now reaches games-service; JwtGuard rejects unauthenticated requests with 401 instead of Kong returning 404)"
affects:
  - "Phase 5 closeout (05-11) — live walkthrough gate cannot pass until the games-service DI defect documented below is fixed"
tech-stack:
  added: []
  patterns:
    - "Smoke probes share state across the script via three top-level vars (GAMES_LAST_BET_ID, GAMES_LAST_BET_AMOUNT, GAMES_LAST_CASHOUT_PAYOUT) so probes 35/36/37 can chain off probe 34's bet without re-placing"
    - "wait_for_round_phase helper polls /games/rounds/current every 400ms for up to 15s to land in BETTING vs RUNNING deterministically"
    - "Probe 34 polls /games/bets/me for up to 10s to allow the saga (SAGA_TIMEOUT_MS=5000 + sweep tick + grace) to settle PENDING -> ACTIVE or REFUNDED"
    - "Probe 38 accepts THREE valid 409 codes (NO_ACTIVE_BET / BET_NOT_CASHABLE / ROUND_NOT_RUNNING) because the round phase may flip while the probe runs"
key-files:
  created:
    - .planning/phases/05-saga-integration/05-10-SUMMARY.md
  modified:
    - scripts/smoke-health.sh
decisions:
  - "Updated probe 32 in scope of this plan even though the original PLAN said 'do NOT modify probes 1-32'. Justification (Rule 3 — blocking issue): the smoke run cannot reach 38/38 PASS while probe 32 asserts the legacy 404+no-Route-matched body for POST /games/bet — that body only existed BEFORE plan 05-08 opened the Kong route. After 05-08 the request now traverses Kong and hits the games-service, which (when working) rejects unauthenticated POSTs with 401 via JwtGuard. The probe was rewritten to assert that 401 instead — same intent (POST /games/bet is gated at the perimeter), but expressed against the post-05-08 truth."
  - "Captured GAMES_LAST_BET_AMOUNT as a constant (10000 cents = 100.00 BRL) so probes 34/35/37 read from a single source of truth without hard-coding the number in three places. Future-proof for an env-driven default if needed."
  - "Probe 38 deliberately polls /games/bets/me for up to 25s waiting for the previous ACTIVE bet to clear (cashed-out in probe 36 OR auto-LOST when the round crashes) before issuing the no-active cashout call. Without that wait, the probe would race the round loop and intermittently fail when the bet was still settling."
metrics:
  duration_minutes: 22
  completed: 2026-05-27
  tasks_completed: 1
  files_changed: 1
  probes_added: 6
status: BLOCKED
---

# Phase 05 Plan 10: Live Smoke + Integration Walkthrough Summary

## Status: BLOCKED on prior-plan defect

Task 1 (smoke probes 33-38) shipped clean. Task 2 (live walkthrough — BLOCKING `checkpoint:human-verify`) cannot pass because the running `games` service container crashes on boot with a NestJS dependency-injection error introduced by plan 05-05. The blocker is documented below; the smoke run reports 31/38 PASS purely because every probe that talks to `games` over POST gets a 404 from Express's "Cannot POST" fallback (the controllers never registered because the Nest factory aborted).

## What Shipped

### Task 1 — Smoke probes 33-38 + probe 32 alignment

Six new bash functions appended to `scripts/smoke-health.sh` and registered in the driver loop after probe 32:

| #   | Probe                                       | Asserts                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 33  | `probe_games_bet_place_outside_betting`     | POST /games/bet during RUNNING -> 409 with `code: "ROUND_NOT_IN_BETTING_PHASE"`. Retries up to 3 times if the round flips into BETTING before the POST lands.                                                                                                                            |
| 34  | `probe_games_bet_place_happy`               | Polls /games/rounds/current for BETTING; POSTs `{amountCents:"10000"}` to /games/bet -> 202 + `status:"PENDING"` + `betId` matches uuid regex. Then polls /games/bets/me for up to 10s; asserts the bet shows up with status in `{ACTIVE, REFUNDED}`. Captures `GAMES_LAST_BET_ID`.       |
| 35  | `probe_games_balance_decreased_after_bet`   | Reads /wallets/me. If probe 34's bet ended ACTIVE: balance < 100000 (= initial - 10000). If REFUNDED: balance >= 100000 (debit was rolled back).                                                                                                                                          |
| 36  | `probe_games_bet_cashout_during_running`    | Requires prior ACTIVE bet. Waits for RUNNING; POSTs /games/bet/cashout -> 200 + `multiplier > 1.0` + `payoutCents.amount` parses to bigint + `payoutCents.scale == 2`. Captures `GAMES_LAST_CASHOUT_PAYOUT`.                                                                              |
| 37  | `probe_games_balance_credited_after_cashout`| Polls /wallets/me for up to 8s waiting for balance >= (initial - bet + payout). Covers downstream eventual-consistency through wallet.credit -> wallets-service -> wallets DB.                                                                                                            |
| 38  | `probe_games_bet_cashout_without_active`    | Polls /games/bets/me until no ACTIVE bet remains (up to 25s); POSTs /games/bet/cashout -> 409 with code in `{NO_ACTIVE_BET, BET_NOT_CASHABLE, ROUND_NOT_RUNNING}` (all three are valid terminal rejections depending on round phase).                                                     |

Helper `wait_for_round_phase` added — polls `/games/rounds/current` every 400ms for up to 15s waiting for a desired status. Reused by probes 33, 34, 36.

Probe 32 was rewritten (Rule 3 deviation — see Decisions) to assert 401 from JwtGuard instead of 404 from Kong, reflecting the route opening in plan 05-08.

`bash -n scripts/smoke-health.sh` is clean. All six new probe-function names + the driver-loop additions are present.

### Task 2 — Live walkthrough: BLOCKED

`bun run docker:down && docker compose build games wallets && docker compose up -d --wait` reaches healthy state on every container. The `games-1` container becomes healthy via Docker's healthcheck (port 4001 responds because `/health` is mounted before the Nest factory aborts on the second bootstrap attempt), but the Nest application factory throws on startup with:

```
ERROR [ExceptionHandler] UnknownDependenciesException [Error]: Nest can't resolve dependencies
of the PlaceBetUseCase (PostgreSqlEntityManager, ?, ROUND_REPOSITORY, BET_REPOSITORY, BET_SAGA_REPOSITORY).
Please make sure that the argument OutboxRepository at index [1] is available in the GameCoreModule module.
```

As a result every POST that should be routed by Kong to `games:4001` returns Express's `{"message":"Cannot POST /games/bet","error":"Not Found","statusCode":404}` body — the controllers were never registered. The smoke output is:

```
[FAIL] 32: POST /games/bet at Kong reaches games-service (route opened in 05-08): Kong returned 404 — expected route games-bet-place to be open after 05-08
[FAIL] 33: POST /games/bet during RUNNING returns 409 ROUND_NOT_IN_BETTING_PHASE: expected 409, got 404 body={"message":"Cannot POST /games/bet","error":"Not Found","statusCode":404}
[FAIL] 34: POST /games/bet during BETTING returns 202 PENDING + bet settles to ACTIVE: expected 202, got 404 body={"message":"Cannot POST /games/bet",...}
[FAIL] 35: wallet balance decreases by bet amount after settlement: no GAMES_LAST_BET_ID (probe 34 must run first)
[FAIL] 36: POST /games/bet/cashout during RUNNING returns 200 + multiplier > 1: no prior bet (probe 34 must succeed)
[FAIL] 37: wallet balance credited by payoutCents after cashout: no prior cashout payout (probe 36 must succeed)
[FAIL] 38: POST /games/bet/cashout without ACTIVE bet returns 409: expected 409, got 404 body={"message":"Cannot POST /games/bet/cashout",...}

Smoke summary: 31/38 probes passed
```

Probes 1-31 all PASS; the failure surface is exactly the new Phase 5 POST routes plus the updated probe 32.

## Blocker — Root Cause Diagnosis

**Defect introduced in:** plan 05-05 (`PlaceBetUseCase` + `CashOutUseCase` providers in `GameCoreModule`).

**Where it lives:**

- `services/games/src/application/use-cases/place-bet.use-case.ts` (and `cash-out.use-case.ts`, `saga-timeout-sweeper.service.ts`, `handlers/wallet-debited.handler.ts`, `handlers/wallet-debit-rejected.handler.ts`) all inject `OutboxRepository` from `@crash/messaging-spine`.
- `services/games/src/application/game-core.module.ts` registers those classes as providers but does NOT import any module that exports `OutboxRepository`.
- `services/games/src/app.module.ts` imports `MessagingSpineModule.forRootAsync(...)`, which provides `OutboxRepository` — but `MessagingSpineModule` is NOT decorated `@Global`, so its providers are only visible inside `app.module.ts`'s own provider scope (and the controllers wired there), not inside the child `GameCoreModule`.

**Why it slipped past 05-05 / 05-09:**

- Plan 05-05's unit tests construct `PlaceBetUseCase` directly with hand-rolled mocks for the outbox — DI is never exercised.
- Plan 05-09's integration tests are gated behind `INTEGRATION=1` and were never actually run live during the planning waves; they were only authored, not executed.
- Phase 4's `CrashRoundUseCase` lives in the same `GameCoreModule` but does NOT inject `OutboxRepository`, so the boot path was healthy through Phase 4 even with the same missing import.

**Fix scope (Rule 4 — architectural, requires human approval):**

The minimal correct fix is one of:

1. **Add `@Global()` to `MessagingSpineModule`** in `packages/messaging-spine/src/module.ts`. The inner `MessagingOptionsModule` is ALREADY global (`global: true` on line 42 of that file) which strongly suggests the outer wrapper was supposed to be too. Diff: one decorator + one `global: true` in the DynamicModule return. This is what wallets-service implicitly relies on (wallets puts all use cases directly in `app.module.ts`, so the visibility of OutboxRepository never crossed a module boundary there).

2. **Have `GameCoreModule` re-import `MessagingSpineModule`** via a forwardRef — significantly uglier and would double-bind topology if not careful.

3. **Move all Phase 5 use cases out of `GameCoreModule` and into `app.module.ts` directly** — symmetric with wallets but loses the boundary the team established in Phase 4.

This plan deliberately did NOT apply any of those fixes because the prompt scope was explicit: "Touch ONLY `scripts/smoke-health.sh` + `.planning/phases/05-saga-integration/05-10-SUMMARY.md`". The DI fix lives in `packages/messaging-spine/src/module.ts` (option 1) or `services/games/src/application/game-core.module.ts` (option 2/3) — both outside the allowed scope. Surfacing as a blocker per the plan's "If Docker daemon down or any probe/test fails -> `## PLAN BLOCKED` with diagnosis" instruction.

**Recommendation:** Option 1 — add `@Global()` to `MessagingSpineModule`. Three reasons: (a) it matches the design intent (MessagingOptionsModule is already global); (b) it's a one-decorator change with zero behavioral side effects beyond making the same providers visible in child modules; (c) wallets-service is already implicitly relying on this convention without realising it (the wallets app happens to put use cases directly in app.module so the bug never bit).

## Diagnostic Bundle

### `docker compose ps`

All eight containers (postgres, rabbitmq, keycloak, kong, wallets, games, games-migrate, wallets-migrate) reported healthy at the Docker level. games-migrate and wallets-migrate Exited(0) cleanly.

### `docker compose logs games --tail=10`

```
[Nest] 1  - 05/27/2026, 7:29:20 PM    LOG [NestFactory] Starting Nest application...
[Nest] 1  - 05/27/2026, 7:29:20 PM    LOG [InstanceLoader] MessagingOptionsModule dependencies initialized
[Nest] 1  - 05/27/2026, 7:29:20 PM    LOG [InstanceLoader] MessagingClsModule dependencies initialized
[Nest] 1  - 05/27/2026, 7:29:20 PM    LOG [AmqpConnection] Trying to connect to RabbitMQ broker (default)
[Nest] 1  - 05/27/2026, 7:29:20 PM    LOG [InstanceLoader] DiscoveryModule dependencies initialized
[Nest] 1  - 05/27/2026, 7:29:20 PM  ERROR [ExceptionHandler] UnknownDependenciesException [Error]: Nest can't resolve dependencies of the PlaceBetUseCase (PostgreSqlEntityManager, ?, ROUND_REPOSITORY, BET_REPOSITORY, BET_SAGA_REPOSITORY). Please make sure that the argument OutboxRepository at index [1] is available in the GameCoreModule module.
```

### bet_saga_state / outbox tables

Both tables exist (smoke probes 7 + 8 PASS) but are empty — no Phase 5 saga has been driven end-to-end because the entry-point controllers never registered.

### RabbitMQ queues

All five Phase 2 + 3 queues exist and are bound (smoke probes 18-22 PASS); `wallet.debit.q` has 0 messages because games never published any debit commands.

## Tests Not Executed

Per the BLOCKED state, the following gates were NOT exercised in this plan and remain pending the Option-1 (or 2/3) DI fix:

- `cd services/games && INTEGRATION=1 bun test tests/integration` — 8 scenarios (7 happy/error + 1 SIGKILL drill with 2 sub-tests). Expected to fail with the same DI error during `Test.createTestingModule({ imports: [AppModule] }).compile()`.
- `cd services/wallets && INTEGRATION=1 bun test tests/integration` — 15 scenarios. Independent of the games DI bug; should remain green but was not re-executed under this BLOCKED state.
- Manual curl flow (POST /wallets, wait BETTING, POST /games/bet, wait ACTIVE, wait RUNNING, POST /games/bet/cashout, verify balance delta).
- CLI verifier on a settled round.

All four are deferred to the post-fix re-run of plan 05-10. The smoke probes 33-38 are written to be re-runnable idempotently (probe 34 re-places a fresh bet each invocation), so no probe changes are needed once the DI fix lands.

## Self-Check: PASSED

- `scripts/smoke-health.sh` exists with `probe_games_bet_place_happy`, `probe_games_bet_place_outside_betting`, `probe_games_balance_decreased_after_bet`, `probe_games_bet_cashout_during_running`, `probe_games_balance_credited_after_cashout`, `probe_games_bet_cashout_without_active` all present (2 occurrences each — definition + driver loop entry).
- `bash -n scripts/smoke-health.sh` passes.
- Commit `48142ad feat(05-10): add games smoke probes 33-38 covering bet place + cashout + balance deltas` exists in `git log --oneline -5`.
- This SUMMARY file exists at `.planning/phases/05-saga-integration/05-10-SUMMARY.md`.
- Live walkthrough explicitly NOT signed off — status: BLOCKED, awaiting human approval on the DI fix scope.
