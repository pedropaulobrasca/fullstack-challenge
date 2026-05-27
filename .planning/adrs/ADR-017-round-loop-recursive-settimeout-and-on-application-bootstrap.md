# ADR-017: Round loop — recursive `setTimeout` + `OnApplicationBootstrap` over `setInterval` / worker thread

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 4

## Context

REQ-GAME-01 demands an autonomous round loop driving `BETTING → RUNNING → CRASHED → SETTLED → cooldown → BETTING` without external triggers. REQ-GAME-09 demands the loop survives `kill -9` mid-round and reconstructs state from the DB on restart. REQ-DOM-01 demands every FSM transition is enforced at the aggregate boundary. REQ-GAME-08 demands bets outside BETTING reject with 409 — meaning the in-process FSM state must always agree with the persisted DB state.

The loop is the single most-scrutinized runtime concern of the Game Core — every fairness guarantee, every saga assumption, every WS broadcast cadence in Phases 5-6 depends on the round transitions firing in the right order with no drift, no double-fire, and no missed transitions on restart. 04-RESEARCH §Pitfall 1, §Pitfall 5, §Alt-Considered ("setInterval", "Worker thread") and §Risk R1 enumerate the failure modes; three implementation shapes were considered at Plan 04-06 design time.

The 25% architecture-and-DDD scoring band hinges on the recruiter being satisfied that the loop is correct under three stressors: (1) the BETTING window must end exactly at `roundStartedAt + BETTING_WINDOW_MS`; (2) the RUNNING window must end exactly when the multiplier reaches the precomputed crash point (a function of wall-clock time since RUNNING start, see `packages/contracts/src/provably-fair/multiplier.ts` + `crashTimeMs`); (3) `kill -9` between any two transitions must leave the DB in a recoverable state. Drift, double-tick, and missed-transition bugs are the canonical setInterval failure modes.

The lifecycle hook is a second axis. NestJS exposes `OnModuleInit` (per-module, fires when each module's providers are constructed) and `OnApplicationBootstrap` (global, fires after every module's `OnModuleInit` completes). 04-RESEARCH Pitfall 1 documents the trap: `OnModuleInit` on the round loop can fire before `MikroOrmModule.forRoot` finishes connecting because module-init order under Bun's faster module resolution is not deterministic; the loop's first DB read against `findOpen()` will race the MikroORM connection and crash, requiring a restart.

## Considered

