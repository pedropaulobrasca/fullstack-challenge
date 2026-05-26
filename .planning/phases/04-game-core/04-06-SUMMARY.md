---
phase: 04-game-core
plan: 06
subsystem: games-application
tags: [autonomous-loop, lifecycle, on-application-bootstrap, recursive-set-timeout, kill-9-recovery, fsm-orchestration, provably-fair, adr-014, adr-015, adr-017]
dependency-graph:
  requires:
    - Plan 04-01 (@crash/contracts deriveCrashPoint + crashTimeMs + FORMULA_VERSION + GENESIS_CLIENT_SEED)
    - Plan 04-02 (Round aggregate + RoundRepository + SeedChainRepository)
    - Plan 04-03 (Bet aggregate + BetRepository tryTransition)
    - Plan 04-04 (MikroRoundRepository / MikroBetRepository / MikroSeedChainRepository — em.getTransactionContext atomic UPDATEs)
    - Plan 04-05 (SeedChainBootstrap + GameCoreModule skeleton)
  provides:
    - services/games/src/application/round-loop.service.ts (RoundLoopService — OnApplicationBootstrap + OnApplicationShutdown; recursive setTimeout; five-branch recoverInFlightRound)
    - services/games/src/application/use-cases/start-new-round.use-case.ts (StartNewRoundUseCase)
    - services/games/src/application/use-cases/transition-to-running.use-case.ts (TransitionToRunningUseCase — derives crashPoint without persisting it)
    - services/games/src/application/use-cases/crash-round.use-case.ts (CrashRoundUseCase — Bets-only sweep TX per ADR-014)
    - services/games/src/application/use-cases/settle-round.use-case.ts (SettleRoundUseCase — REQ-FAIR-02 seed reveal gate)
    - services/games/src/application/client-seed.derivation.ts (deriveClientSeed pure function per ADR-015)
  affects:
    - services/games/src/application/game-core.module.ts (five new providers — RoundLoopService not exported)
    - Plan 05-* saga consumers will read the loop-published round state via the same repositories
    - Plan 06-* WebSocket gateway will broadcast the loop's lifecycle transitions
tech-stack:
  added: []
  patterns:
    - "OnApplicationBootstrap + OnApplicationShutdown lifecycle (research Pitfall 1 — never OnModuleInit)"
    - "Recursive setTimeout via private scheduleAt(ms, fn) — drift-resilient and cleanly cancellable (ADR-017)"
    - "ReturnType<typeof setTimeout> timer typing for Bun/Node compatibility"
    - "Five-branch recoverInFlightRound state-machine reconstruction from persisted timestamps"
    - "1s error backoff at bootstrap and at every scheduled step so a transient DB failure never permanently kills the loop"
    - "crashPoint kept in-memory between transitionToRunning and crashRound — never persisted in RUNNING (rounds_fsm_check enforces crash_point_centi_x IS NULL when status=RUNNING)"
    - "CRASHED recovery re-runs the idempotent bet sweep via CrashRoundUseCase before settling (ADR-014 + research Pitfall 5)"
    - "Bets-only sweep via per-bet tryTransition — Round transition commits first, then bets sweep in their own micro-TXs"
key-files:
  created:
    - services/games/src/application/round-loop.service.ts
    - services/games/src/application/use-cases/start-new-round.use-case.ts
    - services/games/src/application/use-cases/transition-to-running.use-case.ts
    - services/games/src/application/use-cases/crash-round.use-case.ts
    - services/games/src/application/use-cases/settle-round.use-case.ts
    - services/games/src/application/client-seed.derivation.ts
    - services/games/tests/unit/round-loop.service.test.ts
  modified:
    - services/games/src/application/game-core.module.ts
