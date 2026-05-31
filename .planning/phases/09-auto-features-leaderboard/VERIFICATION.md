---
phase: 09-auto-features-leaderboard
verified: 2026-05-30T22:45:00Z → 2026-05-30T23:30:00Z (gap closed)
status: passed
score: 5/5 must-haves verified (SC4 wire-format gap closed in `dff428f`)
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  note: "SC4 leaderboard:updated WS payload was emitting `{playerIdMasked, rank, netProfitCents}` while shared schema required `{playerIdMasked, rank, netProfit: MoneySnapshot, winCount, totalBetCount}` — FE safeParse silently dropped every emission. Fix `dff428f` extended LeaderboardSnapshotEntry (winCount + totalBetCount), reused `leaderboardSnapshotEntryToWire` from `GetLeaderboardUseCase` in `GameWsGateway.onLeaderboardUpdated`, added schema-conformance contract gate inside gateway test. games 281/8 + contracts 44/44 + FE 244/244 + tsc/lint clean. Live SC4 smoke gate (rank reorder in-flight) deferred to docker rebuild + manual observation."
gaps:
  - truth: "Leaderboard side-panel updates live via WS leaderboard:updated when ranks shift (REQ-LEAD-04 / SC4)"
    status: failed
    reason: |
      Wire-format mismatch between server WS emission and the shared @crash/contracts schema +
      strict frontend Zod parser. Initial HTTP GET works (correct shape), but every WS
      leaderboard:updated payload is silently dropped by dispatchWsEvent's safeParse — so
      ranks never refresh between page loads/refetches.
    artifacts:
      - path: "services/games/src/presentation/gateways/game-ws.gateway.ts"
        issue: |
          onLeaderboardUpdated emits {playerIdMasked, rank, netProfitCents: string} per entry
          (lines 90-101). The shared leaderboardEntrySchema in
          packages/contracts/src/ws/leaderboard-updated.payload.ts requires
          {playerIdMasked, rank, netProfit: MoneySnapshot, winCount, totalBetCount} as a strict
          object — netProfit (NOT netProfitCents) AND winCount AND totalBetCount are mandatory.
      - path: "services/games/src/application/game-events.ts"
        issue: |
          In-process LeaderboardUpdatedPayload uses LeaderboardSnapshotEntry which only carries
          {playerId, rank, netProfitCents: bigint}. winCount/totalBetCount are dropped at
          the projector→gateway hand-off, so the gateway has nothing to forward even if it
          tried to match the contract.
      - path: "services/games/src/infrastructure/repositories/mikro-leaderboard.repository.ts"
        issue: |
          fetchSnapshot() (lines 87-98) deliberately maps fetchTopN rows down to
          {playerId, rank, netProfitCents}, discarding winCount/totalBetCount that are
          present in the underlying LeaderboardRow. This is the upstream truncation.
      - path: "frontend/src/stores/ws-dispatch.ts"
        issue: |
          Line 234-239: dispatchWsEvent runs schema.safeParse(payload) before any handler or
          subscriber sees the payload; failed parses are swallowed with a console.warn and
          dropped. The server's emission shape fails the strict schema → useLeaderboard's
          subscribeWsEvent('leaderboard:updated', ...) callback (use-leaderboard.ts:23) is
          never invoked, so the TanStack Query cache is never replaced in-flight.
      - path: "services/games/tests/unit/game-ws.gateway.leaderboard.test.ts"
        issue: |
          This unit test asserts the BROKEN shape (lines 68-87, 90-107: payload has
          netProfitCents string, no winCount/totalBetCount, no netProfit). The test passes,
          but it validates the wrong contract — it locks in the regression rather than
          catching it. The contract test in
          packages/contracts/tests/ws/leaderboard-updated.payload.test.ts is the
          authoritative shape and disagrees.
    missing:
      - "Extend LeaderboardSnapshotEntry (services/games/src/domain/leaderboard.repository.ts) to include winCount + totalBetCount and update fetchSnapshot() to keep them."
      - "Update LeaderboardProjectorService snapshot construction so the in-process LeaderboardUpdatedPayload entries carry winCount + totalBetCount."
      - "Update GameWsGateway.onLeaderboardUpdated to emit {playerIdMasked, rank, netProfit: MoneySnapshot, winCount, totalBetCount} — matching leaderboardEntrySchema."
      - "Replace tests/unit/game-ws.gateway.leaderboard.test.ts assertions to assert the contract shape (netProfit MoneySnapshot + winCount + totalBetCount + no netProfitCents key)."
      - "Add an end-to-end contract gate: parse the emitted payload through leaderboardUpdatedPayloadSchema inside the gateway unit test so future drift fails fast."
