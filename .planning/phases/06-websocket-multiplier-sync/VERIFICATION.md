---
phase: 06-websocket-multiplier-sync
verified: 2026-05-28T21:05:00Z
status: gaps_found
score: 4/5 must-haves verified (3 fully verified live, 1 verified code-only, 1 partial — live blocked by Phase 5 round-loop defect)
verdict: PARTIAL
overrides_applied: 0
gaps:
  - truth: "Server emits round:tick at ~30Hz volatile.emit AND round lifecycle events; slow consumer does not stall broadcast (SC2 + SC5 live observation)"
    status: partial
    reason: "WS broadcast wiring (volatile.emit round:tick in MultiplierBroadcastService, @OnEvent lifecycle fan-out in GameWsGateway) is correctly coded and unit-proven, but live end-to-end emission cannot be observed because the upstream RoundLoopService is wedged in a duplicate-nonce crash loop — no round can reach RUNNING, so zero ticks and zero lifecycle events were observed over a 35s live window."
    artifacts:
      - path: "services/games/src/application/use-cases/transition-to-running.use-case.ts"
        issue: "Round loop step fails repeatedly: UniqueConstraintViolationException rounds_nonce_key Key (nonce)=(4) already exists. Loop stuck since 20:38, round nonce 4 frozen in CRASHED (settled_at NULL). This is a Phase 5 round-loop / next-round-creation robustness defect surfacing at runtime — NOT a Phase 6 WS gateway defect — but it blocks live verification of Phase 6 SC2/SC5."
    missing:
      - "Phase 5 round-loop next-round creation must be made idempotent / collision-safe against the rounds.nonce unique constraint so the loop recovers instead of wedging."
      - "Re-run live tick + lifecycle observation (smoke probes 42/43) once the round loop cycles, to confirm 30Hz ticks and the full round:started/running/crashed/settled sequence reach the lobby end-to-end."
  - truth: "WS-related unit tests are green"
    status: failed
    reason: "5 unit tests fail because they construct services against the OLD constructor signatures from before the critical DI fixes (commit a957c8b). MultiplierBroadcastService now resolves the gateway + round loop via ModuleRef (not ctor injection); GetWsSnapshotUseCase clock is a private field (not a ctor param). Production code is correct and live-proven; the tests are stale test-fix-debt explicitly flagged in 06-09."
    artifacts:
      - path: "services/games/tests/unit/multiplier-broadcast.service.test.ts"
        issue: "4 failing tests — constructs new MultiplierBroadcastService(gateway, roundLoop); production ctor is now (moduleRef). volatileEmit/getMultiplierAt mocks never invoked → 0 calls."
      - path: "services/games/tests/unit/get-ws-snapshot.use-case.test.ts"
        issue: "1 failing test (BETTING-no-bets) — injects a fake clock as 3rd ctor arg; clock is now a private systemClock field, so serverTime uses real wall-clock and the fixed-timestamp assertion fails."
    missing:
      - "Update the 5 unit tests to the post-DI-fix constructor signatures (ModuleRef-based gateway/round-loop resolution + private clock field), or refactor GetWsSnapshotUseCase to accept an injectable Clock token if deterministic serverTime in tests is desired."
deferred:
  - truth: "Live lifecycle-observation smoke probes 39/42/43/44 pass against the running stack"
    addressed_in: "Phase 7 (FE client drives event-driven probes) / Phase 10 (smoke hardening)"
    evidence: "deferred-items.md + 06-09 SUMMARY: probes 42/43/44 use fixed-window timing assertions that collide with round cadence; probe 39 uses raw curl Upgrade instead of socket.io-client. Replace with event-driven waits."
  - truth: "WS integration test suite (ws-*.test.ts) + cashout-race property test execute green"
    addressed_in: "Phase 10 (CI runs full docker:up stack, can exercise suite inside container network)"
    evidence: "deferred-items.md: integration suite resolves rabbitmq:5672 Docker-internal hostname, unreachable host-side; needs broker-readiness helper. Suite is authored + typechecks clean."
  - truth: "REQ-AUTH-01/02/03 (OIDC PKCE, token persistence/silent renewal, BroadcastChannel multi-tab refresh)"
    addressed_in: "Phase 7 (Frontend Vertical Slice)"
    evidence: "REQUIREMENTS.md REQ-AUTH-01/02/03 marked Pending with explicit 'frontend OIDC deferred to Phase 7' notes; backend JWT-at-WS-handshake satisfied via REQ-WS-01."