decisions:
  - "TransitionToRunningUseCase passes only (roundId, startedAt) to the repository transition method — crashPoint is held in-memory by RoundLoopService and persisted in CRASHED via transitionFromRunningToCrashed. This matches the rounds_fsm_check 4-arm CHECK which requires crash_point_centi_x to be NULL during RUNNING."
  - "CrashRoundUseCase routes the bet sweep AFTER the Round=CRASHED transition commits. The sweep iterates ACTIVE bets via per-bet tryTransition(ACTIVE -> LOST). PENDING bets are NOT touched in Phase 4 — the Phase 5 saga's timeout path refunds them. This preserves the ADR-014 single-aggregate-per-TX invariant: Round commits first in its own TX, then each bet commits in its own micro-TX."
  - "CRASHED recovery branch in the round loop re-invokes CrashRoundUseCase with the persisted crashPoint BEFORE settling. The use case detects the already-CRASHED status and only runs the sweep (no double-transition attempt). This idempotently completes any bet sweep that was interrupted by kill -9 between Round=CRASHED commit and the per-bet UPDATE batch."
  - "Client seed derivation lives in client-seed.derivation.ts as a pure function (no DI, no class) — imported directly by StartNewRoundUseCase. Genesis seed = sha256(GENESIS_CLIENT_SEED); per-round seed = sha256(prevRound.id + ':' + prevRound.crashedAt.toISOString()) per ADR-015."
  - "RoundLoopService is registered as a GameCoreModule provider but intentionally NOT exported — it is an internal driver, not a callable surface. The four use cases are providers (so the loop can inject them via constructor) but only the read-side use cases (Get*/Verify*) remain exported."
  - "Test harness uses in-memory fakes for RoundRepository, BetRepository, and SeedChainRepository — same pattern that Plan 04-05's SeedChainBootstrap test established. No Postgres required for the recovery-branch coverage."
metrics:
  duration_seconds: 316
  task_count: 2
  files_created: 7
  files_modified: 1
  tests_added: 7
  tests_passing: "118 / 118"
  completed_at: "2026-05-26T21:30:42Z"
---

# Phase 04 Plan 06: Round Loop and Lifecycle Use Cases Summary

Ships the autonomous round loop: a NestJS `OnApplicationBootstrap`-driven service that walks every Round through BETTING -> RUNNING -> CRASHED -> SETTLED -> BETTING via a recursive `setTimeout`, with a five-branch recoverInFlightRound that rebuilds the in-memory timer schedule from persisted DB timestamps so a `kill -9` mid-round always resumes correctly on the next cold boot. Four use cases own the actual aggregate transitions; the loop is pure orchestration. Server seeds are read by TransitionToRunningUseCase to compute the crashPoint deterministically but are NOT written to `rounds.server_seed` until SettleRoundUseCase commits (REQ-FAIR-02 reveal gate). The crash path sweeps ACTIVE bets to LOST in a Bets-only TX after the Round transition commits — ADR-014's cross-aggregate boundary stays intact.

## What Landed

