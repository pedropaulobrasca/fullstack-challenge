---
phase: 04-game-core
plan: 02
subsystem: games-domain
tags: [domain, ddd, aggregate, fsm, fast-check, provably-fair]
requires:
  - "@crash/shared-kernel: DomainError, RoundId, Money"
provides:
  - "Round aggregate (services/games/src/domain/round.aggregate.ts) — schedule/rehydrate factories + start/crash/settle immutable behavior methods"
  - "RoundRepository interface (services/games/src/domain/round.repository.ts) — findById, findOpen, findServerSeedByNonce, listSettledHistory, saveScheduled, transitionFrom{Betting,Running,Crashed}To*"
  - "SeedChainRepository interface (services/games/src/domain/seed-chain.repository.ts) — countEntries, insertChain, findHashByNonce, findSeedByNonce, revealSeedAtNonce"
  - "isBettingOpen domain service (services/games/src/domain/round-betting-window.service.ts) — pure function for Phase 5 saga consumption"
  - "Multiplier VO (tenThousandths bigint scale), CrashPoint VO (centiX int scale), BetAmount guard (lazy env read)"
  - "RoundStatus + BetStatus union types + readonly arrays, isValidSeedHex helper"
  - "Domain errors: IllegalRoundTransition, IllegalBetTransition, BetAmountOutOfBounds, MultiplierOutOfBounds, CrashPointOutOfBounds, SeedNotYetRevealed"
affects:
  - services/games/package.json (added fast-check dev dep)
tech-stack:
  added:
    - "fast-check ^3.23.0 (devDep, services/games — monorepo aligned with shared-kernel/wallets)"
  patterns:
    - "Private constructor + static factories (schedule, rehydrate) mirroring Phase 3 Wallet aggregate"
    - "Immutable update via new Round({...this.props, patch}) — original instance never mutated"
    - "Lazy env-read for BetAmount.of() so test fixtures' setupGamesTestEnv() overrides flow through"
    - "Repository interfaces typed with txEm: unknown so MikroEntityManager passes without leaking into domain"
key-files:
  created:
    - services/games/tests/setup.ts
    - services/games/src/domain/value-objects/multiplier.ts
    - services/games/src/domain/value-objects/crash-point.ts
    - services/games/src/domain/value-objects/bet-amount.ts
    - services/games/src/domain/value-objects/round-status.ts
    - services/games/src/domain/value-objects/bet-status.ts
    - services/games/src/domain/value-objects/seed.ts
    - services/games/src/domain/value-objects/index.ts
    - services/games/src/domain/errors.ts
    - services/games/src/domain/round.aggregate.ts
    - services/games/src/domain/round.repository.ts
    - services/games/src/domain/seed-chain.repository.ts
    - services/games/src/domain/round-betting-window.service.ts
    - services/games/tests/unit/value-objects.test.ts
    - services/games/tests/unit/round.aggregate.test.ts
    - services/games/tests/unit/round-betting-window.test.ts
    - services/games/tests/property/round-fsm.property.test.ts
  modified:
    - services/games/package.json
    - .planning/phases/04-game-core/deferred-items.md
decisions:
  - "Round.settle invalid seed hex throws IllegalRoundTransitionError(CRASHED→SETTLED) rather than a separate InvalidSeedError. Keeps the FSM error class single-purpose; the failed transition stays observable from the same catch path saga code already uses."
  - "BetAmount returns Money (not a separate VO). Per Phase 1 ADR-002, Money already carries value semantics; BetAmount.of is a guard, not a new type — avoids two-type churn at every saga touchpoint."
  - "Property test numRuns=500 (well above plan minimum of 200) with maxLength=25 actions/run — yields ~7400 expect() assertions, deep coverage without slowing CI."
metrics:
  duration_minutes: 12
  task_count: 2
  files_created: 17
  files_modified: 2
  tests_added: 46
  tests_passing: "46 / 46"
  property_runs: 500
  expect_calls: 8135
  completed_at: "2026-05-25"
---

# Phase 04 Plan 02: Round Aggregate + FSM + Domain Surface — Summary

Pure-domain Round aggregate with private constructor, immutable FSM (BETTING → RUNNING → CRASHED → SETTLED), repository interfaces, isBettingOpen domain service, supporting value objects, and a fast-check property test proving no illegal state is reachable across 500 random command sequences — zero infrastructure imports.

## What Landed

