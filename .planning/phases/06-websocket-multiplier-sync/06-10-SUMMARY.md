---
phase: 06-websocket-multiplier-sync
plan: 10
subsystem: closeout-docs
tags: [adr, closeout, phase-6, websocket, lobby, tick, cashout-race]
dependency_graph:
  requires:
    - 06-09 (WS smoke probes 39-44 + live bring-up + socket.io Bun standalone-port fix)
    - 05-11 (Phase 5 closeout pattern as template)
    - 04-12 (Phase 4 closeout pattern as template)
  provides:
    - ADR-021 single global lobby room (locks the room topology for every WS event)
    - ADR-022 30Hz server tick + 60fps client interpolation (locks tick rate + standalone WS_PORT=4101)
    - ADR-023 server-authoritative cashoutAcceptedAt (codifies the controller-first-line invariant + REQ-WS-05 interpretation)
    - Phase 6 complete in every project artifact (ROADMAP, STATE, REQUIREMENTS, ADR catalogue)
  affects:
    - Phase 7 frontend consumes the WS event catalog these ADRs lock (lobby + user rooms, 30Hz tick, snapshot)
    - Phase 7 carries REQ-AUTH-01/02/03 (frontend OIDC) deferred from Phase 6
    - Phase 9 server-enforced auto-cashout (REQ-AUTO-01) reuses the ADR-022 30Hz tick loop + the ADR-023 server-clock primitive
tech_stack:
  added: []
  patterns:
    - documentation-only plan (no code changes; ADRs + project memory rotation)
key_files:
  created:
    - .planning/adrs/ADR-021-single-global-lobby-room.md
    - .planning/adrs/ADR-022-30hz-server-tick-60fps-client-interpolation.md
    - .planning/adrs/ADR-023-server-authoritative-cashout-accepted-at.md
    - .planning/phases/06-websocket-multiplier-sync/deferred-items.md
    - .planning/phases/06-websocket-multiplier-sync/06-10-SUMMARY.md
  modified:
    - .planning/adrs/README.md (Phase 6 section + Future ADRs rewound to ADR-024+)
    - .planning/STATE.md (Current Position + Performance Metrics + Todos + Blockers RESOLVED + Phase history + Recent activity)
    - .planning/ROADMAP.md (Phase 6 row [x] + Progress table 10/10 Complete + Plans landed narrative + 10 plan checkboxes)
    - .planning/REQUIREMENTS.md (7 WS REQ-IDs flipped to [x] + v1-complete 39→46 + Phase 6 traceability table with plan citations)
key_decisions:
  - "ADR-021: Single global lobby (Option B) — every socket joins lobby + user:{playerId} once, never changed; rejects per-round rooms (Option A — reshuffle churn every ~7-15s at single-round scale) and per-player-only (Option C — loses the named public broadcast surface)."
  - "ADR-022: 30Hz server tick + 60fps client interpolation (Option D) — volatile.emit on recursive setTimeout, client rAF interpolates e^(GROWTH_RATE*t/1000); rejects 60Hz (2× bandwidth no gain), per-frame (~600× bandwidth), 10Hz (too coarse for EWMA + cashout race). Standalone Socket.IO WS_PORT=4101 + websocket-only transport locked as the Bun http-attach fix consequence."
  - "ADR-023: Server-authoritative cashoutAcceptedAt at the HTTP controller first line (Option B, already Phase 5) — REQ-WS-05 'gateway middleware' = the NestJS controller layer; cashout NOT migrated to a WS message because a WS handler shares the event loop with the 30Hz tick broadcast, delaying the stamp and tightening the race; rejects WS inbound cashout + client-supplied timestamp."
metrics:
  duration_minutes: 20
  completed: 2026-05-28
  tasks_completed: 3
  files_changed: 9
  commits: 3
requirements:
  - REQ-WS-01
  - REQ-WS-02
  - REQ-WS-03
  - REQ-WS-04
  - REQ-WS-05
  - REQ-WS-06
  - REQ-WS-07
---

# Phase 6 Plan 10: Phase 6 Closeout — ADRs 021/022/023 + STATE/ROADMAP/REQUIREMENTS Rotation Summary

## One-liner