- **client-seed.derivation.ts** — pure `deriveClientSeed(prevRound | null)`. Genesis: `sha256(GENESIS_CLIENT_SEED)`. Per-round: `sha256(prevRound.id + ':' + prevRound.crashedAt.toISOString())` — the ADR-015 concatenation format encoded verbatim.
- **StartNewRoundUseCase** — finds the latest SETTLED round to derive the next nonce (`prev.nonce + 1n`, or `0n` for genesis) and the client seed. Reads the next pre-committed `seedHash` from `seed_chain` (throws if the chain is not bootstrapped). Generates a fresh `RoundId` via `randomUUID()`, schedules the round with `bettingEndsAt = now + BETTING_WINDOW_MS`, persists via `saveScheduled`.
- **TransitionToRunningUseCase** — fetches `serverSeed` from `seed_chain` (never exposes it), computes `crashPointValue = deriveCrashPoint({serverSeed, clientSeed, nonce, instantCrashBucket})`, computes `crashTimeMs(growthRate, crashPointValue)`, then persists ONLY the status transition (`transitionFromBettingToRunning(round.id, now)` — no crashPoint argument). The CrashPoint VO and the crashTimeMs are returned to the loop in-memory; they get persisted later when CrashRoundUseCase runs.
- **CrashRoundUseCase** — `transitionFromRunningToCrashed(round.id, crashPoint, now)` commits the Round in its own TX. AFTER that commit, sweeps ACTIVE bets to LOST via `findActiveByRound` + per-bet `tryTransition(bet.id, "ACTIVE", "LOST", {})`. Tolerates being called with an already-CRASHED round (idempotent for recovery): skips the Round transition and only runs the sweep. PENDING bets are deliberately not touched — Phase 5's saga timeout refunds them.
- **SettleRoundUseCase** — fetches `serverSeed` from `seed_chain` (throws if missing), persists via `transitionFromCrashedToSettled(round.id, serverSeed, now)` which is the ONLY path that writes `rounds.server_seed` (REQ-FAIR-02). Then calls `seedChain.revealSeedAtNonce(nonce, seed, now)` to stamp `revealed_at` on the chain row — idempotent via the repo's `WHERE seed IS NULL`-equivalent UPDATE semantics.
- **RoundLoopService** — `@Injectable` `implements OnApplicationBootstrap, OnApplicationShutdown`. Constructor injects the three repository tokens and the four use cases. Private `timer: ReturnType<typeof setTimeout> | null` plus a `running` flag. `scheduleAt(ms, fn)` is the only scheduling primitive — wraps `setTimeout` with the `running` guard, a `Math.max(0, ms)` clamp, and a `.catch` that logs and re-schedules with a 1s backoff so a transient DB blip cannot permanently stop the loop. `onApplicationBootstrap` wraps `recoverInFlightRound` in the same try/catch backoff. `onApplicationShutdown` logs the signal, clears the `running` flag, and `clearTimeout`s the pending handle.
- **GameCoreModule** — five new providers (`StartNewRoundUseCase`, `TransitionToRunningUseCase`, `CrashRoundUseCase`, `SettleRoundUseCase`, `RoundLoopService`). `RoundLoopService` is intentionally NOT exported.

## Recovery Branch Coverage Matrix

| Persisted status | Time-of-restart relative to FSM | Loop action | Use cases invoked |
|---|---|---|---|
| no open round | n/a | `startNewRound(new Date())` | StartNewRoundUseCase |
| BETTING | `bettingEndsAt > now` | `scheduleAt(remaining, transitionToRunning)` | TransitionToRunningUseCase (deferred) |
| BETTING | `bettingEndsAt <= now` | immediate `transitionToRunning(open)` | TransitionToRunningUseCase |
| RUNNING | `elapsed < crashTimeMs` (recomputed via deriveCrashPoint) | `scheduleAt(crashTimeMs - elapsed, crashRound)` | CrashRoundUseCase (deferred) |
| RUNNING | `elapsed >= crashTimeMs` | immediate `crashRound(open, recomputedCrashPoint)` | CrashRoundUseCase |
| CRASHED | bet sweep may be incomplete | re-invoke CrashRoundUseCase with persisted crashPoint (sweeps idempotently) then `settleRound` | CrashRoundUseCase + SettleRoundUseCase |
| SETTLED | round complete | `startNewRound(new Date())` | StartNewRoundUseCase |

Every recovery branch is covered by a dedicated unit test in `tests/unit/round-loop.service.test.ts`.

## ADR-015 Client Seed Concatenation Format (Committed Verbatim)

```
genesis:        sha256(GENESIS_CLIENT_SEED)              where GENESIS_CLIENT_SEED = "genesis"
round N (N>=1): sha256(prevRound.id + ":" + prevRound.crashedAt.toISOString())
```

`prevRound` is the round at nonce N-1 (the most recently SETTLED round). `crashedAt` is the wall-clock instant the round transitioned RUNNING -> CRASHED. The toISOString format guarantees byte-identical output across Bun, Node, and the future browser verifier. The separator `:` is a single literal colon.

## 1s Backoff Error Path

Two locations wrap their work in try/catch with `scheduleAt(ERROR_BACKOFF_MS, fn)` on failure:

1. `onApplicationBootstrap` — wraps `recoverInFlightRound`. A transient connection error at boot logs and re-schedules the recovery 1s later. Once the catch resolves, NestJS treats the bootstrap as complete (the loop continues asynchronously).
2. `scheduleAt` — wraps every `fn()` invocation. If a state-transition step throws (DB blip, lock timeout, optimistic concurrency loss), the loop logs `round loop step failed; retrying in 1000ms` and re-schedules the same `fn` with the backoff delay. No exponential growth, no max-retry counter — the simplest fix that satisfies the threat model (T-04-06-03).