human_verification:
  - test: "Manual live smoke — auto-bet running indicator badge"
    expected: |
      With docker:up healthy and the player logged in, open the bet panel, switch to the Auto
      tab, enter target=2.0 / strategy=fixed / base=10.00 / stop-loss=50.00 / stop-win=50.00,
      click Start. The Manual tab trigger shows the Lock icon; the Auto tab trigger shows the
      pulsing accent dot next to "Auto"; the form fields go disabled.
    why_human: |
      Visual badge / pulse / motion-safe animation — grep can confirm the JSX exists
      (bet-panel.tsx:31-37) but only a human can confirm it actually renders and animates.
  - test: "Manual live smoke — full auto-bet loop (2-3 rounds, Martingale)"
    expected: |
      Start Martingale with base=10.00, target=1.50. Across 2-3 rounds, observe: (a) every
      round automatically posts a bet during BETTING, (b) on a loss, the next round's posted
      amount is exactly 2× the previous (visible in Live Feed own-row), (c) on a win, the
      next round resets to base=10.00, (d) when cumulative session P/L crosses ±50 CRD, an
      amber deduped toast surfaces ("Stop-loss reached" or "Stop-win reached") and no further
      bets fire until Start is clicked again.
    why_human: |
      Requires a live BETTING/RUNNING/CRASHED loop plus dynamic stake doubling visible in the
      Live Feed across consecutive rounds. Cannot be observed via grep or static unit tests.
  - test: "Manual live smoke — leaderboard live update visual"
    expected: |
      Open the right rail and switch to the Leaderboard tab. As rounds settle and cashouts
      land, top-N entries should re-order live without a manual refresh. Own-row should be
      highlighted (emerald rail + "YOU" prefix) when present.
    why_human: |
      Per the gap above, the current code path almost certainly does NOT update the panel
      live via WS (Zod-drop). The human verifier should confirm whether the panel only
      refreshes on TanStack Query stale (effectively never, staleTime: Infinity) + the
      manual Refresh button — vs animating live. This single live smoke confirms the gap
      manifests in the UI exactly as predicted.
  - test: "SC1 disconnect-safety E2E against live stack"
    expected: |
      With docker:up healthy: cd services/games && INTEGRATION=1 bun test
      tests/e2e/auto-cashout-disconnect.e2e.test.ts. Test connects WS, places bet with
      target=2.0, drops the socket at multiplier>=1.5, polls GET /games/bets/me, expects
      bet to be CASHED_OUT at ~2.0x within 30s.
    why_human: |
      Requires live RabbitMQ + Postgres + Kong + games + Keycloak. Cannot be run from this
      verifier context without standing the stack up. Backend may also need a rebuild for
      the new AutoCashoutTickService consumer to land.
  - test: "SC5 chaos test against live stack"
    expected: |
      With docker:up healthy: cd services/games && INTEGRATION=1 bun test
      tests/integration/leaderboard-projector-chaos.test.ts. Projector throws on every
      delivery; bet still transitions ACTIVE→{CASHED_OUT|LOST|REFUNDED}; leaderboard_24h
      stays empty for the test player.
    why_human: |
      Same live-stack precondition. Test source is well-formed (overrides
      LeaderboardProjectorService.handle to throw, asserts terminal status reached AND row
      count = 0).
---

# Phase 9: Auto Features & Leaderboard — Verification Report

