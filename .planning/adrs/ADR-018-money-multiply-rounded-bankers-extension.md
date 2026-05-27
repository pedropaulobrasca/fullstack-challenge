# ADR-018: `Money.multiplyRounded` shared-kernel extension for banker's rounding cashout

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 4

## Context

REQ-DOM-07 demands cashout computed as `bet × multiplier` with a documented banker's-rounding policy (round-half-to-even) and asserts loss-free round-trips via property tests. The cashout math is the single hottest monetary computation in the system — every successful cashout in Phase 5's saga touches it, every payout figure displayed on the FE in Phases 7-9 derives from it, and the recruiter's arguição will probe both the rounding mode and the precision-preservation argument because 04-RESEARCH §Pitfalls C1 enumerates the canonical money bugs.

ADR-002 (Phase 1) locked Dinero.js v2 as the money library wrapped in a project-local `Money` value object (`packages/shared-kernel/src/money/money.ts`). Dinero v2's `multiply(multiplier)` API takes a `{amount, scale}` shape and is **precision-preserving**: it produces a Dinero object whose scale is the sum of multiplicand-and-multiplier scales, NEVER rounding to the currency exponent. `Money.of(100n).multiply({numerator: 1005n, denominator: 1000n}).toCents()` returns `100500n` at scale 5, not `100n` at scale 2 — the raw amount at the higher scale, exactly the way IEEE 754 has no business being involved.

Plan 04-03's `money-rounding-sanity.test.ts` was authored as W3 plan-check input: pin the rounding behavior with banker's literals (1.005 → 1.00, 1.015 → 1.02, 1.025 → 1.02 — round-half-to-even) and discover what Dinero's `multiply` actually does. The sanity test resolves research Open Q1 definitively: **Dinero v2 multiply does not round**; the call path `Money.multiply` returns the precision-preserved product. The Bet aggregate's `cashOut(multiplier, time)` method needs payout cents at scale 2 (the currency exponent) with banker's rounding applied. Two paths were on the table once the Dinero behavior was observed.

The Plan 04-03 plan-check W3 fix authorized one of two paths inline; the chosen path shipped the extension in Phase 4 rather than deferring to a follow-up ADR. The conditional-ADR-018 instruction in Plan 04-12's behavior block (the originally-planned "if Plan 04-03 observed truncate, author ADR-018") is no longer conditional — REQ-DOM-07 satisfied in Phase 4 by extending `Money` with `multiplyRounded`, and this ADR records the decision rationale + alternatives.

## Considered

- **Option A — Accept Dinero's default and document the deviation in REQUIREMENTS** — observe that Dinero v2's `multiply` is precision-preserving, document that REQ-DOM-07's "banker's rounding" is approximated by "round at presentation layer, not at aggregate computation", treat the aggregate's payout as the raw scale-5 (or whatever-scale) bigint, and only round when serializing for the FE / DB. Pros: no shared-kernel changes, smallest blast radius. Cons: every consumer of `Bet.cashOut` becomes responsible for rounding at its own boundary — the round-loop's settlement, the saga's wallet credit (Phase 5), the leaderboard's net-profit projector (Phase 9), the verify endpoint, the FE display. Each consumer is a place a bug can land. The aggregate is no longer the source of truth for the canonical payout value, which contradicts REQ-DOM-08 (rich aggregates). The property test in Plan 04-03 (`money-rounding.property.test.ts`, 10k fast-check cases) loses its target — there's no single function to property-test if rounding is consumer-determined. Recruiter arguição-indefensible at the 25% architecture-and-DDD band because the canonical "what is a cashout payout?" answer becomes "depends who you ask".
- **Option B — Extend `Money` with `multiplyRounded(factor, mode)` (chosen)** — add a new method to the shared-kernel `Money` VO that composes Dinero v2's `multiply` with `transformScale(product, currencyExponent, halfEven)` (or `halfUp` for the alternate mode), producing a Money at scale 2 with banker's rounding applied at the aggregate boundary. `Bet.cashOut` calls `multiplyRounded`, every downstream consumer reads the canonical payout from the aggregate. Pros: single canonical rounding location (the aggregate); the shared-kernel becomes the only place the rounding mode is named, which means a future "switch to round-half-up" is a one-line change at one site; the property test in Plan 04-03 has a clear target; `multiplyRounded` is reusable for any future monetary multiplication (leaderboard payouts, commission features, future bonus math). Cons: extends the shared-kernel surface (a `packages/shared-kernel` minor-version bump); the unrounded `Money.multiply` remains available, so a future caller could accidentally choose the wrong method — partial mitigation is the JSDoc on `multiply` warning against using it for cashout math.
- **Option C — Replace `Money.multiply` with the rounded variant** — make every `multiply` call round to currency exponent; remove the precision-preserving variant. Pros: impossible to choose the wrong method. Cons: voids legitimate use cases for the unrounded multiply (intermediate calculations in property tests, multi-step compound rate computations where rounding at each step accumulates error); also violates ADR-002's commitment to the Dinero v2 API surface — `multiply` keeps its documented semantics, the shared-kernel adds a method on top. Backward-incompatible without justifying need.