Documentation-only phase closeout — ADR-021 (single global `lobby` room over per-round rooms), ADR-022 (30Hz server tick + 60fps client interpolation, with the standalone `WS_PORT=4101` Bun http-attach fix as a locked consequence), and ADR-023 (server-authoritative `cashoutAcceptedAt` at the HTTP controller's first executable line) authored; ADR catalogue extended with a Phase 6 section; project memory rotated to Phase 6 complete (6/10 phases, v1-complete 39→46/95, ADRs landed 20→23).

## What landed

### ADR-021: Single global `lobby` room over per-round rooms

Every socket joins exactly `lobby` (public broadcast: round lifecycle + 30Hz tick + masked bet feed) + `user:{playerId}` (private `bet:my_*`), set once at `handleConnection` and never changed for the connection's lifetime. Per-round rooms (Option A) rejected because ADR-017's single-round-at-a-time invariant means they would force a full membership reshuffle every ~7-15s for zero scoping benefit and would race the snapshot-on-connect logic at the round boundary. Per-player-only (Option C) rejected because it loses the named public broadcast surface. The `user:{playerId}` room name is derived solely from the verified-JWT `sub` claim (T-06-07 mitigation — a client cannot join another player's private room). `WsBridgeConsumer` dual-emits each bet event masked to lobby + raw to `user:{playerId}` from a single `game.events` envelope.

### ADR-022: 30Hz server tick + 60fps client interpolation

`MultiplierBroadcastService` emits `round:tick` `{roundId, multiplier:number, t}` every 33ms via `server.to('lobby').volatile.emit(...)` on a recursive `setTimeout` loop pulling `RoundLoopService.getMultiplierAt(now)` (sole `volatile.emit` owner in the codebase). The client (Phase 7) renders at 60fps via rAF, computing the multiplier locally from `e^(GROWTH_RATE*t/1000)` anchored to `roundStartedAt` and reconciling toward each tick via EWMA clock-offset tween (never snap) — ~50% of 60Hz bandwidth with no smoothness loss, per the Gabriel Gambetta client-prediction canon. Rejects 60Hz server (2× bandwidth, illusory no-interpolation benefit), per-frame broadcast (~600× bandwidth, category error), 10Hz (too coarse for EWMA + coarser than the ±50ms cashout race window).

**Key consequence locked**: standalone Socket.IO server on `WS_PORT=4101` + websocket-only transport. P6.09 surfaced that engine.io's `attach()` calls `server.listeners("request")` unconditionally, but Bun's `@nestjs/platform-express` HTTP server lacks Node `EventEmitter.listeners()`, crash-looping the container with `server.listeners is not a function`. The fix (commit `c026012`) runs a dedicated-port Socket.IO server whose engine.io-owned `node:http` server DOES expose `.listeners()` on Bun, with `allowUpgrades: false`; Kong's `~/ws/?$` route proxies to `games:4101`. A Bun-runtime constraint, now load-bearing.

### ADR-023: Server-authoritative `cashoutAcceptedAt`

`const acceptedAt = new Date()` at the literal first executable line of `POST /games/bet/cashout` (`bet-command.controller.ts:69`, locked in Phase 5 P5.06) is the sole authority for cashout-vs-crash race resolution. REQ-WS-05's "gateway middleware" wording is interpreted as the NestJS HTTP controller layer — a controller IS the HTTP entry gateway into the application. Cashout was deliberately NOT migrated to a WS inbound message because a WS handler shares the event loop with the 30Hz tick broadcast loop (ADR-022), so the `acceptedAt` stamp would wait behind in-flight tick work and drift later under broadcast load — tightening the most race-sensitive operation. HTTP gives the clean `200`/`409` response surface ADR-020 locked. Rejects WS inbound `cashout` message + client-supplied timestamp ("never trust client time"). P6.08 `cashout-race.property.test.ts` covers the ±50ms window across 50 fast-check cases. Phase 9 server-enforced auto-cashout reuses the same server-clock primitive.

### ADR catalogue (`.planning/adrs/README.md`)

- Phase 6 section added with all three ADRs linked + one-line summaries, placed between the Phase 5 section and Conventions.
- "Future ADRs" list rewound from "ADR-021+" to "ADR-024+"; Phase 6 entry removed from the anticipated catalogue.

### STATE.md

- Current focus + Current Position updated: Phase 6 complete (6/10), progress bar `▰▰▰▰▰▰▱▱▱▱`, next action `/gsd:verify-phase 6` → `/gsd:secure-phase 6` → `/gsd:plan-phase 7`.
- Performance Metrics: Phases complete 5→6, v1 requirements complete 39→46 (+7 Phase 6 WS REQ-IDs), ADRs landed 20→23.
- Todos: marked plan-phase-6 done; added verify/secure/plan-phase-7 todos; logged Phase 7 carry-ins (REQ-AUTH-01/02/03 frontend OIDC + WS smoke-probe redesign).
- Blockers: the P6.09 games-container boot crash-loop marked RESOLVED with the triple-fix detail (Clock DI field-initializer + RoundLoop↔MultiplierBroadcast ModuleRef lazy resolution + socket.io standalone-port Bun fix).
- Phase history table: Phase 6 row filled with 10/10 + Complete + per-plan summary.
- Recent activity: P6.10 entry appended with the same forensic density as P5.11 (paragraph-length detail per ADR, plan citation per REQ-ID, P6.09 fixes documented as ADR consequences).

### ROADMAP.md

- Phase 6 row flipped `- [ ]` → `- [x]`.
- Progress table: Phase 6 row → 10/10 Complete 2026-05-28.
- Phase 6 details block: all 10 plan checkboxes flipped to `[x]`; "Plans landed" narrative added capturing each plan + the REQ-AUTH deferral note.

### REQUIREMENTS.md

| REQ-ID | Plan citation |
|--------|---------------|
| REQ-WS-01 | P6.01 JwtVerifierService extraction + P6.03 JwtIoAdapter io.use() handshake middleware; smoke probe 40 PASS |
| REQ-WS-02 | P6.03 handleConnection auto-joins lobby + user:{playerId}; ws-rooms.test.ts |
| REQ-WS-03 | P6.03 snapshot schemas + P6.05 lifecycle @OnEvent fan-out + P6.06 WsBridgeConsumer bet event bridging |
| REQ-WS-04 | P6.03 GetWsSnapshotUseCase + per-socket emit; smoke probe 41 PASS; ws-snapshot.test.ts |
| REQ-WS-05 | Phase 5 P5.06 bet-command.controller.ts:69 + codified in P6.10 ADR-023 + P6.08 ±50ms property test |
| REQ-WS-06 | P6.04 MultiplierBroadcastService volatile.emit + P6.08 ws-tick-volatile.test.ts |
| REQ-WS-07 | Socket.IO client default exponential backoff + P6.03 round:snapshot on reconnect; FE wiring Phase 7 |

REQ-AUTH-01/02/03 kept Pending — frontend OIDC (PKCE, silent renewal, BroadcastChannel multi-tab) deferred to Phase 7 per the Phase 6 RESEARCH Deferred Ideas; backend JWT-at-WS-handshake is done (REQ-WS-01; REQ-AUTH-04 was already done in Phase 3).

v1-complete count: **39 / 95 → 46 / 95** (+7). ADRs landed: **20 → 23** (+3). Phases complete: **5 → 6**.

### Phase 6 deferred-items.md created

Three items captured per the orchestrator's instruction:

1. socket.io Bun standalone-port workaround (`WS_PORT=4101` + websocket-only transport; engine.io `attach()` vs Bun express adapter `.listeners()`).
2. WS smoke probes 39/42/43/44 timing redesign (replace fixed-window assertions with event-driven waits; probe 39 should use socket.io-client not raw curl).
3. WS integration test suite broker-readiness (resolves Docker-internal `rabbitmq:5672`; needs in-network execution or a broker-readiness helper).

## Deviations from Plan

The plan's Task 3 described a single atomic commit of the seven Task-1 + Task-2 files. The orchestrator execution rules direct atomic commits per logical group (ADRs + closeout + SUMMARY), so the work landed as three commits — ADRs (`74cfa9e`), STATE/ROADMAP/REQUIREMENTS/README/deferred-items closeout (`54ba318`), and this SUMMARY (final) — rather than one. No content difference; the seven files plus the new deferred-items.md are all committed. The deferred-items.md is an additional file beyond the plan's seven-file frontmatter list, created per the orchestrator's explicit "Append to deferred-items.md (create if missing)" instruction. No Rule 1/2/4 deviations. No code changes — documentation only.

## Self-Check

### Files created

- `.planning/adrs/ADR-021-single-global-lobby-room.md` — FOUND
- `.planning/adrs/ADR-022-30hz-server-tick-60fps-client-interpolation.md` — FOUND
- `.planning/adrs/ADR-023-server-authoritative-cashout-accepted-at.md` — FOUND
- `.planning/phases/06-websocket-multiplier-sync/deferred-items.md` — FOUND

### Files modified

- `.planning/adrs/README.md` — FOUND (Phase 6 section + Future ADRs rewound; `grep -c "ADR-021" → 1`)
- `.planning/STATE.md` — FOUND (Phase 6 complete; progress bar `▰▰▰▰▰▰▱▱▱▱`; P6.10 recent activity entry present)
- `.planning/ROADMAP.md` — FOUND (`grep -E "^- \[x\] \*\*Phase 6" → 1`; progress table 10/10 Complete)
- `.planning/REQUIREMENTS.md` — FOUND (`grep -c "46 / 95" → 1`; all 7 WS REQ-IDs flipped to [x] with plan citations)

### Commits

- `74cfa9e` — FOUND (`docs(adrs): ADR-021 single global lobby + ADR-022 30Hz tick/60fps interpolation + ADR-023 server-authoritative cashoutAcceptedAt`)
- `54ba318` — FOUND (`docs(06-10): rotate STATE/ROADMAP/REQUIREMENTS to Phase 6 complete + ADR catalogue Phase 6 section`)

## Self-Check: PASSED