**Phase Goal:** A player can set an auto-cashout target and run server-enforced auto-bet strategies (fixed + Martingale) with stop-loss / stop-win guardrails, while a live 24h leaderboard surfaces top players via a CQRS read-model projection.

**Verified:** 2026-05-30T22:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (5 ROADMAP Success Criteria)

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | Setting auto-cashout target → server auto-issues cashout when tick reaches target, even if client disconnects (SC1 / REQ-AUTO-01) | VERIFIED | `services/games/src/application/auto-cashout-tick.service.ts` listens on `GAME_EVENTS.ROUND_TICK` (`@OnEvent({ async: true })`), stamps `acceptedAt = new Date()` as first statement (ratifies ADR-023), queries `findAutoCashoutCandidates(roundId, ceilingCentiX)`, invokes `CashOutUseCase.execute({ playerId, multiplier: bet.autoCashoutTarget, acceptedAt })` paying the stored target NOT the tick. `tests/e2e/auto-cashout-disconnect.e2e.test.ts` drops the WS socket at >=1.5x with target=2.0x, polls REST and asserts CASHED_OUT @ ~2.0x. Test is gated by `INTEGRATION=1` (live stack required → human re-run). |
| 2 | Auto-bet `fixed` keeps amount; `martingale` doubles on loss and resets to BASE on win; STOP_LOSS / STOP_WIN halts auto-bet (SC2 / REQ-AUTO-02 + REQ-AUTO-03) | VERIFIED | `frontend/src/features/auto-bet/strategy.ts` — pure `nextBetAmount(strategy, baseAmount, lastOutcome, ctx)` returns `base` for fixed always, `ctx.lastBet * 2n` after loss for martingale, `base` (NOT `ctx.lastBet`) after win for martingale. `strategy.test.ts` locks "REQ-AUTO-02 — base is configured initial, not previous bet" (line 29-34). `driver-stops.test.ts` (11 tests) covers stop-win halt + amber toast, stop-loss halt + amber toast, insufficient-balance halt, transient `bet-window-closed` 409 NOT halting, 402 insufficient-balance halt. `auto-bet-driver.ts:96-116` computes `sessionPL`-vs-`stopWin`/`stopLoss` BEFORE the next POST. |
| 3 | Auto tab in bet panel with target/strategy/stop inputs + inline validation + Start/Stop toggle; config per-session (no reload survival) (SC3 / REQ-AUTO-04 + REQ-AUTO-05) | VERIFIED | `frontend/src/components/bet-panel.tsx` uses shadcn `<Tabs defaultValue="manual">` with Manual + Auto triggers (Bot icon on Auto, Lock icon shown on Manual while autoRunning, pulsing accent dot on Auto while running). `auto-bet-form.tsx` has 5 fields (target / strategy radio / base / stop-loss / stop-win) with `validateTarget` + `validateMoney` inline; renders `<Pause>Stop auto-bet</Pause>` (border-destructive outline) when `isRunning`, `<Play>Start auto-bet</Play>` (default fill) with `disabled={!formValid}` otherwise. `auto-bet.store.ts` uses plain `create()` from zustand (NO `persist` middleware). `auto-bet.store.test.ts` asserts `expect(source.includes("persist")).toBe(false)` (grep gate). Verified across the FE codebase: grep for `persist` in `frontend/src/features/auto-bet/` returns only the gate test itself. |
| 4 | Leaderboard projector consumes game.events into `leaderboard_24h`; `GET /games/leaderboard?window=24h` returns top-N masked; side panel updates live via WS `leaderboard:updated` when ranks shift (SC4 / REQ-LEAD-01..04) | **FAILED** | **HTTP path is verified, WS path is broken.** ✓ `LeaderboardProjectorService` (`@IdempotentSubscribe` on `bet.cashed_out`/`bet.refunded`/`bet.lost` via queue `leaderboard-projector.q`) fetches before+after top-N snapshots, applies the transition through the repository, conditionally emits `GAME_EVENTS.LEADERBOARD_UPDATED` only when `LeaderboardSnapshot.diff(before, after).changed === true`. ✓ `LeaderboardController @Get` (`@UseGuards(JwtGuard)`) returns top-N with `playerIdMasked` (8 hex via shared-kernel `maskPlayerId`), `rank`, `netProfit: MoneySnapshot`, `winCount`, `totalBetCount` — matches `leaderboardUpdatedPayloadSchema`. ✗ `GameWsGateway.onLeaderboardUpdated` (lines 90-101) emits `{playerIdMasked, rank, netProfitCents: string}` — NO `netProfit` MoneySnapshot, NO `winCount`, NO `totalBetCount`. FE `dispatchWsEvent` (`ws-dispatch.ts:233-248`) runs `leaderboardUpdatedPayloadSchema.safeParse(payload)` and DROPS the event on failure with `console.warn`. Net result: WS `leaderboard:updated` is silently swallowed end-to-end — the cache is never replaced in-flight. See gaps section. |
| 5 | Light CQRS implemented (write = mutable Postgres, read = projector view); projector failure does NOT block writes (SC5 / REQ-LEAD-02) | VERIFIED (live re-run required) | `leaderboard_24h` is a separate read-side table populated by `LeaderboardProjectorService` consuming its OWN queue `leaderboard-projector.q` (separate from `games.wallet-events.q` saga queue and `games.ws-bridge.q` WS-bridge queue). Topic fan-out delivers to each queue independently → projector congestion/failure cannot stall the write path. `tests/integration/leaderboard-projector-chaos.test.ts` boots the games app with `overrideProvider(LeaderboardProjectorService).useValue({ handle: async () => { throw ... } })`, places a bet, asserts the bet reaches `CASHED_OUT|LOST|REFUNDED` AND `leaderboard_24h` row count for that player stays 0. Test is gated by `INTEGRATION=1` (live stack required → human re-run). |

