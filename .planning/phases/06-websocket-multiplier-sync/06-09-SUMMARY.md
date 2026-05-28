---
phase: 06-websocket-multiplier-sync
plan: 09
subsystem: observability
tags: [smoke-test, websocket, kong, integration]
status: blocked
requires:
  - 06-08 (WS integration + property tests)
  - 06-07 (Kong games-ws route)
  - 06-04 (GetWsSnapshotUseCase)
provides:
  - scripts/smoke-health.sh WS probes 39-44
affects:
  - scripts/smoke-health.sh
tech-stack:
  added: []
  patterns:
    - "socket.io-client bun -e one-liner for live WS probes via Kong"
key-files:
  created: []
  modified:
    - scripts/smoke-health.sh
decisions:
  - "WS probes 40-44 shell out to `cd services/games && bun -e` so socket.io-client resolves from the games workspace dependency tree"
  - "Probe 39 accepts games-origin 4xx/101 and only fails on Kong-origin 'no Route matched' 404, distinguishing route-forwarded from route-shadowed"
metrics:
  duration: ~3m
  completed: 2026-05-28
---

# Phase 6 Plan 09: Live Phase 6 WS Walkthrough Summary

Smoke probes 39-44 appended to `scripts/smoke-health.sh` exercising the live WS surface through Kong; the blocking live-walkthrough checkpoint is BLOCKED by a boot-time DI failure in `GetWsSnapshotUseCase` exposed by the mandatory games image rebuild.

## What Was Done

### Task 1 — Probes 39-44 (COMPLETE, committed 5460580)

Six probes appended to the existing 38-probe runner, wired into the run section, and tallied:

- **39** `probe_games_ws_kong_upgrade_route` — `curl -i` with `Connection: Upgrade` + `Upgrade: websocket` to `http://localhost:8000/ws`; passes on any games-origin status (101/200/400/401/426 or games-origin 404), fails only on Kong-origin `no Route matched`.
- **40** `probe_games_ws_handshake_denied` — socket.io-client without `auth.token`; expects `connect_error` with message `UNAUTHORIZED`.
- **41** `probe_games_ws_snapshot_on_connect` — connect with `WALLETS_TOKEN`; asserts `round:snapshot` within 5s carrying `round` + `serverTime` keys.
- **42** `probe_games_ws_tick_frequency` — after `wait_for_round_phase RUNNING`, counts `round:tick` over a 2s window; threshold `>= 30`.
- **43** `probe_games_ws_lifecycle_sequence` — presence-set of `round:started`/`round:running`/`round:crashed`/`round:settled` within 30s.
- **44** `probe_games_bet_ws_my_active` — after `wait_for_round_phase BETTING`, POSTs `/games/bet` via Kong from inside the connected socket and asserts `bet:my_active` arrives.

Verification: `bash -n scripts/smoke-health.sh` exits 0; `grep -c 'probe_games_ws\|probe_games_bet_ws'` returns 12 (>= 6 required).

### Task 2 — Live walkthrough checkpoint (BLOCKED)

Stack brought up with `bun run docker:up` (all healthy), then per the mandatory rebuild instruction:

```
docker compose build games          # succeeded
docker compose up -d --force-recreate --wait games   # games exited (1)
```

The freshly built games image fails to boot. All other services (postgres, rabbitmq, keycloak, kong, wallets) are healthy; only games is down, so no WS probe (39-44), integration test, or property test can run.

## BLOCKER — games boot-time DI failure (Rule 4: architectural / cross-plan)

**Container state:** `fullstack-challenge-games-1` → `exited (1)`, restarts=0.

**Root cause** (`services/games/src/application/use-cases/get-ws-snapshot.use-case.ts:17-23`):

```ts
@Injectable()
export class GetWsSnapshotUseCase {
  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    private readonly clock: Clock = systemClock,   // index [2]
  ) {}
}
```

Nest log:

> `Nest can't resolve dependencies of the GetWsSnapshotUseCase (ROUND_REPOSITORY, BET_REPOSITORY, ?). Please make sure that the argument at index [2] is available in the current module.`

`Clock` is a TypeScript interface, so `design:paramtypes` erases parameter [2] to `Object`. A constructor default value (`= systemClock`) does NOT stop Nest from attempting injection — Nest reads the reflected param type and tries to resolve a provider for it. There is no `Clock` provider registered anywhere (`grep` confirms none in `services/games/src`). `GetWsSnapshotUseCase` is registered as a bare class provider in `game-core.module.ts:56`, so the container crash-loops on boot.

**Why this surfaced now:** the previously-running games container was a stale image predating the WS gateway wiring. The mandatory rebuild (`docker compose build games`) put the current source into the container for the first time, exposing the latent DI bug. The smoke script and integration suites would have hit this the moment they ran.

**Why not auto-fixed:** the defect lives in plan 06-04's source, and this plan's scope is explicitly limited to `scripts/smoke-health.sh` + SUMMARY ("Touch ONLY scripts/smoke-health.sh + summary"). Choosing how `Clock` is supplied (drop the param, mark `@Optional()`, or register a `CLOCK` token provider) is an architectural decision for the owning plan, not a smoke-probe fix. Surfacing per Rule 4.

**Recommended fix (one of):**
1. `@Optional() @Inject(CLOCK)` plus a `{ provide: CLOCK, useValue: systemClock }` provider in `game-core.module.ts`, OR
2. Remove the constructor `clock` param and reference `systemClock` directly (simplest — no DI involvement), OR
3. `@Optional()` on the param so Nest tolerates the missing provider and the TS default applies.

Option 2 is the lowest-risk change and keeps the use-case pure. Until games boots, probes 39-44 and the 06-08 integration/property suites cannot be exercised against the live stack.

## Self-Check: PASSED

- `scripts/smoke-health.sh` — FOUND (modified, 6 new probes, `bash -n` clean)
- Commit `5460580` — FOUND (`test(06-09): add WS smoke probes 39-44`)
- Live verification deferred: games container down (documented blocker above)

## Deviations from Plan

None in implementation. Task 2 halted at the live walkthrough due to an external boot-blocking defect in `GetWsSnapshotUseCase` (plan 06-04), surfaced by the mandatory image rebuild. No code outside `scripts/smoke-health.sh` was modified.