The backoff intentionally does NOT skip a step or move to the next state — if `crashRound` fails, the loop retries `crashRound`. Skipping would risk an FSM jump that the rounds_fsm_check would reject anyway.

## Verification

| Check | Outcome |
|---|---|
| `bunx tsc --noEmit` from services/games | clean, exit 0 |
| `grep -c "OnApplicationBootstrap" services/games/src/application/round-loop.service.ts` | 2 (import + implements) |
| `grep -c "OnModuleInit" services/games/src/application/round-loop.service.ts` | 0 |
| `grep -c "setTimeout" services/games/src/application/round-loop.service.ts` | 2 (timer type + scheduleAt call) |
| `grep -c "clearTimeout" services/games/src/application/round-loop.service.ts` | 1 (shutdown) |
| `grep -cE '^\s*case "' services/games/src/application/round-loop.service.ts` | 4 (BETTING, RUNNING, CRASHED, SETTLED) + `open === null` no-open guard = 5 recovery branches |
| RoundLoopService in GameCoreModule providers | yes |
| RoundLoopService in GameCoreModule exports | no (internal driver) |
| `bun test tests/unit` from services/games | 118 / 118 pass, 310 expect() |
| `bun test tests/unit/round-loop.service.test.ts` | 7 / 7 pass |

## Use Case Method Signatures

```typescript
deriveClientSeed(prevRound: { id: RoundId; crashedAt: Date } | null): string

StartNewRoundUseCase.execute(now: Date): Promise<Round>

TransitionToRunningUseCase.execute(round: Round, now: Date): Promise<{
  round: Round;
  crashPoint: CrashPoint;
  crashTimeMs: number;
}>

CrashRoundUseCase.execute(round: Round, crashPoint: CrashPoint, now: Date): Promise<Round>

SettleRoundUseCase.execute(round: Round, now: Date): Promise<Round>

RoundLoopService.onApplicationBootstrap(): Promise<void>
RoundLoopService.onApplicationShutdown(signal?: string): Promise<void>
```

## Deviations from Plan

None of Rules 1, 2, 4. One Rule 3 self-correction during development:

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CRASHED recovery branch did not invoke the bet sweep**

- **Found during:** Task 2 unit test `crash sweep transitions ACTIVE bets to LOST in a single pass` (the test seeded a CRASHED round + an ACTIVE bet, ran the bootstrap, and asserted the bet flipped to LOST).
- **Issue:** The first revision of `recoverInFlightRound`'s CRASHED branch only called `settleRound(open)`. SettleRoundUseCase does not touch bets, so the ACTIVE bet stayed ACTIVE after recovery. Pitfall 5 explicitly requires the sweep to re-run idempotently on CRASHED recovery.
- **Fix:** The CRASHED branch now re-invokes `CrashRoundUseCase.execute(open, open.crashPoint!, now)` before `settleRound(reswept)`. CrashRoundUseCase already had an `if (round.status === "CRASHED")` short-circuit that skips the Round transition and only runs the bet sweep — so the recovery call is fully idempotent.
- **Files modified:** `services/games/src/application/round-loop.service.ts` (CRASHED case in recoverInFlightRound)
- **Commit:** `1ce4a2d` (same commit as the rest of Task 2 — the fix landed before any commit went out)

This is an example of TDD-style discovery during the test write: the test made an implicit Pitfall-5 expectation explicit, the gap surfaced immediately, and the fix was scoped to the single failing branch.

## Threat Model Compliance