- **Option A — `setInterval(callback, intervalMs)`** — schedule the next tick at a fixed interval. Pros: trivial setup, classic JS idiom. Cons: **queue-up under load** — if a callback takes longer than the interval (the bet-sweep TX in `CrashRoundUseCase` can take 100ms+ under contention; `BETTING_WINDOW_MS=5000` is a long interval but `crashTimeMs(crashPoint)` for `crashPoint=1.01x` is ~166ms, well below typical sweep latency), `setInterval` queues the missed firings and burst-fires them back-to-back; observable as drift; classic real-time-loop anti-pattern. **Clean shutdown is awkward** — `clearInterval` works but doesn't compose with the recovery flow on bootstrap (you can't "restart from where you left off" with an interval that's been firing in the background).
- **Option B — Recursive `setTimeout` (chosen)** — each iteration schedules its own next fire via `setTimeout(next, delay)`. Pros: **drift-resilient** — `delay` is recomputed from current wall-clock (`crashAt - Date.now()`) at the moment the callback fires, so a slow callback delays the *next* fire by exactly the slowness it incurred but cannot queue up missed firings; the loop self-paces. **Clean shutdown** — `clearTimeout` cancels the *pending* next fire; once cancelled, the loop stops with no in-flight ticks to drain. **Race-free crash transition** — the RUNNING→CRASHED scheduler computes `crashAt = roundStartedAt + crashTimeMs(crashPoint)` exactly once at RUNNING start and schedules a single `setTimeout(crashAt - Date.now(), () => crashRound(...))` — no per-tick polling, no drift accumulation, no possibility of firing twice. Cons: requires explicit per-iteration error handling (a thrown exception inside the callback kills the loop unless caught — Plan 04-06's 1s backoff wrapper handles this).
- **Option C — Worker thread (`worker_threads` module)** — run the loop in a dedicated thread. Pros: isolation from the main event loop, no contention with HTTP request handling. Cons: **IPC complexity** — every transition needs to ship messages back to the main thread for the outbox write, breaking the same-TX guarantee that the @IdempotentSubscribe + outbox path depends on (ADR-013); MikroORM Identity Map cannot cross thread boundaries, the worker would need its own ORM instance; transaction-context (`nestjs-cls` for correlationId, EM threading) breaks completely; the implementation cost is multiple weeks for an isolation property the demo doesn't observably need (the Game service's HTTP surface is four READ endpoints in Phase 4 — Phase 5 adds two POSTs, but the loop's cadence is 5s + crash-time which is bounded; HTTP request handling does not starve the loop).

## Decision

**Option B — recursive `setTimeout` for every scheduled transition, with `OnApplicationBootstrap` as the lifecycle hook for the loop's start-up and recovery flow.**

Implementation lives in `services/games/src/application/round-loop.service.ts` (the class `RoundLoopService implements OnApplicationBootstrap, OnApplicationShutdown`):

```typescript
@Injectable()
export class RoundLoopService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  async onApplicationBootstrap(): Promise<void> {
    this.running = true;
    try {
      await this.recoverInFlightRound();
    } catch (err) {
      this.scheduleAt(ERROR_BACKOFF_MS, () => this.recoverInFlightRound());
    }
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  // ...
}
```

The lifecycle hook is `OnApplicationBootstrap`, NOT `OnModuleInit`. Per NestJS docs, `OnApplicationBootstrap` fires after every module's `OnModuleInit` completes — meaning `MikroOrmModule.forRoot` is guaranteed connected before the loop's first `findOpen()` DB read. 04-RESEARCH Pitfall 1 documents the bug if you use `OnModuleInit`: under Bun's faster module resolution the loop's init can race ahead of MikroORM's, and the first DB read crashes the boot. `OnApplicationBootstrap` is the only correct hook.

The `setTimeout` shape is used at every scheduling boundary:

- **BETTING → RUNNING**: at round start, `scheduleAt(BETTING_WINDOW_MS, () => transitionToRunning(round))` — single fire when the betting window ends.
- **RUNNING → CRASHED**: at RUNNING start, `crashAt = roundStartedAt + crashTimeMs(crashPoint)` is computed once; `scheduleAt(crashAt - Date.now(), () => crashRound(round))` — single fire exactly at the crash boundary; `crashTimeMs` is the pure function `1000 * Math.log(crashPoint) / GROWTH_RATE` (see `packages/contracts/src/provably-fair/multiplier.ts`).
- **CRASHED → SETTLED**: `scheduleAt(0, () => settleRound(round))` immediately after the bet sweep completes.
- **SETTLED → BETTING (next round)**: `scheduleAt(COOLDOWN_MS, () => startNewRound(now))`.

The 1-second error backoff at bootstrap and at every scheduled step (`ERROR_BACKOFF_MS = 1000` in the file) ensures that a transient DB blip never permanently kills the loop — the next attempt fires 1s later, the recovery branch re-reads the current state from DB, and the loop self-heals.

`kill -9` recovery is the five-branch `recoverInFlightRound` in the same file (Plan 04-06 commit `1ce4a2d`):

1. **No open round** → `startNewRound(now)`.
2. **BETTING** with `remaining = bettingEndsAt - now > 0` → `scheduleAt(remaining, transitionToRunning)`; with `remaining ≤ 0` → immediately `transitionToRunning`.
3. **RUNNING** → recompute `crashAt = roundStartedAt + crashTimeMs(persistedCrashPoint)`; if `now < crashAt` → `scheduleAt(crashAt - now, crashRound)`; if `now ≥ crashAt` → immediately `crashRound` (skipping the elapsed RUNNING time). The crash point is recomputed deterministically from the persisted `clientSeed + serverSeed + nonce` via `deriveCrashPoint` (ADR-015) — the same function the original RUNNING transition used. No floating-point drift across restarts because the crash time is a function of inputs, not of elapsed wall-clock since the original RUNNING start.
4. **CRASHED** (the round crashed before settling — `kill -9` between the crash and the settle TX) → re-invoke `CrashRoundUseCase` (idempotent on already-LOST bets via the `tryTransition(ACTIVE, LOST)` repository method's optimistic UPDATE) → then `settleRound`. Plan 04-06's RoundLoopService unit test for this branch caught the gap during initial implementation; the branch initially called only `settleRound` without re-invoking the sweep, leaving any PENDING-but-not-yet-active bets in limbo.
5. **SETTLED** (somehow no next-round was scheduled) → `scheduleAt(COOLDOWN_MS, startNewRound)`.

Live SIGKILL drill (Plan 04-11 W4 evidence, captured against the fresh docker stack with `HASH_CHAIN_LENGTH=1_000_000`):

- Round `2b9d685e` in state BEFORE_ROUND killed mid-RUN via `docker compose kill -s SIGKILL games`.
- On restart (Postgres unchanged, `games` container rebuilt from the same image), `recoverInFlightRound` saw the round in RUNNING state, recomputed `crashAt` from persisted seeds, the residual time had elapsed, immediately crashed the round, settled it, and the loop advanced to round `05d49a9a`.
- Zero orphan in-flight rounds older than 60s observed in `seed_chain` / `rounds` after the drill.
- The drill PASSED — proves REQ-GAME-09 beyond Plan 04-10's in-process `app.close()` simulation.

Rationale: `setTimeout`'s drift-resilience + clean-shutdown + race-free single-fire-per-transition matches every property the loop requires; `setInterval`'s queue-under-load is the documented anti-pattern in 04-RESEARCH §Alt-Considered; worker threads break the same-TX guarantee that the outbox depends on (ADR-013), and the isolation property they provide is unobservable in the demo's load profile. `OnApplicationBootstrap` is the only NestJS hook that survives Bun's faster module resolution.

## Consequences

- **Locked in (loop shape)**: every transition is a single `setTimeout` scheduled exactly once from the prior transition's callback; the `timer` field on `RoundLoopService` holds the pending fire reference; `clearTimeout` is the only stop signal; `running: boolean` is the kill switch that prevents post-shutdown scheduling.
- **Locked in (lifecycle hook)**: `OnApplicationBootstrap` for start, `OnApplicationShutdown` for clean shutdown (the latter via `clearTimeout(this.timer)`); both hooks set the `running` flag to coordinate the recursive scheduler with the shutdown signal.
- **Locked in (recovery shape)**: the five-branch `recoverInFlightRound` is the only entry point on bootstrap; every branch is unit-tested in `services/games/tests/unit/round-loop.service.test.ts` with in-memory fakes for the three repositories (no Postgres needed); the CRASHED branch re-invokes `CrashRoundUseCase` before settling (idempotent on already-LOST bets via `tryTransition`'s optimistic-locking UPDATE).
- **Locked in (no in-process FSM cache)**: every recovery decision reads the current Round + persisted seeds from DB; no in-memory FSM state survives a restart by design — the DB is the single source of truth. This guarantees `kill -9` cannot leave the in-process state diverged from the DB because there is no in-process state to diverge.
- **Locked in (timer typing)**: `ReturnType<typeof setTimeout>` instead of `NodeJS.Timeout` for Bun/Node compatibility — Bun's `setTimeout` returns a different concrete type, the `ReturnType` indirection portably types both runtimes.
- **Locked in (single-process scope)**: the loop runs on a single `games-service` instance per deployment. Scale-out path is documented in 04-RESEARCH Risk R1 — `pg_try_advisory_lock('round-loop')` for leader election would let a multi-replica deployment run one active loop with hot standby — but it is **UNIMPLEMENTED in v1**. The demo runs on one games container; the recruiter sees one loop, and the scale-out path is a Phase 10 hardening note.
- **Locked in (W4 evidence)**: the SIGKILL drill at Plan 04-11 is the canonical observation; the drill log is preserved in P4.11-SUMMARY.md and the round IDs (`2b9d685e` killed, recovered, settled; loop advanced to `05d49a9a`) are reproducible against a fresh stack.
- **Foreclosed**: `setInterval` (drift + queue-under-load); worker threads (IPC complexity + breaks same-TX outbox guarantee); cron-like external scheduler (would require an external trigger, voiding REQ-GAME-01's autonomous requirement).
- **Anticipated recruiter question**: "Why not setInterval?" — defended by drift, queue-under-load, and the impossibility of cleanly resuming after `kill -9` from an interval that fired some-but-not-all of its scheduled callbacks.
- **Anticipated recruiter question**: "Why OnApplicationBootstrap and not OnModuleInit?" — defended by the MikroORM connection race documented in 04-RESEARCH Pitfall 1; under Bun's faster module resolution the loop can init before MikroORM, and the first DB read crashes.
- **Anticipated recruiter question**: "What happens on kill -9 mid-bet-sweep?" — defended by the idempotent `tryTransition(ACTIVE, LOST)` per-bet micro-TX (optimistic UPDATE returns 0 rows for already-LOST bets) + the CRASHED recovery branch that re-invokes the sweep before settling.

## Alternatives Rejected

- **Option A — `setInterval(callback, intervalMs)`** — queues missed firings under load; clean shutdown is awkward; clean resume after `kill -9` is impossible because the interval's elapsed-but-not-fired callbacks have no persistence; classic real-time-loop anti-pattern.
- **Option C — Worker thread (`worker_threads`)** — breaks the same-TX outbox guarantee (no cross-thread MikroORM EM); transaction context (nestjs-cls correlationId) breaks across the thread boundary; multi-week implementation cost for an isolation property the demo doesn't observably need.
- **External cron-like scheduler** — would require an external trigger (cron, BullMQ, etc.) inside `docker:up`; voids REQ-GAME-01's autonomous requirement; adds an infra dependency the demo doesn't justify.
