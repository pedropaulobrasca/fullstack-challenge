---
phase: 05-saga-integration
plan: 09
subsystem: games / tests / integration
tags: [integration-tests, saga, sigkill, req-test-03, req-test-04, compensation]
requires:
  - 05-04 (POST /games/bet — entry point under test)
  - 05-05 (WalletDebitedHandler — compensation branch under test)
  - 05-06 (POST /games/bet/cashout — cashout endpoint under test)
  - 05-07 (SagaTimeoutSweeper — drives REFUNDED + TIMED_OUT)
  - 05-08 (Kong route games-bet-place + games-bet-cashout — perimeter under test)
  - Phase 4 (test-env + app-factory helpers)
provides:
  - "7 integration test files under services/games/tests/integration/ covering REQ-TEST-03 + REQ-TEST-04"
  - "Compensation branch coverage — saga TIMED_OUT -> wallet.credit -> COMPENSATED"
  - "True-SIGKILL drill scripted via spawnSync('docker', ['compose', 'kill', '-s', 'SIGKILL', 'games']) — REQ-TEST-04"
  - "AMQP binding manipulation technique (unbindQueue / bindQueue) for forcing saga timeout without docker stop"
affects:
  - 05-10 (live smoke checkpoint — these tests are gated to that plan via INTEGRATION=1)
tech-stack:
  added: []
  patterns:
    - "AMQP binding manipulation in tests (amqp.unbindQueue + bindQueue) to detach the wallets consumer without docker-level surgery — fastest way to force a saga timeout"
    - "Hybrid in-process / Kong API access: in-process games for direct EM observation of bets + saga rows; wallets accessed via Kong at :8000 (separate process in docker stack)"
    - "SIGKILL test uses spawnSync('docker', ['compose', 'kill', '-s', 'SIGKILL', 'games']) — talks to games via Kong because the in-process EM would die alongside the container"
    - "Test-level cleanup of player-scoped bet + saga rows between scenarios (DELETE ... WHERE player_id = ?) — needed because the round-loop runs autonomously and tests share the Keycloak player identity"
key-files:
  created:
    - services/games/tests/integration/place-bet.test.ts
    - services/games/tests/integration/saga-insufficient-funds.test.ts
    - services/games/tests/integration/bet-outside-betting.test.ts
    - services/games/tests/integration/saga-timeout-and-compensation.test.ts
    - services/games/tests/integration/cash-out.test.ts
    - services/games/tests/integration/double-cashout.test.ts
    - services/games/tests/integration/kill-9-saga-recovery.test.ts
    - .planning/phases/05-saga-integration/05-09-SUMMARY.md
  modified: []
decisions:
  - "AMQP binding manipulation (Option A from plan) chosen over docker compose stop wallets (Option B). Three reasons: (a) amqplib was already in services/games devDependencies from Phase 2 — no new package needed; (b) binding manipulation is reversible inside a single afterAll without leaving the docker stack in a broken state for subsequent tests; (c) docker stop wallets risks killing other dependent containers and is harder to validate ready-state after restart. The technique is documented at the top of saga-timeout-and-compensation.test.ts so the recruiter can read the intent without spelunking the AMQP spec."
  - "Wallet provisioning calls go through Kong at :8000 instead of the in-process games HTTP server because wallets is a separate process in the docker stack. The in-process games-service has no wallets routes and would 404; the in-process app is solely used for the games-side HTTP API + direct EM observation."
  - "SIGKILL test uses Kong (not the in-process games-service) end-to-end because SIGKILL'ing the games container would also kill the test runner if it shared the games process. Talking through Kong keeps the test runner out of the SIGKILL blast radius. The trade-off: the docker container must be running before this test executes (covered by docker:up prerequisite for INTEGRATION=1)."
  - "Player-scoped DELETEs between scenarios (not TRUNCATE) because all bet placement tests share the same Keycloak password-grant player. TRUNCATE would also wipe the active round + seed_chain which the autonomous loop depends on. Each test starts with `clearPlayerBetState(em, playerId)` to remove stale bets + saga rows from prior tests."
  - "Double-cashout test accepts THREE possible codes (NO_ACTIVE_BET, BET_NOT_CASHABLE, ROUND_NOT_RUNNING) because the timing window between the first cashout completing and the second cashout arriving may straddle a round transition. All three indicate the correct rejection — the test asserts the rejection happened with a 409 + one of the documented terminal codes."
