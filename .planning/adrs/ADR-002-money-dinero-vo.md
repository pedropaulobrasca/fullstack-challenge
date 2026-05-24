# ADR-002: Money representation — Dinero.js v2 wrapped in local VO

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 1

## Context

REQ-DOM-03 mandates exact monetary precision with non-negative balances; REQ-DOM-06 forbids `number` for any monetary amount across backend, frontend, and wire format. PITFALLS C1 lists float arithmetic on money as an instant disqualifier in the rubric (and is the most common AI-submission failure mode). The challenge spans two services (games, wallets) and a frontend — the same monetary primitive must be isomorphic and serialize losslessly across the network.

Three candidate representations were evaluated: Dinero.js v2 (just-stable in March 2026 after ~5 years of alpha), raw `bigint` cents with a scale tag, and `decimal.js`. `currency.js` was eliminated immediately because it backs its internal representation with `Number × 100`, which loses precision on multi-step Martingale chains (REQ-BONUS-02).

The decision must also pick the JSON snapshot shape that flows over REST and WebSocket payloads. `bigint` does not serialize natively to JSON, so the snapshot must use `string` for the amount.

## Considered

- **Dinero.js v2 (stable, March 2026)** — Pure integer arithmetic via `bigint`. Immutable functional API; tree-shakable. Isomorphic (same library on backend and frontend). Currency descriptor with `{ code, base, exponent }`. Martin Fowler's Money pattern by name — recruiter-recognizable. Stable since March 2, 2026 ([Sarah Dayan announcement](https://www.sarahdayan.com/blog/dinerojs-v2-is-out)); v1 was deprecated.
- **Raw `bigint` cents + scale tag** — Maximum control. Forces hand-rolling formatting, parsing, rounding mode (banker's vs half-up), currency mismatch checks, ISO 4217 metadata, JSON serialization. Net cost over 5 days is severe; surface area for bugs is large.
- **`decimal.js`** — Arbitrary-precision general-purpose decimal arithmetic. No currency concept; would have to hand-roll currency, formatting, rounding policy. Used internally by Prisma but overkill for a single play-money currency.

## Decision

**Dinero.js v2 wrapped in a project-local `Money` value object** at `packages/shared-kernel/src/money/money.ts` (lands in P1.4).

The wrapper exposes only the operations the domain needs (`of`, `fromSnapshot`, `add`, `subtract`, `multiply`, `compareTo`, `isZero`, `equals`, `lessThan`, `greaterThan`, `toCents`, `toSnapshot`, `toJSON`, `toString`) and enforces project invariants in its constructor: non-negative invariant (throws `NegativeMoneyError`), currency mismatch (throws `CurrencyMismatchError`). Dinero is an implementation detail behind the VO — the domain never imports `dinero.js` directly. This matches STACK.md §2.2 and RESEARCH §Code Examples lines 514-591.

The snapshot JSON shape is locked at:

```
{ amount: string, currency: string, scale: number }
```

The `amount` field is a `string` (not `bigint`) for JSON-safety — `bigint` has no native JSON serialization. The string is decimal-encoded cents, parsed back via `BigInt(snap.amount)` at boundaries. This shape is the wire contract across REST, WebSocket, and Postgres `BIGINT` round-trips (per RESEARCH §4 Money VO sketch).

Rounding mode for `multiply` operations (cashout payout = bet × multiplier, REQ-GAME-04) is dinero's default banker's rounding for Phase 1. The formal lock of the rounding policy lives in Phase 4 ADR-011 alongside the cashout computation. Per SUMMARY.md §8: bigint cents was explicitly considered and rejected in favor of Dinero + VO to gain the isomorphic FE/BE story and the ISO currency table without sacrificing precision.

VO constructors **throw** on invalid construction (not `Result<T, E>`). Per RESEARCH §Error taxonomy and STACK PITFALLS C5: when invariants are inviolable, forcing callers to handle a `Result` two-path is a code smell in Vernon DDD canon. The error taxonomy in `packages/shared-kernel/src/errors/` exists for that path.

## Consequences

- **Locked in**: `Money` VO is the only sanctioned monetary path across the project. The ESLint money-guard rule (ADR-006) enforces "no `number` on money-named identifiers." Postgres columns store cents as `BIGINT` (or `NUMERIC(20,2)`) and round-trip through `Money.fromSnapshot`. Wire format `{ amount: string, currency, scale }` is contract across services and frontend.
- **Foreclosed**: direct usage of `dinero.js` outside the VO; `number` for money-like identifiers; ad-hoc cents arithmetic; rounding decisions at call sites.
- **Phase 1 ships**: the `Money` VO class, the `CRD` currency descriptor (`{ code: 'CRD', base: 10n, exponent: 2n }`), error subclasses (`NegativeMoneyError`, `CurrencyMismatchError`), and tests covering the non-negative invariant.
- **Deferred to Phase 4 ADR-011**: rounding-mode lock for `multiply` (cashout payout computation).
- **Dinero v2 API surface**: the exact named exports (`add`, `subtract`, `multiply`, `toSnapshot`, etc.) are stable per the v2 release announcement; if a name differs at install time, the wrapper insulates the entire codebase from the change.

## Alternatives Rejected

- **Raw `bigint` cents + scale** — maximum control trades for maximum bug surface (formatting, rounding, currency mismatch, JSON shape all hand-rolled); net cost too high over 5 days.
- **`decimal.js`** — no currency concept; would force hand-rolling currency + ISO 4217 metadata; overkill for a single play-money currency.
- **`currency.js`** — `Number × 100` backing; loses precision on Martingale chains; violates "no float for money" disqualifier on principle.