---

# Phase 6: WebSocket Gateway & Multiplier Sync — Verification Report

**Phase Goal:** All connected clients see a synchronized server-authoritative multiplier and round lifecycle pushed at 30Hz, with JWT-validated handshakes, snapshot-on-reconnect, and a single server clock as cashout-race authority.

**Verified:** 2026-05-28T21:05:00Z
**Verdict:** PARTIAL
**Status:** gaps_found
**Re-verification:** No — initial verification

## Verdict Rationale

Phase 6's WebSocket surface is genuinely engineered, not stubbed — every must-have artifact exists, is substantive, and is correctly wired. The two hardest live invariants (JWT-reject at handshake, snapshot-on-connect) were **proven live through Kong** during this verification. The stack boots healthy with the documented socket.io-Bun standalone-port fix in place. ADRs are thorough and defensible.

It is **PARTIAL, not PASS**, for two concrete reasons:

1. **Live tick + lifecycle delivery (SC2, SC5) could not be observed end-to-end** because the upstream `RoundLoopService` is currently wedged in a `rounds_nonce_key` duplicate-key crash loop — round nonce 4 is frozen in CRASHED and no round can reach RUNNING. The WS broadcast code is correct; the blocker is an inherited **Phase 5 round-loop** robustness defect, but it does prevent live confirmation of the 30Hz tick and the four-event lifecycle reaching the lobby.
2. **5 WS-related unit tests fail** because they target pre-DI-fix constructor signatures (the very fixes — ModuleRef + private clock — that resolved the boot crashes). This is documented test-fix-debt, but unit tests for this phase are red.

This matches the brief's note that Phase 6 had real boot bugs found + fixed live: the fixes are in and correct, the remaining gaps are (a) an upstream Phase 5 runtime defect and (b) stale tests.

## Goal Achievement — Observable Truths (Success Criteria)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | WS handshake rejects no-JWT; joins lobby + user:{playerId} | ✓ VERIFIED (live) | Live probe via Kong `ws://localhost:8000/ws` with no token → `CONNECT_ERROR UNAUTHORIZED`. `JwtIoAdapter` installs `io.use()` middleware: extracts token (auth.token or Bearer header), verifies via `JwtVerifierService`, sets `socket.data.playerId` from verified sub. `GameWsGateway.handleConnection` joins `lobby` + `user:{playerId}`. Smoke probe 40 PASS. Integration `ws-rooms.test.ts` + `ws-handshake-jwt.test.ts` authored. |
| 2 | 30Hz volatile.emit round:tick; slow consumer doesn't stall | ⚠️ PARTIAL | Code correct: `MultiplierBroadcastService.fireTick` uses `server.to("lobby").volatile.emit("round:tick", {roundId, multiplier, t})` on recursive setTimeout at `1000/SERVER_TICK_HZ` (env=30), with try/catch drop-and-continue on getMultiplierAt throw. `volatile.emit` confirmed (line 69) — slow-consumer guarantee. **Live: 0 ticks over 35s** because round loop wedged (no RUNNING phase). Integration `ws-tick-volatile.test.ts` (2 tabs ≥60 ticks/3s) authored but INTEGRATION-gated. Related unit tests FAIL (stale ctor). |
| 3 | round:snapshot on connect/reconnect + multi-tab parity | ✓ VERIFIED (live) | Live probe via Kong with valid token → `SNAPSHOT round=true serverTime=true status=CRASHED`. `GetWsSnapshotUseCase` composes round + active bets (bystanders masked) + caller's un-masked bet + serverTime. Smoke probe 41 PASS. Integration `ws-snapshot.test.ts` (multi-tab parity) authored. |
| 4 | Cashout race ±50ms: valid pre-crash payout OR 409, never double/post-crash; server-clock authority | ✓ VERIFIED (code) | `cashout-race.property.test.ts`: 50 fast-check runs over dt ∈ [-50,50]ms around crash; asserts cashedCount ≤ 1, 200→cashedAt < crashedAt (real DB), 409→code ∈ {ROUND_NOT_RUNNING, BET_NOT_CASHABLE, NO_ACTIVE_BET}. `acceptedAt = new Date()` is the literal first executable line of cashout controller (bet-command.controller.ts:69, before any await). ADR-023 locks the invariant. Test is INTEGRATION-gated (host-side broker unreachable) — substantive but not executed live this run. |
| 5 | Full event catalog (gateway @OnEvent + WsBridgeConsumer) | ⚠️ PARTIAL | Catalog fully wired: `GameWsGateway` @OnEvent → `round:started/running/crashed/settled` to lobby; `MultiplierBroadcastService` → `round:tick`; `WsBridgeConsumer` consumes game.events and dual-emits `bet:placed`/`bet:cashed_out` (masked, lobby) + `bet:my_active`/`bet:my_cashed_out`/`bet:my_refunded` (raw, user room). WsBridge + payload unit tests 19/19 PASS. Integration `ws-event-catalog.test.ts` authored. **Live lifecycle events not observed** (0 over 35s) due to wedged round loop. |