## Decision

**Option B — extend `Money` with `multiplyRounded(factor: MoneyMultiplier, mode: MoneyRoundingMode = "bankers"): Money`.**

Implementation lives in `packages/shared-kernel/src/money/money.ts`:

```typescript
import {
  // ...
  transformScale,
  // ...
} from "dinero.js";
import { halfEven, halfUp } from "@dinero.js/calculator-bigint";

export type MoneyRoundingMode = "bankers" | "half-up";

export class Money {
  // ...
  multiplyRounded(factor: MoneyMultiplier, mode: MoneyRoundingMode = "bankers"): Money {
    const product = multiply(this.dinero, {
      amount: factor.numerator,
      scale: bigintLog10(factor.denominator),
    });
    const currencyExponent = BigInt(this.currency.exponent);
    const divider = mode === "half-up" ? halfUp : halfEven;
    const reduced = transformScale(product, currencyExponent, divider);
    return Money.fromDinero(reduced);
  }
}
```

The composition is: Dinero `multiply` produces the precision-preserved product (scale = multiplicand.scale + multiplier.scale); `transformScale(product, currencyExponent, halfEven)` rounds the product down to the currency exponent (scale 2 for `CRD`) using IEEE 754 banker's rounding (round-half-to-even). The default mode is `"bankers"`; `"half-up"` is exposed for the rare consumer that needs the alternate rounding (e.g., a UI display preference); REQ-DOM-07's mandated mode is `"bankers"`.

`MoneyRoundingMode` is exported from the `packages/shared-kernel` barrel (`packages/shared-kernel/src/money/index.ts`) so consumers can type their preference; the type union is `"bankers" | "half-up"`, exhaustively switched in the method body so adding a future mode requires updating both the type and the divider selector.

Constraints carried over from `Money.multiply`:

- The `MoneyMultiplier` factor contract requires `denominator` to be a power of 10 because the underlying Dinero call constructs the multiplier as `{amount: numerator, scale: bigintLog10(denominator)}`; `bigintLog10` returns 0 for non-power-of-10 denominators, silently collapsing the multiplier. This is documented in the `MoneyMultiplier` JSDoc + asserted at the aggregate boundary: `Bet.cashOut` always uses `denominator = 10_000n` (the `Multiplier.tenThousandths` shape from `services/games/src/domain/value-objects/multiplier.ts`), so the constraint is non-issue at the aggregate-call site. Plan 04-03's W1 Rule-1 fix corrected the `money-rounding-sanity.test.ts` case `1n × 100n/3n` which violated this contract.
- For property-test inverse computations that need non-power-of-10 division (e.g., `bankersDivide(numerator, denominator)`), Plan 04-03 introduced a pure bigint helper inside the test file (`services/games/tests/property/money-rounding.property.test.ts`) — bypassing the Money contract for the inverse direction only.

Verification (Plan 04-03 commit + Plan 04-11 full suite):

