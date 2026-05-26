---
phase: 04-game-core
plan: 03
subsystem: game-core
tags: [bet-aggregate, fsm, money-rounding, banker-rounding, fast-check]
dependency-graph:
  requires:
    - shared-kernel/Money + branded IDs
    - Plan 04-02 outputs (Multiplier VO, BetStatus, errors.ts, BetAmount VO, tests/setup.ts)
  provides:
    - services/games/src/domain/bet.aggregate.ts (Bet aggregate FSM)
    - services/games/src/domain/bet.repository.ts (BetRepository interface)
    - packages/shared-kernel Money.multiplyRounded (banker's + half-up modes)
  affects:
    - Plan 04-04 (persistence — will implement BetRepository against Postgres)
    - Phase 5 saga (Bet.place + cashOut + refund consumers)
tech-stack:
  added:
    - dinero.js halfEven, halfUp, transformScale (already in v2.0.2 — newly imported)
  patterns:
    - Private-ctor aggregate with static factory methods + immutable behavior methods (Wallet precedent)
    - Money.multiplyRounded composes Dinero multiply + transformScale to currency exponent
key-files:
  created:
    - services/games/src/domain/bet.aggregate.ts
    - services/games/src/domain/bet.repository.ts
    - services/games/tests/unit/bet.aggregate.test.ts
    - services/games/tests/unit/bet-amount.value-object.test.ts
    - services/games/tests/unit/money-rounding-sanity.test.ts
    - services/games/tests/property/money-rounding.property.test.ts
  modified:
    - packages/shared-kernel/src/money/money.ts (added multiplyRounded + MoneyRoundingMode)
    - packages/shared-kernel/src/money/index.ts (exported MoneyRoundingMode)
decisions:
  - "Banker's path (b) taken: Dinero v2 multiply is precision-preserving (adds scales). Money.multiplyRounded composes multiply + transformScale(currencyExponent, halfEven) to land at cents granularity. REQ-DOM-07 satisfied; ADR-018 input recorded."
  - "Bet.cashOut uses multiplyRounded — Bet aggregate never invokes the unrounded multiply for payout math."
  - "factor.denominator MUST be a power of 10 — pre-existing constraint of the {numerator, denominator} contract carried over from Money.multiply; Bet.cashOut always uses 10_000n so this is non-issue at the aggregate boundary."
  - "Refund only reachable from PENDING (ADR-014 + research §Pitfall 4) — ACTIVE bets cannot be refunded, only cashed out or lost."
metrics:
  duration: 554s
  completed: 2026-05-26
---

# Phase 4 Plan 3: Bet Aggregate + Money Banker's Rounding Summary

Land the pure-domain Bet aggregate as a sibling-of-Round aggregate (ADR-014), the BetRepository interface, exhaustive FSM unit tests, BetAmount bounds tests, the Money-rounding sanity test, and the 10k-case fast-check property test for monetary rounding. Extended `packages/shared-kernel/src/money/money.ts` with `multiplyRounded` (banker's half-to-even + half-up) because Dinero v2's `multiply` is precision-preserving and never rounds to currency exponent.

## Path taken: (b) — extended Money with multiplyRounded

The sanity test resolves research Open Q1 definitively: **Dinero v2's `multiply` does NOT round.** It produces a Dinero object whose scale is `multiplicand.scale + multiplier.scale`. `toCents()` returns the raw amount at the higher scale, NOT cents. Example: `Money.of(100n).multiply({numerator: 1005n, denominator: 1000n}).toCents()` yields `100500n` at scale 5, not `100n` at scale 2.

This path was approved by W3 plan-check fix: the sanity test asserts banker's literals (NOT pinned observed Dinero behavior). With Dinero default ≠ banker's, the plan authorized extending `packages/shared-kernel/src/money/money.ts` with `multiplyRounded(factor, mode)` using `transformScale(product, currencyExponent, halfEven)`. `Bet.cashOut` now calls `multiplyRounded` instead of `multiply`. REQ-DOM-07 satisfied in Phase 4 (NOT deferred to ADR-018).

## What landed

- **`Bet` aggregate** (`bet.aggregate.ts`) — private ctor, static `place`/`rehydrate` factories, immutable behavior methods: `confirm()`, `cashOut(multiplier, time): {next, payout}`, `lose()`, `refund(reason)`. Mirrors `services/wallets/src/domain/wallet.aggregate.ts`. Zero infrastructure imports.
- **`BetRepository` interface** (`bet.repository.ts`) — `findById`, `findActiveByRoundAndPlayer`, `findActiveByRound`, `listByPlayer`, `save`, `tryTransition`. Type-only file; concrete MikroORM implementation lands in Plan 04-04.
- **`Money.multiplyRounded(factor, mode = "bankers")`** in `packages/shared-kernel/src/money/money.ts` — composes Dinero `multiply` with `transformScale(currencyExponent, halfEven|halfUp)`. Exposed via `MoneyRoundingMode` type from the shared-kernel barrel.
- **Tests**:
  - `money-rounding-sanity.test.ts` — 10 cases pinning banker's literals: 1.005, 1.015, 1.025, 1.035, 1.995, 0.5, 0.333, 2.331, mode-default and half-up cross-checks.
  - `bet-amount.value-object.test.ts` — 7 cases: default-env bounds (99 / 100 / 100000 / 100001), error metadata, and runtime env override at call time.
  - `bet.aggregate.test.ts` — 27 cases across every legal + illegal FSM transition and immutability/rehydrate.
  - `money-rounding.property.test.ts` — 2 properties × 10,000 fast-check runs = 20,000 randomized cases verifying payout equality and loss-free bigint inverse.

## Test counts and timing

| Suite | Cases | Duration |
|---|---|---|
| money-rounding-sanity | 10 | ~5ms |
| bet-amount.value-object | 7 | ~3ms |
| bet.aggregate | 27 | ~25ms |
| money-rounding.property (10k × 2) | 20,000 | ~111ms |
| **All Plan 04-03 suites combined** | **20,044** | **~113ms** |
| Full `bun test` games suite (incl. Plan 04-02 + 04-07) | 99 | ~320ms |

Property test ran 10,000 numRuns per property (per plan target, no scale-down needed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] money-rounding-sanity case `1n × 100n/3n` violates Money factor contract**

- **Found during:** Task 1
- **Issue:** The `{numerator, denominator}` factor contract requires `denominator` to be a power of 10 because the underlying Dinero call constructs a multiplier as `{amount: numerator, scale: bigintLog10(denominator)}`. `bigintLog10(3n)` returns 0, so `{100n, 3n}` becomes `{amount:100, scale:0}` = 100x, not 33.33x. The plan's behavior block listed `1n × 100n/3n → 0` but that violates the existing Money.multiply contract carried into multiplyRounded.
- **Fix:** Replaced the case with `1n × 333n/1000n → 0` (denominator 1000 = 10^3) which exercises the same "low-precision residual" intent (0.333 cents rounds to 0). Added a top-of-file contract note documenting the power-of-10 denominator constraint.
- **Files modified:** services/games/tests/unit/money-rounding-sanity.test.ts
- **Commit:** b13f8b8

**2. [Rule 1 — Bug] property-test inverse via Money.multiplyRounded would hit same contract limitation**

- **Found during:** Task 2
- **Issue:** The plan suggested `cashedOut.payout.divide({numerator: 10_000n, denominator: multiplier.tenThousandths})` to verify loss-free property. For random `multTenThousandths` values that are not powers of 10 (e.g., 12345), Money's factor contract would treat the divisor as 10^4, not 12345. The inverse property would silently pass for the wrong reason.
- **Fix:** Implemented `bankersDivide(numerator, denominator)` as a pure bigint helper inside the test file. Inverse property now computes `bankersDivide(payoutCents * 10_000n, multTenThousandths)` directly, asserting recovered cents are within 1 cent of original — true loss-free invariant at full bigint precision.
- **Files modified:** services/games/tests/property/money-rounding.property.test.ts
- **Commit:** e040803

### Architectural decisions (no Rule 4 stop needed)

Plan-check W3 fix authorized path (b) inline; ADR-018 is no longer conditional. Banker's rounding is now a shipped shared-kernel capability available to any future caller (cashout, leaderboard payouts, future commission features).

## Threat Model Compliance

| Threat ID | Disposition | Mitigation in this plan |
|---|---|---|
| T-04-03-01 (Cashout payout manipulation) | mitigate | `Bet.cashOut` derives payout from server-held `bet.amount × Multiplier.tenThousandths / 10_000` via banker's rounding. No client-supplied payout. |
| T-04-03-02 (Bet FSM bypass) | mitigate | Behavior methods are the only path to mutate state; `tryTransition` reserved for Plan 04-04 infrastructure-level optimistic locking. 27 unit tests + 20k property runs cover legal/illegal transitions. |
| T-04-03-03 (Cross-player data) | accept | Domain layer; query masking lives in Plan 04-08. |
| T-04-03-04 (Cashout dispute) | mitigate | `cashedOutAt` + `cashedOutMultiplier` stamped on the cashout transition; persistence ships in Plan 04-04. |

No new threat flags introduced.

## Known Stubs

None.

## Self-Check: PASSED

- services/games/src/domain/bet.aggregate.ts — FOUND
- services/games/src/domain/bet.repository.ts — FOUND
- services/games/tests/unit/bet.aggregate.test.ts — FOUND
- services/games/tests/unit/bet-amount.value-object.test.ts — FOUND
- services/games/tests/unit/money-rounding-sanity.test.ts — FOUND
- services/games/tests/property/money-rounding.property.test.ts — FOUND
- packages/shared-kernel/src/money/money.ts — multiplyRounded EXPORTED
- Commit b13f8b8 — FOUND in git log
- Commit e040803 — FOUND in git log
- `bunx tsc --noEmit` from services/games — clean
- 46/46 plan tests green; 99/99 full games suite green
- ADR-014 absence: `grep "round:" bet.aggregate.ts` → 0 hits (no nav property)
- Domain purity: no `@nestjs|@mikro-orm` imports in bet.aggregate.ts or bet.repository.ts