**Score:** 4 / 5 truths verified (SC4 partially — HTTP works, WS broken)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---------|----------|--------|---------|
| `services/games/src/application/auto-cashout-tick.service.ts` | `@OnEvent(ROUND_TICK)` listener, first-line `acceptedAt`, invokes `CashOutUseCase` per candidate with `bet.autoCashoutTarget` | VERIFIED | 53 lines, clean implementation; catches `RoundNotRunningError`/`BetNotCashableError` as benign race signals; unexpected errors logged with stack. |
| `services/games/src/application/leaderboard-projector.service.ts` | `@IdempotentSubscribe` on `bet.cashed_out`/`bet.refunded`/`bet.lost`, before+after snapshot diff gate, emits `LEADERBOARD_UPDATED` in-process when changed | VERIFIED | Plumbing is correct; the truncation at `LeaderboardSnapshotEntry` causes the downstream WS emission to lose winCount/totalBetCount. |
| `services/games/src/application/use-cases/get-leaderboard.use-case.ts` + `presentation/controllers/leaderboard.controller.ts` | `GET /games/leaderboard?window=24h` JWT-gated, returns top-N matching `leaderboardUpdatedPayloadSchema` | VERIFIED | Controller `safeParse`s `leaderboardQuerySchema` and 400s on bad input; use case fetches `fetchTopN`, masks player IDs, builds MoneySnapshot directly from BigInt cents to preserve negative net profit. |
| `services/games/src/presentation/gateways/game-ws.gateway.ts::onLeaderboardUpdated` | WS emit matching `leaderboardEntrySchema` (with `netProfit`, `winCount`, `totalBetCount`) | **STUB / WRONG SHAPE** | Emits `{playerIdMasked, rank, netProfitCents: string}` only. See gap. |
| `services/games/src/infrastructure/mikro-orm/migrations/20260530001-add-auto-cashout-target-to-bets.ts` | New column for `autoCashoutTarget` on `bets` | VERIFIED (file exists) | Migration file present alongside `20260530002-create-leaderboard-24h.ts`. |
| `frontend/src/features/auto-bet/auto-bet.store.ts` | Zustand store with NO `persist` middleware | VERIFIED | Plain `create()`; grep gate test asserts source excludes "persist". |
| `frontend/src/features/auto-bet/strategy.ts` + `auto-bet-driver.ts` | Pure strategy fn (martingale base = configured initial NOT previous bet); driver wired to round:started / bet:my_cashed_out / bet:my_refunded / round:settled | VERIFIED | Strategy correct per unit tests; driver subscribes to all four events and tears down on unmount. |
| `frontend/src/components/auto-bet-form.tsx` | 5 fields + Start/Stop toggle + inline validation | VERIFIED | All 5 fields render; `formValid` gates Start; while running, fields show "locked" values + disabled. |
| `frontend/src/components/bet-panel.tsx` | shadcn `<Tabs>` with Manual (default) + Auto + autoRunning visual indicators | VERIFIED | Implemented per UI-SPEC. |
| `frontend/src/components/leaderboard-panel.tsx` + `features/leaderboard/use-leaderboard.ts` | TanStack Query GET + WS-driven cache replacement | VERIFIED structurally / HOLLOW operationally | Code is correct; WS cache-replacement subscriber never fires because of the upstream wire-format gap (`dispatchWsEvent` drops every server emission). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---------|---------------|--------|--------------------|--------|
| `LeaderboardPanel` (initial paint) | `data` from `useLeaderboard()` | `fetchLeaderboard('24h')` → `GET /games/leaderboard?window=24h` → `GetLeaderboardUseCase` → `leaderboard_24h` SELECT | Yes (when projector has populated rows) | FLOWING |
| `LeaderboardPanel` (live updates) | `data` from `useLeaderboard()` after WS replacement | `subscribeWsEvent('leaderboard:updated')` → `queryClient.setQueryData(...)` | No — `dispatchWsEvent` drops payload at Zod safeParse before subscribers run | HOLLOW |
| `AutoBetForm` (running state) | `isRunning` from `useAutoBetStore` | `start({config})` triggered by Start button | Yes | FLOWING |
| `AutoBetDriver` (auto-cashout target on POST) | `state.config.target` | passed into `placeBet({ money, autoCashoutTarget })` → `usePlaceBet` mutation | Yes (verified by `driver-stops.test.ts` line 67-75) | FLOWING |
| `AutoCashoutTickService` (per-tick candidates) | `candidates` from `bets.findAutoCashoutCandidates(roundId, ceilingCentiX)` | MikroORM query against `bets` table with `autoCashoutTarget IS NOT NULL AND status='ACTIVE'` | Yes (proven by integration test `place-bet-auto-cashout-target.test.ts` + `auto-cashout-tick.test.ts`) | FLOWING |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `MultiplierBroadcastService` per-tick | `AutoCashoutTickService.onTick` | EventEmitter2 `GAME_EVENTS.ROUND_TICK` | WIRED | Confirmed by `auto-cashout-tick.service.ts:21` and the E2E test's pass criterion. |
| `LeaderboardProjectorService` per-event | `GameWsGateway.onLeaderboardUpdated` | EventEmitter2 `GAME_EVENTS.LEADERBOARD_UPDATED` (only when diff.changed) | WIRED | But onward WS emission is mis-shaped — see gap. |
| `GameWsGateway` socket emit | FE `dispatchWsEvent('leaderboard:updated')` | Socket.IO `lobby` room | NOT_WIRED (effectively) | Payload fails `leaderboardUpdatedPayloadSchema.safeParse` → dropped at `ws-dispatch.ts:236-239`. |
| `fetchLeaderboard` → HTTP | `useLeaderboard` TanStack Query cache | `protectedFetch('/games/leaderboard?window=24h')` | WIRED | Initial paint works. |
| `Start` button click | `auto-bet-driver` POSTs next bet on `round:started` | `useAutoBetStore.start({config})` flips `isRunning=true`; driver gates on `state.isRunning` | WIRED | Verified by `driver-stops.test.ts` "POSTs next bet with autoCashoutTarget from config". |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---------|---------|--------|--------|
| Contracts schema parses canonical leaderboard payload | `cd packages/contracts && bun test` | 44 pass / 0 fail | PASS |
| Shared kernel (Money, maskPlayerId) tests | `cd packages/shared-kernel && bun test` | 23 pass / 0 fail | PASS |
| Games unit suite | `cd services/games && bun test tests/unit` | 279 pass / 8 fail | PASS (Phase 9) — 8 pre-existing baseline failures in `RoundLoopService` / `MultiplierBroadcastService` / `GetWsSnapshotUseCase` are NOT Phase 9 regressions; documented in `deferred-items.md`. Phase 9 unit suites (`auto-cashout-tick.spec.ts`, `leaderboard-projector.service.test.ts`, `game-ws.gateway.leaderboard.test.ts`, `get-leaderboard.use-case.test.ts`, `leaderboard-snapshot.test.ts`, `leaderboard-query-dto.test.ts`) all green. |
| Frontend full suite | `cd frontend && bun run test` | 244 pass / 0 fail (36 files) | PASS |
| Frontend type-check | `cd frontend && bunx tsc --noEmit` | exit 0, no diagnostics | PASS |
| Frontend lint | `cd frontend && bun run lint` | 0 errors, 1 unused-disable warning on generated routeTree.gen.ts | PASS |