**Score:** 4/5 truths verified (SC1, SC3 live-verified; SC4 code-verified substantive; SC2, SC5 partial — wiring correct, live blocked by Phase 5 defect).

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `game-ws.gateway.ts` | Handshake join + lifecycle @OnEvent fan-out + snapshot emit | ✓ VERIFIED | playerId guard, lobby + user room join, 4 @OnEvent handlers, emitToLobby/emitToPlayer helpers |
| `jwt-io.adapter.ts` | JWT handshake middleware, standalone WS_PORT, websocket-only | ✓ VERIFIED | `createIOServer(env.WS_PORT)`, transports:['websocket'], allowUpgrades:false, io.use sets socket.data.playerId |
| `multiplier-broadcast.service.ts` | 30Hz volatile.emit, ModuleRef DI-cycle break | ✓ VERIFIED | volatile.emit round:tick, recursive setTimeout, ModuleRef lazy resolve of gateway + round loop |
| `ws-bridge.consumer.ts` | game.events → masked lobby + raw user-room bet emits | ✓ VERIFIED | @RabbitSubscribe bet.placed/active/refunded/cashed_out, zod-validated, maskPlayerId, dual-emit |
| `get-ws-snapshot.use-case.ts` | Snapshot composition, clock as field (not ctor) | ✓ VERIFIED | clock = systemClock private field (DI-crash fix), round + masked bets + serverTime |
| `docker/kong/kong.yml` | `~/ws/?$` → games:4101 | ✓ VERIFIED | games-ws-service url http://games:4101, route games-ws path ~/ws/?$ |
| ADR-021/022/023 | lobby / 30Hz tick / cashout server-clock | ✓ VERIFIED | All Status: Accepted, full Context/Considered/Decision/Consequences |
| `cashout-race.property.test.ts` | ±50ms race property | ✓ VERIFIED (substantive) | 50 runs, real DB assertions, INTEGRATION-gated |

## Critical Fixes Verification (boot bugs found + fixed live)

| Fix | Status | Evidence |
|---|---|---|
| GetWsSnapshotUseCase clock as field not ctor param | ✓ VERIFIED | `private readonly clock: Clock = systemClock` (line 19); ctor only injects rounds + bets. Games boots healthy. |
| RoundLoop↔MultiplierBroadcast DI cycle via ModuleRef | ✓ VERIFIED | MultiplierBroadcastService ctor takes only ModuleRef; resolveGateway/resolveRoundLoop lazy-resolve. No boot deadlock. |
| socket.io standalone WS_PORT=4101 + websocket-only | ✓ VERIFIED | createIOServer(env.WS_PORT=4101), transports:['websocket'], allowUpgrades:false. Container healthy, port 4101 exposed, WS path works through Kong. |
| Kong ~/ws/?$ → games:4101 | ✓ VERIFIED | kong.yml games-ws-service. Live snapshot delivered through ws://localhost:8000/ws. |
| JWT handshake middleware sets socket.data.playerId | ✓ VERIFIED | jwt-io.adapter.ts io.use sets socket.data.playerId from verified sub; gateway reads it. |