metrics:
  duration_minutes: 8
  completed: 2026-05-27
  tasks_completed: 3
  files_changed: 8
  tests_added: 7
---

# Phase 05 Plan 09: Saga Integration Test Suite Summary

7 integration test files under `services/games/tests/integration/` covering REQ-TEST-03 (E2E API happy + error paths) and REQ-TEST-04 (kill-9 saga recovery). Each test self-skips when `INTEGRATION != "1"`. Live execution is the responsibility of plan 05-10 (which brings up the docker stack via `bun run docker:up` and runs `INTEGRATION=1 bun test tests/integration` plus the smoke probe matrix).

## What Shipped

### Task 1 — Three foundational scenarios

| File                                | Path                                                                     | Asserts                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `place-bet.test.ts`                 | `services/games/tests/integration/place-bet.test.ts`                     | REQ-GAME-06 + REQ-SAGA-01 happy: 202 PENDING -> bet.ACTIVE + saga.CONFIRMED + wallet debited + outbox bet.active |
| `saga-insufficient-funds.test.ts`   | `services/games/tests/integration/saga-insufficient-funds.test.ts`       | REQ-SAGA-01 rejection: bet > balance -> bet.REFUNDED w/ INSUFFICIENT_FUNDS + saga.REFUNDED + balance unchanged |
| `bet-outside-betting.test.ts`       | `services/games/tests/integration/bet-outside-betting.test.ts`           | REQ-GAME-08 surface: POST /games/bet during RUNNING -> 409 ROUND_NOT_IN_BETTING_PHASE                          |

All three follow the Phase 4 integration test shape (describe + beforeAll w/ truncate + afterAll w/ app.close + waitFor primitives). Wallet provisioning calls Kong at `${KONG_BASE_URL ?? "http://localhost:8000"}`; games HTTP traffic uses the in-process `booted.baseUrl` so the in-process `booted.em` can observe bet + saga rows directly.

### Task 2 — Timeout + compensation + cashout + double-cashout

| File                                       | Asserts                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `saga-timeout-and-compensation.test.ts`    | Two sub-tests. (1) unbind `wallet.debit.q` from `wallet.commands` exchange -> POST /games/bet -> sweeper times out after `SAGA_TIMEOUT_MS=2000` + sweep interval -> bet.REFUNDED w/ SAGA_TIMEOUT + saga.TIMED_OUT. (2) rebind the queue -> late wallet.debited arrives -> WalletDebitedHandler TIMED_OUT branch fires -> saga.COMPENSATED + outbox row with `type='wallet.credit'` for the same correlationId + wallet balance restored. |
| `cash-out.test.ts`                         | REQ-GAME-07 + REQ-SAGA-04 happy: place bet -> wait ACTIVE -> wait RUNNING -> POST /games/bet/cashout -> 200 { multiplier >= 1, payoutCents } -> bet.CASHED_OUT -> wallet credited downstream by payout amount.                                          |
| `double-cashout.test.ts`                   | First cashout 200 -> second cashout 409 with code in { NO_ACTIVE_BET, BET_NOT_CASHABLE, ROUND_NOT_RUNNING } (any of the three is a valid terminal rejection).                                                                                          |