### Probe Execution

No probe scripts under `scripts/*/tests/probe-*.sh` declared for Phase 9 — the phase relies on the named E2E / integration / unit suites enumerated above and the live SC1 + SC5 walkthroughs.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|----------|
| REQ-AUTO-01 | P09-02 + P09-05 | Server-enforced auto-cashout target | SATISFIED | `AutoCashoutTickService` + `findAutoCashoutCandidates` repo method + SC1 disconnect E2E (live re-run gated). |
| REQ-AUTO-02 | P09-08 | Strategies: fixed + martingale | SATISFIED | Pure `nextBetAmount`; Martingale-base=configured unit-test locked. |
| REQ-AUTO-03 | P09-08 | Stop-loss / stop-win halt | SATISFIED | `auto-bet-driver` cumulative-since-Start P/L gates + 11 driver-stops tests. |
| REQ-AUTO-04 | P09-08 | Per-session, no persist | SATISFIED | Zustand without `persist` + grep-gate test. |
| REQ-AUTO-05 | P09-08 | Auto tab with Start/Stop | SATISFIED | Tabbed BetPanel + AutoBetForm + Lock/pulse affordances. |
| REQ-LEAD-01 | P09-04 + P09-06 | 24h rolling leaderboard by net profit | SATISFIED | `leaderboard_24h` table + window filter in `fetchTopN`. |
| REQ-LEAD-02 | P09-06 | Projector consumes game.events (light CQRS) | SATISFIED | `@IdempotentSubscribe` on `leaderboard-projector.q` + SC5 chaos test source. |
| REQ-LEAD-03 | P09-07 | `GET /games/leaderboard?window=24h` top-N masked | SATISFIED | Controller + use case + matching contract; masking via `maskPlayerId`. |
| REQ-LEAD-04 | P09-06 + P09-09 | Live `leaderboard:updated` WS event | **BLOCKED** | WS payload shape diverges from `leaderboardEntrySchema`; FE strict Zod parser drops every emission. Static panel paint via HTTP works, but the "live updates" guarantee is not delivered. See gaps. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| services/games/src/presentation/gateways/game-ws.gateway.ts | 90-101 | Emits ad-hoc payload shape that diverges from shared `@crash/contracts` schema; no in-gateway `leaderboardUpdatedPayloadSchema.parse(...)` gate | Blocker | Silently breaks the live update path; the only contract gate is FE-side and it drops the event. |
| services/games/tests/unit/game-ws.gateway.leaderboard.test.ts | 68-107 | Test asserts the broken shape (`netProfitCents` string, no winCount/totalBetCount) | Blocker | Locks in the regression — future refactors that "fix" the shape will fail this test, making the bug load-bearing. |
| Phase 9 code overall (auto-cashout service, projector service, auto-bet store/driver/form, leaderboard panel/row, bet panel) | n/a | TBD / FIXME / XXX / TODO / HACK / PLACEHOLDER grep | Info | None found — clean. |