- `money-rounding-sanity.test.ts` — 10 unit cases pinning banker's literals: 1.005 → 1.00, 1.015 → 1.02, 1.025 → 1.02, 1.035 → 1.04, 1.995 → 2.00, plus 0.5 / 0.333 / 2.331 boundary cases + a mode-default check + a half-up cross-check. All cases pass; banker's rounding observed byte-for-byte.
- `money-rounding.property.test.ts` — 2 properties × 10,000 fast-check runs = 20,000 cases asserting (a) `payout = bet × multiplier` produces the same cents for the same inputs, (b) `bankersDivide(payout × 10_000, multiplier × 10_000)` recovers the original bet within 1 cent (loss-free invariant at full bigint precision; the 1-cent tolerance accommodates the single banker's-rounding step in the forward direction).

The Bet aggregate boundary (`services/games/src/domain/bet.aggregate.ts`, ADR-014) is the canonical consumer: `Bet.cashOut(multiplier, time)` computes `payout = bet.amount.multiplyRounded({numerator: multiplier.tenThousandths, denominator: 10_000n}, "bankers")` — the aggregate never invokes the unrounded `multiply` for payout math. The unrounded `multiply` remains in the Money surface for any consumer that needs precision-preserving intermediate computation (e.g., a future leaderboard projector multiplying many payouts in sequence before a final rounding step).

Rationale: Dinero v2's precision-preserving `multiply` is the canonical Dinero contract per their docs and ADR-002's commitment — the shared-kernel must own the rounding step rather than every consumer reinventing it. The `multiplyRounded` extension is the smallest possible surface change (one method + one type) that makes the canonical cashout payout a property of the aggregate, not of the call site. Option A's "round at the boundary" defaults are observably the wrong default for a payment system — every consumer accidentally getting precision-preserved scale-5 values is a bug factory. Option C's removal of the unrounded variant is backward-incompatible without justifying need.

## Consequences

- **Locked in (shared-kernel surface)**: `Money.multiplyRounded(factor, mode)` is a public method on the Money VO; `MoneyRoundingMode` is exported from the barrel. Future modes (e.g., `"ceiling"`, `"floor"`) extend the type union and add a divider branch in the method body.
- **Locked in (default mode)**: `mode = "bankers"` is the default; consumers do not need to specify mode for the canonical REQ-DOM-07 case. The `"half-up"` alternate is exposed but not used by any aggregate as of Phase 4.
- **Locked in (aggregate as canonical consumer)**: `Bet.cashOut` calls `multiplyRounded`; the aggregate is the canonical source of truth for "what is a cashout payout?". Every downstream consumer (Phase 5 saga's wallet credit, Phase 7 FE display, Phase 9 leaderboard projector) reads the payout from the aggregate's persisted snapshot (`bets.payout_cents`), never recomputing.
- **Locked in (multiplier shape)**: `MoneyMultiplier = {numerator: bigint, denominator: bigint}` with `denominator` constrained to a power of 10; documented in JSDoc; Plan 04-03's `Multiplier.tenThousandths` value object always emits `denominator = 10_000n`, satisfying the contract at the aggregate-call site.
- **Locked in (property-test surface)**: the 20,000-case property test in Plan 04-03 pins the loss-free invariant; future shared-kernel changes to `multiplyRounded` must preserve property-test pass.
- **Locked in (Dinero contract preserved)**: ADR-002's `Money.multiply` remains precision-preserving; no breaking change to existing Money consumers (Wallet aggregate in Phase 3 doesn't use `multiply` for payout math, only `add`/`subtract`/`debit`/`credit` snapshot semantics — no impact).
- **Foreclosed**: Option A's "round at consumer boundary" defaults (would scatter rounding logic across every consumer); Option C's removal of the unrounded variant (backward-incompatible without justifying need).
- **Operational cost**: one extra `transformScale` call per cashout (~µs); negligible vs the round-trip cost of any other layer.
- **Anticipated recruiter question**: "Why is cashout rounding in the shared-kernel and not the Bet aggregate?" — defended by the reusability argument (the rounding step is a Money property, not a Bet property; future leaderboard / commission features need the same rounding) + the single-source-of-truth argument (one place to change the mode, one property test to assert correctness).
- **Anticipated recruiter question**: "Why banker's and not half-up?" — defended by IEEE 754 + REQ-DOM-07 spec; banker's avoids the systematic-bias-toward-large that half-up introduces over many round-trips (the property test's loss-free invariant fails for `half-up` over 10k random inputs because half-up accumulates a positive bias).
- **Anticipated recruiter question**: "What if `denominator` isn't a power of 10?" — defended by the `MoneyMultiplier` JSDoc + `bigintLog10` contract + `Multiplier.tenThousandths` aggregate-side enforcement; Plan 04-03's W1 Rule-1 fix is the canonical example of this trap being caught in test.

## Alternatives Rejected

- **Option A — Accept Dinero's precision-preserving default and round at consumer boundary** — every consumer becomes responsible for rounding; the aggregate stops being the source of truth for "what is a cashout payout?"; the property test loses its target; arguição-indefensible at the architecture / DDD scoring band.
- **Option C — Replace `Money.multiply` with the rounded variant** — voids legitimate precision-preserving intermediate computations; backward-incompatible with ADR-002's Dinero v2 contract surface; no justifying need.
