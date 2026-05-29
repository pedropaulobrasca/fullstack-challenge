---
status: resolved
trigger: "WS gateway emits round:snapshot/started/tick but not round:running/crashed/settled — frontend frozen on BETTING. Deferred probe 43, actually a real backend bug."
created: 2026-05-29T18:53:00Z
updated: 2026-05-29T18:55:00Z
---

## Current Focus

reasoning_checkpoint:
  hypothesis: "The three round-transition repo methods rehydrate Round from raw SQL RETURNING * rows whose timestamptz columns MikroORM execute() returns as strings (not Date). RoundLoopService calls .toISOString() on startedAt/crashedAt/settledAt when building ROUND_RUNNING/CRASHED/SETTLED payloads, which throws before emit() runs, so those events never reach the lobby."
  confirming_evidence:
    - "Container log: 'TypeError: result.round.startedAt.toISOString is not a function. at transitionToRunning (round-loop.service.ts:184:42)' — fires every cycle right after the 'running' log line."
    - "Same TypeError for crashed.crashedAt and settled.settledAt; all three transitions affected; round:started (ORM-hydrated Date) is unaffected; ticks flow because multiplierBroadcast.start() runs on the line before the throwing emit."
  falsification_test: "After coercing the three raw timestamp columns to Date in mapDbRowToAggregate, the socket probe must observe >=1 each of running/crashed/settled and the TypeErrors must disappear from games logs."
  fix_rationale: "Root cause is that mapDbRowToAggregate trusts raw driver values as Date. Coercing string|Date|null -> Date|null at the repository boundary restores the aggregate invariant (date fields are Date), so .toISOString() succeeds and emit() runs."
  blind_spots: "mapRowToAggregate (ORM path) is assumed correct (round:started works), so I only touch the raw mapper. Not changing the emit sites — they are correct given Date inputs."
next_action: apply Date coercion helper in mikro-round.repository.ts mapDbRowToAggregate, rebuild games container, rerun 33s socket probe

## Symptoms

expected: clients in lobby receive round:running, round:crashed, round:settled in addition to snapshot/started/tick
actual: socket probe over 33s: snapshot=1, started=2, tick=453, running=0, crashed=0, settled=0
errors: |
  TypeError: result.round.startedAt.toISOString is not a function. at transitionToRunning (round-loop.service.ts:184:42)
  TypeError: (crashed.crashedAt ?? new Date).toISOString is not a function
  TypeError: (settled.settledAt ?? new Date).toISOString is not a function
  "round loop step failed; recovering in 1000ms" (the catch in scheduleAt)
reproduction: raw socket.io-client (websocket transport, player JWT in auth.token) to Kong :8000 path /ws, count events ~33s
started: always broken (deferred from Phase 6 as probe 43, misclassified as probe-design issue)

## Eliminated

- hypothesis: two GameWsGateway instances (one EventEmitter2 @OnEvent, one with @WebSocketServer)
  evidence: GameWsGateway provided exactly once (app.module.ts:94). round:started DOES reach lobby via @OnEvent on the same single instance, and ticks reach lobby via the same instance's server. The gateway is innocent.
  timestamp: 2026-05-29T18:54:00Z
- hypothesis: GAME_EVENTS emit names differ from @OnEvent names
  evidence: game-events.ts constants used identically on both emit and @OnEvent sides; round:started works proving the wiring is correct.
  timestamp: 2026-05-29T18:54:00Z

## Evidence

- timestamp: 2026-05-29T18:53:30Z
  checked: docker compose logs games
  found: "round X running (crashPoint=...)" logged, immediately followed by "round loop step failed" + TypeError: result.round.startedAt.toISOString is not a function at round-loop.service.ts:184:42. Same pattern for crashed/settled.
  implication: transitionToRunning runs (logs the running line, starts ticks at L181) but the emit payload construction at L182-185 throws BEFORE emit. So ROUND_RUNNING is never emitted. Throw bubbles to scheduleAt setTimeout catch.
- timestamp: 2026-05-29T18:54:30Z
  checked: mikro-round.repository.ts transitionFromBettingToRunning/RunningToCrashed/CrashedToSettled
  found: all three use em.getConnection().execute(... RETURNING *) raw SQL, mapped via mapDbRowToAggregate using row.started_at/crashed_at/settled_at directly into RoundProps.
  implication: raw driver rows are not hydrated by MikroORM; timestamptz comes back as string under Bun pg driver. startedAt is a string -> .toISOString() undefined.
- timestamp: 2026-05-29T18:54:45Z
  checked: findOpen/findById use em.findOne(RoundEntitySchema) -> mapRowToAggregate; startNewRound emits ROUND_STARTED from round.bettingEndsAt (ORM-created entity, real Date)
  found: ORM path produces real Dates; raw SQL path produces strings.
  implication: explains asymmetry — STARTED (ORM Date) works; RUNNING/CRASHED/SETTLED (raw SQL string) throw.

## Resolution

root_cause: The three round-transition repository methods return rounds rehydrated from raw SQL `RETURNING *` rows. Under Bun's pg driver these timestamptz columns deserialize as strings, not Date objects, so the rehydrated Round's startedAt/crashedAt/settledAt are strings. RoundLoopService builds the ROUND_RUNNING/CRASHED/SETTLED eventEmitter payloads by calling .toISOString() on those values, which throws TypeError before emit() is reached. The gateway @OnEvent handlers therefore never fire and clients never receive round:running/crashed/settled. (round:started works because its round is ORM-hydrated with a real Date; ticks flow because multiplierBroadcast.start() runs on the line before the throwing emit.)
fix: Added a toDate(value: Date|string|null): Date|null coercion helper to MikroRoundRepository and used it for betting_ends_at/started_at/crashed_at/settled_at/created_at in mapDbRowToAggregate (the raw-SQL RETURNING * mapper used by the three FSM transition methods). Widened RoundDbRow timestamp fields to Date|string|null to reflect that MikroORM execute() may return strings. This restores the Round aggregate invariant that date fields are real Date objects, so .toISOString() in the ROUND_RUNNING/CRASHED/SETTLED emit payloads succeeds and the events are emitted to the lobby.
verification: |
  Rebuilt games container. Post-fix games logs show clean running->crashed->settled cycles with zero "step failed"/TypeError lines.
  33s raw socket.io probe (player JWT via Kong :8000 /ws): {snapshot:1, started:1, running:1, tick:699, crashed:1, settled:1} — all three previously-missing events now >=1.
  Unit tests: 213 pass / 8 fail; the 8 failures are the known pre-existing clock-mock baseline (MultiplierBroadcastService 30Hz timing, RoundLoopService timer/bootstrap, GetWsSnapshotUseCase serverTime) — none touch the repository. No regression.
files_changed:
  - services/games/src/infrastructure/repositories/mikro-round.repository.ts