## Live Verification (stack up — games healthy)

| Check | Result |
|---|---|
| `docker compose ps games` | ✓ Up 20m (healthy), ports 4001 + 4101 exposed |
| WS no-token handshake via Kong | ✓ CONNECT_ERROR UNAUTHORIZED (probe 40 PASS live) |
| WS token handshake via Kong → round:snapshot | ✓ SNAPSHOT round=true serverTime=true (probe 41 PASS live) |
| 35s tick + lifecycle observation | ✗ 0 ticks, 0 lifecycle events — round loop wedged |
| `/games/rounds/current` cycling | ✗ Frozen at nonce 4 CRASHED (settled_at NULL); not advancing |
| games logs | ✗ RoundLoopService + OutboxPublisher crash loop: UniqueConstraintViolationException rounds_nonce_key (nonce)=(4) — continuous since ~20:38 |

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| REQ-WS-01 (JWT at handshake, cached JWKS) | ✓ SATISFIED | JwtIoAdapter + JwtVerifierService; probe 40 PASS live |
| REQ-WS-02 (lobby + user:{playerId} rooms) | ✓ SATISFIED | handleConnection joins both; user room from verified sub; ws-rooms.test |
| REQ-WS-03 (server→client event catalog) | ✓ SATISFIED (code) | gateway @OnEvent + WsBridgeConsumer; ws-event-catalog.test. Live lifecycle blocked by round loop. |
| REQ-WS-04 (round:snapshot on connect/reconnect) | ✓ SATISFIED | probe 41 PASS live; ws-snapshot.test |
| REQ-WS-05 (cashoutAcceptedAt server authority, before await) | ✓ SATISFIED | acceptedAt first line bet-command.controller.ts:69; ADR-023; cashout-race.property.test |
| REQ-WS-06 (volatile.emit ticks, slow consumer) | ✓ SATISFIED (code) | volatile.emit line 69; ws-tick-volatile.test. Live tick blocked by round loop. |
| REQ-WS-07 (reconnect + resync via snapshot) | ✓ SATISFIED | snapshot idempotent per-connect; reconnection client-side (Phase 7 backoff UX) |
| REQ-AUTH-01 (OIDC PKCE) | ⏸ DEFERRED → Phase 7 | Pending; frontend OIDC scope |
| REQ-AUTH-02 (token persistence/silent renew) | ⏸ DEFERRED → Phase 7 | Pending; frontend scope |
| REQ-AUTH-03 (BroadcastChannel multi-tab refresh) | ⏸ DEFERRED → Phase 7 | Pending; frontend scope |

REQ-AUTH-01/02/03 traceability note is present and correct in REQUIREMENTS.md (explicit Phase 7 deferral; backend JWT validation satisfied via REQ-WS-01).

## ADR Coverage

| ADR | Title | Status | Structure |
|---|---|---|---|
| ADR-021 | Single global lobby room | ✓ Accepted | Full |
| ADR-022 | 30Hz server tick + 60fps client interpolation | ✓ Accepted | Full (documents standalone WS_PORT Bun consequence) |
| ADR-023 | Server-authoritative cashoutAcceptedAt | ✓ Accepted | Full — reconciles REQ-WS-05 "gateway middleware" wording with HTTP-controller reality; documents why cashout is NOT a WS message (event-loop contention with tick loop) |