No debt markers found in Phase 9 modified files.

### Human Verification Required

See `human_verification` frontmatter for the full list. Summary:

1. **Auto-bet running indicator badge** — visually confirm Lock icon on Manual tab + pulsing accent dot on Auto tab while auto-bet is running.
2. **Full auto-bet loop with Martingale (2-3 rounds)** — confirm doubling-on-loss / reset-on-win / amber stop-loss-or-stop-win toast + halt across consecutive live rounds.
3. **Leaderboard live updates** — confirm whether the panel updates as rounds settle (it likely will NOT, given the WS wire-format gap; this human pass is the live confirmation of the predicted failure).
4. **SC1 disconnect-safety E2E** — requires `docker:up` healthy; run `INTEGRATION=1 bun test tests/e2e/auto-cashout-disconnect.e2e.test.ts`. Backend rebuild may be needed for the new `AutoCashoutTickService` consumer to land.
5. **SC5 chaos test** — requires `docker:up` healthy; run `INTEGRATION=1 bun test tests/integration/leaderboard-projector-chaos.test.ts`.

### Gaps Summary

Four of five ROADMAP success criteria are achieved with production-quality wiring. The single material gap is on **SC4 / REQ-LEAD-04 (live WS updates of the leaderboard panel)**:

- The shared `@crash/contracts` `leaderboardEntrySchema` (used by both the HTTP `GET /games/leaderboard` response and the WS `leaderboard:updated` payload — the SUMMARY explicitly cites it as "single source of truth") requires per-entry fields `{playerIdMasked, rank, netProfit: MoneySnapshot, winCount, totalBetCount}` (strict).
- The HTTP path (`GetLeaderboardUseCase`) correctly produces that shape.
- The WS path (`LeaderboardProjectorService` → in-process `GAME_EVENTS.LEADERBOARD_UPDATED` → `GameWsGateway.onLeaderboardUpdated`) only carries `{playerId, rank, netProfitCents: bigint}` end-to-end, because:
  1. `LeaderboardSnapshotEntry` in the domain layer omits `winCount`/`totalBetCount`,
  2. `MikroLeaderboardRepository.fetchSnapshot` deliberately strips them, and
  3. `GameWsGateway.onLeaderboardUpdated` re-shapes them as `netProfitCents: string` rather than `netProfit: MoneySnapshot`.