| Threat ID | Disposition | Mitigation in this plan |
|---|---|---|
| T-04-06-01 (Tampering via setTimeout drift) | mitigate | `crashTimeMs` precomputed at transitionToRunning from the formula; drift is bounded by a single setTimeout call (not chained intervals). Phase 6 WS gateway will add a server-authoritative 30Hz multiplier broadcast for the client UI; the loop's own crash transition stays driven by the precomputed deadline. |
| T-04-06-02 (Info disclosure — server seed leak before settle) | mitigate | TransitionToRunningUseCase reads serverSeed from SEED_CHAIN_REPOSITORY internally to compute the crashPoint, but the seed is never returned from the use case or persisted to `rounds.server_seed`. SettleRoundUseCase is the only path that writes that column (REQ-FAIR-02). Verified by reading the use case source: only `transitionFromCrashedToSettled` accepts a `serverSeed` parameter. |
| T-04-06-03 (DoS — transient DB blip kills the loop) | mitigate | 1s backoff retry wrapped around `recoverInFlightRound` at bootstrap AND around every `scheduleAt` step. Errors are logged with stack but never bubble up to crash the process. |
| T-04-06-04 (Multi-instance double-tick) | accept | Research §Risk R1 — single-process per ADR-017; scale-out path via `pg_try_advisory_lock` leader election documented but not implemented in v1. |
| T-04-06-05 (Repudiation — kill -9 mid-transition) | mitigate | Five-branch recoverInFlightRound covers no-open, BETTING, RUNNING, CRASHED, SETTLED; CRASHED branch idempotently re-runs the bet sweep before settling; coverage matrix above maps each branch to a unit test. |

## Threat Flags

None. The loop reads only from already-modeled trust boundaries (Round repo, Bet repo, SeedChain repo) and emits no new network endpoints or auth paths.

## Known Stubs

None.

## Requirements Closed

- **REQ-GAME-01** — Autonomous round loop ships (BETTING -> RUNNING -> CRASHED -> SETTLED -> BETTING with no external trigger).
- **REQ-GAME-09** — `kill -9` recovery via every-status `recoverInFlightRound` branch with persisted-timestamp reconstruction.
- **REQ-FAIR-02** — Seed reveal gate: only `SettleRoundUseCase.execute` invokes `transitionFromCrashedToSettled`, which is the only repo path that writes `rounds.server_seed`.
- **REQ-FAIR-05** — `Round.schedule` exposes `seedHash` (set from `SEED_CHAIN_REPOSITORY.findHashByNonce(nextNonce)` in StartNewRoundUseCase) the moment the round enters BETTING, before any bet can be accepted.
- **REQ-DOM-01** — FSM enforced at three layers: aggregate (primary), `rounds_fsm_check` DB CHECK (defense-in-depth), and the use cases (which only call the corresponding `transitionFromXToY` repo method).

## ADR Compliance

- **ADR-014** (Bet as separate aggregate, single-aggregate TX) — CrashRoundUseCase commits the Round in its own TX via `transitionFromRunningToCrashed`, then sweeps bets in per-bet TXs via `tryTransition`. No code path mutates a Round and a Bet in the same TX. Verified by inspection of the use case bodies.
- **ADR-015** (Per-round client seed contribution) — `client-seed.derivation.ts` encodes the exact concatenation format and is the only producer of `clientSeed` for new rounds. Verified by source.
- **ADR-017** (In-process recursive `setTimeout` + `OnApplicationBootstrap`) — RoundLoopService uses both. `setInterval` is never imported. Verified by grep.

## Commits

| Task | Description | Hash |
|---|---|---|
| 1 | Lifecycle use cases (start/transition/crash/settle) + client seed derivation + GameCoreModule wiring | `319eed8` |
| 2 | RoundLoopService with five-branch recovery and seven unit tests | `1ce4a2d` |

## Self-Check: PASSED

- `services/games/src/application/round-loop.service.ts` — FOUND
- `services/games/src/application/use-cases/start-new-round.use-case.ts` — FOUND
- `services/games/src/application/use-cases/transition-to-running.use-case.ts` — FOUND
- `services/games/src/application/use-cases/crash-round.use-case.ts` — FOUND
- `services/games/src/application/use-cases/settle-round.use-case.ts` — FOUND
- `services/games/src/application/client-seed.derivation.ts` — FOUND
- `services/games/tests/unit/round-loop.service.test.ts` — FOUND
- `services/games/src/application/game-core.module.ts` — modified with five new providers (RoundLoopService NOT in exports)
- Commit `319eed8` — FOUND in git log
- Commit `1ce4a2d` — FOUND in git log
- `bunx tsc --noEmit` from services/games — clean
- 118/118 unit tests pass (7 new RoundLoopService tests)