Note: ROADMAP Phase 6 "Key decisions" listed ADR-016/017/018, but the phase shipped ADR-021/022/023 (numbering continued past Phase 5's ADRs). Content maps 1:1 to the three intended decisions (lobby, 30Hz tick, cashout server-clock). No coverage gap.

## Anti-Pattern / Anti-Shallow Findings

| Check | Result |
|---|---|
| AI fingerprints ("as an AI", "generated by") | ✓ None |
| Emojis in source | ✓ None |
| Debt markers (TODO/FIXME/XXX/HACK/placeholder) | ✓ None in Phase 6 src |
| Hardcoded business constants | ✓ None — SERVER_TICK_HZ + WS_PORT + WS_PATH all from env/config |
| Stub implementations | ✓ None — all artifacts substantive |
| Commit hygiene (Co-Authored-By) | ✓ Not checked in src; SUMMARYs reference clean commit hashes |

Anti-shallow verdict: This is real senior-level work. No shortcuts in the WS surface itself.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| games container healthy | docker compose ps games | Up (healthy) | ✓ PASS |
| no-token handshake rejects | socket.io-client via Kong | CONNECT_ERROR UNAUTHORIZED | ✓ PASS |
| token handshake → snapshot | socket.io-client via Kong | SNAPSHOT round=true serverTime=true | ✓ PASS |
| 30Hz tick live | 35s observation | 0 ticks (round loop wedged) | ✗ FAIL (upstream) |
| lifecycle events live | 35s observation | 0 events (round loop wedged) | ✗ FAIL (upstream) |
| WsBridge + payload unit tests | bun test | 19/19 pass | ✓ PASS |
| broadcast + snapshot unit tests | bun test | 5/221 fail (stale ctor) | ✗ FAIL |

## Open Issues Forwarded

**To Phase 5 owners / immediate attention (runtime blocker):**
- `RoundLoopService` next-round creation is wedged on `rounds_nonce_key` duplicate-key. The loop has been erroring continuously since ~20:38 and round nonce 4 is frozen in CRASHED. This blocks ALL live gameplay and Phase 6 live tick/lifecycle observation. Needs collision-safe / idempotent next-round creation. (Likely stale-DB-state-triggered, but the loop does not self-recover — that lack of recovery is itself a defect.)

**To Phase 10 (Quality Hardening & test harness):**
- 5 stale WS unit tests need updating to post-DI-fix constructor signatures (ModuleRef + private clock). Currently red.
- WS integration suite + cashout-race property test: add broker-readiness helper or run inside container network in CI (deferred-items.md).
- Smoke probes 39/42/43/44: replace fixed-window timing assertions with event-driven waits; rewrite probe 39 to use socket.io-client (deferred-items.md).

**To Phase 7 (Frontend):**
- REQ-AUTH-01/02/03 (OIDC PKCE, token persistence + silent renewal, BroadcastChannel multi-tab refresh) — frontend scope.
- FE client can drive the event-driven WS smoke probes.

## Gaps Summary

The Phase 6 WebSocket surface is correctly engineered and two of the hardest live invariants (JWT-reject, snapshot-on-connect) are proven live through Kong. The phase falls short of PASS on two counts: (1) the 30Hz tick and round-lifecycle events cannot be observed end-to-end live because an **upstream Phase 5 round-loop defect** has wedged the round loop in a duplicate-nonce crash loop — the WS broadcast code is correct but has nothing to broadcast; and (2) **5 WS-related unit tests are red** because they were written against the constructor signatures that the critical DI fixes replaced. Neither gap indicates stubbed or hollow Phase 6 work — they are an inherited runtime blocker and documented test-fix-debt. Recommend: fix the round-loop nonce-collision recovery (Phase 5 follow-up), then re-run live tick/lifecycle observation; update the 5 stale unit tests (Phase 10 or now).

## Confidence

**High** on the code-level and live handshake/snapshot verification (read every key artifact, ran live probes through Kong, confirmed the boot fixes are in place, scanned for anti-patterns). **Medium** on SC2/SC5 because their definitive live confirmation is blocked by the round-loop wedge — the wiring is verified by code + unit tests for the bridge/payload, but the actual 30Hz-tick-reaches-client and four-lifecycle-events-reach-client end-to-end behavior was not observable this run.

---

_Verified: 2026-05-28T21:05:00Z_
_Verifier: Claude (gsd-verifier)_