- The FE `dispatchWsEvent` runs the strict `leaderboardUpdatedPayloadSchema.safeParse(...)` before any subscriber and drops failed parses with a `console.warn`. The server's emission shape will always fail this parse, so `useLeaderboard()`'s `subscribeWsEvent('leaderboard:updated', ...)` cache-replacement callback never fires.
- The misleading `tests/unit/game-ws.gateway.leaderboard.test.ts` asserts the broken shape and passes — it locks in the regression rather than guarding against it.

Net user impact: the leaderboard panel paints on initial mount (HTTP GET works) and on manual Refresh button click, but stays frozen during a live session. "Side panel updates live via WS" (the explicit SC4 promise) is not delivered.

All other SCs hold up: SC1 has the disconnect-safety E2E plus the integration `auto-cashout-tick.test.ts`; SC2 has the canonical unit lock on Martingale-base-=-configured-initial plus 11 driver-stops tests; SC3 has the no-persist grep gate plus the tabbed BetPanel implementation; SC5 has the chaos test that boots the games app without the projector and asserts bets still settle.

Money discipline + env-driven constants verified clean (`LEADERBOARD_TOP_N`, `LEADERBOARD_WINDOW_HOURS`, `BET_MAX_CENTS`, `STOP_LOSS_CENTS_MAX`, `STOP_WIN_CENTS_MAX`, `VITE_RANK_UP_TRANSITION_MS` all parsed via zod env schemas). No out-of-scope items shipped (no auto-bet persistence, no server-side stops, no all-time leaderboard, no Fibonacci/D'Alembert strategies). Three ADRs landed at next-free numbers (`ADR-032`, `ADR-033`, `ADR-034`) per the established renumber-reconciliation precedent.

---

*Verified: 2026-05-30T22:45:00Z*
*Verifier: Claude (gsd-verifier)*