- **Round aggregate** — `schedule()` creates a BETTING round with seedHash exposed and serverSeed null; `start()` BETTING→RUNNING; `crash(at, time)` RUNNING→CRASHED; `settle(serverSeed, now)` CRASHED→SETTLED. Every illegal source status throws `IllegalRoundTransitionError`. Every behavior method returns a new Round instance (immutable snapshot semantics). No `acceptBet` method, no `bets:` collection (ADR-014 enforced by absence; covered by an explicit test).
- **REQ-FAIR-02 reveal-after-settle** — `settle()` is the ONLY path that mutates `serverSeed`; property test asserts `serverSeed === null` for every BETTING / RUNNING / CRASHED state across all 500 random sequences.
- **REQ-FAIR-05 pre-round commitment** — `schedule()` accepts seedHash and exposes it via getter from the moment the round enters BETTING, before any bet can be accepted.
- **`isBettingOpen` domain service** — pure named function (not a class — no state, no DI). Used by Phase 5 saga to gate bet acceptance with `round.status === "BETTING" && round.bettingEndsAt > now`.
- **Value objects** — `Multiplier` (tenThousandths bigint, lossless ×multiplier math), `CrashPoint` (centiX int, fromCentiX rebuild), `BetAmount` (lazy env read at call time, returns Money unchanged on success per ADR-002). `Multiplier.of(0.99)` / `CrashPoint.of(0.5)` throw; NaN / Infinity guarded before bounds check.
- **Repository interfaces** — `RoundRepository` (with split atomic transition methods bound to a `txEm: unknown` so MikroEntityManager passes without leaking into the domain) and `SeedChainRepository`. Interfaces only — no class bodies. Bet aggregate's repository ships in parallel plan 04-03.
- **Shared test env bootstrap** — `tests/setup.ts` seeds every required env key with `??=` and is consumed by every test via `import { setupGamesTestEnv } from "../setup"; setupGamesTestEnv();` BEFORE other imports. Carries forward the Phase 3 P3.08 W6 lesson (single bootstrap avoids 35-error lint churn).

## Verification

| Check | Outcome |
|-------|---------|
| `bun test tests/unit/value-objects.test.ts` | 23 / 23 green, 36 expect() |
| `bun test tests/unit/round.aggregate.test.ts` | 17 / 17 green |
| `bun test tests/unit/round-betting-window.test.ts` | 6 / 6 green |
| `bun test tests/property/round-fsm.property.test.ts` | 2 / 2 green, **numRuns = 500**, ~7400 expect() |
| **Total in scope** | **46 / 46 passing, 8135 expect() calls** |
| `bunx tsc --noEmit` (services/games) | clean, exit 0 |
| `grep -rE "@nestjs\|@mikro-orm" services/games/src/domain/` | nothing |
| `grep -c -E "acceptBet\|bets:" round.aggregate.ts` (ADR-014 absence) | 0 |
| `grep -c "process.env" tests/setup.ts` | 23 (every required env key seeded) |

## Anti-Pattern Absence Tests

- `grep -rE "@nestjs\|@mikro-orm\|socket\\.io\|axios" services/games/src/domain/round.aggregate.ts services/games/src/domain/round.repository.ts services/games/src/domain/seed-chain.repository.ts services/games/src/domain/round-betting-window.service.ts` returns no matches — zero infra leak.
- `grep -c -E "acceptBet\|bets:" services/games/src/domain/round.aggregate.ts` returns `0` — Round does not own a Bet collection per ADR-014.

## Deviations from Plan

None. The plan executed exactly as written; no Rule 1-4 deviations were needed.

## Deferred Items

- `services/games/tests/unit/money-rounding-sanity.test.ts` — pre-existing failing test (Money.multiplyRounded API missing) belongs to plan 04-01 wave-0 scope (provably-fair + REQ-DOM-07 banker's rounding). Logged in `deferred-items.md` for the 04-01 executor.

## Requirements Closed

- REQ-DOM-01 — Round FSM enforced at aggregate boundary
- REQ-DOM-08 — Rich Round aggregate with behavior methods
- REQ-FAIR-02 — Server seed revealed only after settle
- REQ-FAIR-05 — Pre-round seedHash commitment exposed during BETTING
- REQ-GAME-08 — `isBettingOpen` domain-layer guard ships (saga wiring is Phase 5)
- REQ-TEST-01 — Round FSM unit tests
- REQ-TEST-02 — Round FSM property tests (fast-check, 500 runs)

## Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | Value objects, domain errors, shared test env setup | 302041e |
| 2 | Round aggregate + repos + isBettingOpen + tests | 922326e |

## Self-Check: PASSED

- `services/games/src/domain/round.aggregate.ts` — FOUND
- `services/games/src/domain/round.repository.ts` — FOUND
- `services/games/src/domain/seed-chain.repository.ts` — FOUND
- `services/games/src/domain/round-betting-window.service.ts` — FOUND
- `services/games/src/domain/errors.ts` — FOUND
- `services/games/src/domain/value-objects/*.ts` — FOUND (8 files including index.ts)
- `services/games/tests/setup.ts` — FOUND
- `services/games/tests/unit/value-objects.test.ts` — FOUND
- `services/games/tests/unit/round.aggregate.test.ts` — FOUND
- `services/games/tests/unit/round-betting-window.test.ts` — FOUND
- `services/games/tests/property/round-fsm.property.test.ts` — FOUND
- Commit 302041e — FOUND on main
- Commit 922326e — FOUND on main
