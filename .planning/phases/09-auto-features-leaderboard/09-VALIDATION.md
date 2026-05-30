---
phase: 9
slug: auto-features-leaderboard
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-30
approved: 2026-05-30
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Extracted verbatim from `09-RESEARCH.md` §"Validation Architecture" per `workflow.nyquist_validation = true` (`.planning/config.json`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test (`bun:test`) for backend unit/integration/e2e; Vitest + jsdom for frontend (Phase 7/8 pattern, confirmed live across 168/168 FE tests as of P08-08) |
| **Config file** | Backend: `services/games/tests/setup.ts` + per-suite `*.test.ts`; Frontend: `frontend/vitest.config.ts` (Phase 7 P07-03) |
| **Quick run command** | Backend: `cd services/games && bun test tests/unit && bun test tests/integration/auto-cashout-tick.test.ts`; Frontend: `cd frontend && bunx vitest run src/features/auto-bet src/features/leaderboard src/components/auto-bet-form.test.tsx` |
| **Full suite command** | Backend: `cd services/games && bun test`; Frontend: `cd frontend && bunx vitest run` |
| **Estimated runtime** | Quick ~30s · Full ~60s |

---

## Sampling Rate

- **After every task commit:** Run the unit suite for the touched layer (`bun test services/games/tests/unit` if backend touched; `bunx vitest run frontend/src/features/<feature>` if FE touched). <30s.
- **After every plan wave:** Run the integration suite for the touched layer (`bun test services/games/tests/integration` includes the new tests). <60s.
- **Before `/gsd:verify-work`:** Full suite green for both services + FE + the SC1 disconnect E2E against the live `bun run docker:up` stack.
- **Max feedback latency:** 60 seconds.

---

## Per-Requirement Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| REQ-AUTO-01 | Server cashes a disconnected client's bet at target | E2E (live docker) | `bun test services/games/tests/e2e/auto-cashout-disconnect.e2e.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-AUTO-01 | Tick handler stamps `acceptedAt` first; passes `autoCashoutTarget` to CashOutUseCase | unit | `bun test services/games/tests/unit/auto-cashout-tick.spec.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-AUTO-01 | DB query returns only ACTIVE bets where target ≤ ceiling | integration | `bun test services/games/tests/integration/auto-cashout-tick.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-AUTO-02 | `nextBetAmount` returns base on win, 2× last on loss (martingale); same base on fixed | unit | `bunx vitest run frontend/src/features/auto-bet/strategy.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-AUTO-03 | Driver halts on cumulative P/L ≤ -stopLoss or ≥ stopWin | unit | `bunx vitest run frontend/src/features/auto-bet/driver-stops.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-AUTO-04 | Auto-bet store has no `persist` middleware; state resets on remount | unit | `bunx vitest run frontend/src/features/auto-bet/auto-bet.store.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-AUTO-05 | BetPanel renders shadcn Tabs with Manual + Auto triggers; Auto form has 5 fields + Start/Stop | unit (RTL) | `bunx vitest run frontend/src/components/bet-panel.test.tsx` (extend existing) | ❌ Wave 0 | ⬜ pending |
| REQ-LEAD-01 | Leaderboard rows reflect 24h window; row > 24h does not appear | integration | `bun test services/games/tests/integration/leaderboard-projector.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-LEAD-02 | Projector idempotent on redelivery of same envelope | integration | (same file as above; specific test case) | ❌ Wave 0 | ⬜ pending |
| REQ-LEAD-02 | Projector crash does NOT block bet settlement (chaos) | integration / e2e | `bun test services/games/tests/integration/leaderboard-projector-chaos.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-LEAD-03 | GET /games/leaderboard returns ordered top-N with masked playerId + MoneySnapshot | integration | `bun test services/games/tests/integration/leaderboard-controller.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-LEAD-04 | `leaderboard:updated` emits only when top-N ranks change | unit + integration | `bun test services/games/tests/unit/leaderboard-snapshot.test.ts` + `leaderboard-projector.test.ts` | ❌ Wave 0 | ⬜ pending |
| REQ-LEAD-04 | FE `LeaderboardPanel` updates when `leaderboard:updated` arrives | unit (RTL) | `bunx vitest run frontend/src/components/leaderboard-panel.test.tsx` | ❌ Wave 0 | ⬜ pending |
| Race (optional, mirror P6.08) | Cashout-race ±50ms property test extended for auto-cashout target | property | `bun test services/games/tests/property/auto-cashout-race.property.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `services/games/tests/e2e/auto-cashout-disconnect.e2e.ts` — SC1 disconnect proof (connect socket, force-close, poll GET /games/bets/me)
- [ ] `services/games/tests/integration/auto-cashout-tick.test.ts` — auto-cashout dispatches on tick crossing target
- [ ] `services/games/tests/integration/leaderboard-projector.test.ts` — projection correctness + idempotency
- [ ] `services/games/tests/integration/leaderboard-projector-chaos.test.ts` — projector down ⇒ bets still settle (SC5)
- [ ] `services/games/tests/integration/leaderboard-controller.test.ts` — GET happy path + masking
- [ ] `services/games/tests/unit/auto-cashout-tick.spec.ts` — first-line acceptedAt + multiplier honors target
- [ ] `services/games/tests/unit/leaderboard-snapshot.test.ts` — top-N diff pure function
- [ ] `services/games/tests/property/auto-cashout-race.property.test.ts` — ±50ms race window (optional)
- [ ] `frontend/src/features/auto-bet/strategy.test.ts` — fixed + martingale + base-reset-on-win
- [ ] `frontend/src/features/auto-bet/driver-stops.test.ts` — stop-loss / stop-win / insufficient-balance halts
- [ ] `frontend/src/features/auto-bet/auto-bet.store.test.ts` — no persist, state ephemeral
- [ ] `frontend/src/components/leaderboard-panel.test.tsx` — render top-N + own-row highlight + rank-up transition
- [ ] `frontend/src/components/auto-bet-form.test.tsx` — RadioGroup + Start/Stop + disabled-while-running

Framework install: none needed (Bun test + Vitest both already in place).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SC1 disconnect E2E against live stack | REQ-AUTO-01 + ROADMAP Phase 9 SC1 | Requires `bun run docker:up` full stack (Postgres + RabbitMQ + Keycloak + Kong + games + wallets + frontend); the E2E script automates the disconnect but the live-stack precondition is a human-driven `docker:up` step | 1. `bun run docker:up` and wait for healthy. 2. `cd services/games && bun test tests/e2e/auto-cashout-disconnect.e2e.ts`. 3. Assert: bet ended in CASHED_OUT with multiplier ≥ target despite forced socket close. |
| SC5 chaos against live stack | REQ-LEAD-02 + ROADMAP Phase 9 SC5 | The automated integration version omits LeaderboardProjectorService from a NestJS test module (09-06 Task 3); the live-stack variant pauses the consumer via RabbitMQ management UI / `rabbitmqctl` and observes bets continue settling | 1. `bun run docker:up`. 2. Pause `leaderboard-projector.q` consumer (rabbitmqctl set_parameter / management UI). 3. Place a bet via the FE and let the round crash. 4. Assert: bet ends in CASHED_OUT/LOST; `leaderboard_24h` row count unchanged. 5. Re-enable consumer; queue drains; leaderboard catches up. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-30