The compensation file documents the AMQP-binding-manipulation technique at the top of the file in a comment block (plan `<done>` clause #2).

### Task 3 — True-SIGKILL saga recovery (REQ-TEST-04)

`kill-9-saga-recovery.test.ts` invokes `spawnSync('docker', ['compose', 'kill', '-s', 'SIGKILL', 'games'])` then `docker compose start games`, polls Kong `${KONG_BASE_URL}/games/rounds/current` until 200, then asserts the placed bet reaches one of `{ ACTIVE, REFUNDED, CASHED_OUT, LOST }` (never stuck PENDING). Self-skips when:

1. `INTEGRATION != "1"`
2. `which docker` exits non-zero
3. `docker compose version` exits non-zero

The test talks to Kong end-to-end (not the in-process games-service) because SIGKILL'ing the games container would also kill any in-process app sharing the games process tree.

## Verification

- `cd services/games && bunx tsc --noEmit -p tsconfig.integration.json` — **clean** (no output).
- Live execution deferred to plan 05-10 (which runs `bun run docker:up` + `INTEGRATION=1 bun test tests/integration` + smoke probes 33-38).

## Commits

| Hash      | Message                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `0839228` | test(05-09): foundational integration scenarios — place-bet, insufficient-funds, bet-outside-betting                 |
| `fc34c22` | test(05-09): timeout, compensation, cashout, and double-cashout integration scenarios                                |
| `8926de9` | test(05-09): true-SIGKILL saga recovery drill via docker compose kill                                                |

## Deviations from Plan

**[Rule 3 — Blocking issue] Test count is 7, plan frontmatter listed 7 file paths**

The plan's `<tasks>` section split into 3 grouped tasks (Task 1: 3 files, Task 2: 3 files, Task 3: 1 file) totalling 7 files, matching the `files_modified` frontmatter. No deviation in deliverable count.

**[Rule 3 — Blocking issue] Wallet calls route through Kong instead of in-process games HTTP**

Plan implies `POST /wallets` provisioning could share the in-process app, but the in-process games-service does not host wallets routes (wallets is a separate NestJS process in the docker stack). The tests provision wallets via the live Kong gateway at `${KONG_BASE_URL ?? "http://localhost:8000"}` and observe games-side state via the in-process EntityManager. Documented under decisions.

**[Rule 2 — Auto-add missing critical functionality] Player-scoped DELETE cleanup between tests**

The plan describes `truncate bets / bet_saga_state / outbox / inbox / wallet rows` in beforeAll. Full TRUNCATE in beforeAll would also wipe the seed_chain and active rounds which the autonomous loop depends on — the second `createTestGamesApp` would have to re-bootstrap the chain, doubling test time. Adopted a smaller surgical cleanup per scenario: `clearPlayerBetState(em, playerId)` deletes only this player's bets + saga rows, leaving the round loop intact. Documented in decisions.

**[Rule 3 — Blocking issue] Double-cashout test accepts a third error code (ROUND_NOT_RUNNING)**

Plan listed `{ NO_ACTIVE_BET, BET_NOT_CASHABLE }` as acceptable codes. In practice the second cashout may arrive after the round has transitioned to CRASHED — in which case the controller throws `RoundNotRunningError` first (before reaching the bet lookup). All three codes indicate the correct rejection happened; the test accepts any of the three. No correctness compromise — a 200 OK would be the only unacceptable outcome.

No other deviations.

## Authentication Gates

None. The Keycloak password-grant flow is already wired via `_helpers/test-env.ts#fetchPlayerToken('player', 'player123')` from plan 04-10; no manual auth steps required.

## Threat Surface Check

No new threat surface introduced. The integration tests are non-production code that exercises endpoints already in the Phase 5 threat model (T-05-04-* for /games/bet, T-05-05-* for the handler, T-05-06-* for cashout). The tests do directly manipulate AMQP bindings (`amqplib.unbindQueue` / `bindQueue`) which is a privileged broker operation — this is acceptable in test scope because:

- Tests run against a local docker stack with admin RMQ credentials.
- `afterAll` restores the binding on best-effort to avoid leaving the broker in a broken state for subsequent test runs.
- Production never has this code path — the test file is gated by `INTEGRATION=1`.

## Known Stubs

None. All seven test files run real assertions against real saga state.

## Self-Check: PASSED

Verified on disk:

- FOUND: services/games/tests/integration/place-bet.test.ts
- FOUND: services/games/tests/integration/saga-insufficient-funds.test.ts
- FOUND: services/games/tests/integration/bet-outside-betting.test.ts
- FOUND: services/games/tests/integration/saga-timeout-and-compensation.test.ts
- FOUND: services/games/tests/integration/cash-out.test.ts
- FOUND: services/games/tests/integration/double-cashout.test.ts
- FOUND: services/games/tests/integration/kill-9-saga-recovery.test.ts
- FOUND commits: 0839228, fc34c22, 8926de9
- `bunx tsc --noEmit -p tsconfig.integration.json` returns clean (no output) — all 7 files type-check against the integration project.

## TDD Gate Compliance

This plan has `type: execute` in its frontmatter (not `type: tdd`) and the tasks themselves are not marked `tdd="true"`. Per execute-mvp-tdd.md, integration test files that only ADD test scaffolding (no production code changes) are exempt from the RED/GREEN/REFACTOR gate. The production code these tests exercise was already shipped in 05-04 / 05-05 / 05-06 / 05-07 / 05-08, each with their own RED/GREEN commits.
