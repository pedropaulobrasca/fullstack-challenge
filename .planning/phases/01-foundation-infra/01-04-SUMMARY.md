---
phase: 01-foundation-infra
plan: 04
subsystem: shared-kernel
tags: [shared-kernel, money, value-object, ddd, dinero, domain-errors, branded-id]
requires:
  - "Bun 1.3.11 toolchain (P1.1)"
provides:
  - "@crash/shared-kernel workspace package"
  - "Money value object backed by dinero.js v2 bigint"
  - "DomainError taxonomy + Money-specific errors"
  - "DomainEventEnvelope<T> wire interface"
  - "Branded identity types (PlayerId, RoundId, BetId, WalletId, TransactionId, CorrelationId)"
  - "sharedEnvSchema (zod) for cross-service env parsing"
affects:
  - "All future backend services and the frontend, once they depend on @crash/shared-kernel"
tech-stack:
  added:
    - "dinero.js@^2.0.0 (production)"
    - "zod@^3.23.0 (production)"
    - "fast-check@^3.23.0 (dev, property-based tests)"
  patterns:
    - "Value object construction throws on invariant violation"
    - "Bigint cents serialized as string snapshot for JSON safety"
    - "Branded type alias + same-name constructor function pattern"
key-files:
  created:
    - "packages/shared-kernel/package.json"
    - "packages/shared-kernel/tsconfig.json"
    - "packages/shared-kernel/src/index.ts"
    - "packages/shared-kernel/src/money/money.ts"
    - "packages/shared-kernel/src/money/currency.ts"
    - "packages/shared-kernel/src/money/errors.ts"
    - "packages/shared-kernel/src/money/index.ts"
    - "packages/shared-kernel/src/errors/domain-error.ts"
    - "packages/shared-kernel/src/errors/validation-error.ts"
    - "packages/shared-kernel/src/errors/invariant-violation.ts"
    - "packages/shared-kernel/src/errors/not-found-error.ts"
    - "packages/shared-kernel/src/errors/conflict-error.ts"
    - "packages/shared-kernel/src/errors/index.ts"
    - "packages/shared-kernel/src/events/envelope.ts"
    - "packages/shared-kernel/src/events/domain-event.ts"
    - "packages/shared-kernel/src/events/index.ts"
    - "packages/shared-kernel/src/identity/branded-id.ts"
    - "packages/shared-kernel/src/config/env-schema.ts"
    - "packages/shared-kernel/tests/money.test.ts"
    - "frontend/package.json"
  modified: []
decisions:
  - "Dinero v2 bigint API is at the dinero.js/bigint subpath, not the root dinero.js import. The plan's import sketch was outdated; this summary records the actual installed surface."
  - "Currency type is DineroCurrency<bigint>, not the plan's Currency<bigint>. CRD descriptor uses { code: 'CRD', base: 10n, exponent: 2n }."
  - "Money.fromSnapshot enforces currency match against the runtime currency descriptor; a snapshot whose currency code mismatches the consumer's expected currency throws CurrencyMismatchError."
  - "Money.equals returns false (rather than throwing) when currencies differ, matching standard JS equality semantics. lessThan/greaterThan still throw via assertSameCurrency since ordering is undefined across currencies."
  - "Branded id constructor pattern uses TypeScript type/value namespace collision (export type Foo and export const Foo together) so call sites read PlayerId(raw)."
metrics:
  duration_minutes: 18
  completed_at: 2026-05-24
---

# Phase 1 Plan 4: Shared Kernel Summary

`@crash/shared-kernel` is now an installable workspace package providing the cross-cutting domain primitives every later phase will import: a `Money` value object wrapping `dinero.js` v2 bigint arithmetic, a five-class `DomainError` taxonomy, a generic `DomainEventEnvelope<T>` wire shape, six branded identity types with constructor functions, and a zod env schema. Thirteen Money tests (twelve unit + one fast-check generative property test) lock the invariants and pass under `bun test`.

## API Surface

| Export | Kind | Subpath |
|--------|------|---------|
| `Money` | class | `money/money.ts` |
| `MoneySnapshot` | type | `money/money.ts` |
| `MoneyMultiplier` | type | `money/money.ts` |
| `CRD` | const | `money/currency.ts` |
| `Currency` | type alias for `DineroCurrency<bigint>` | `money/currency.ts` |
| `NegativeMoneyError` | class extends DomainError | `money/errors.ts` |
| `CurrencyMismatchError` | class extends DomainError | `money/errors.ts` |
| `DomainError` | abstract class | `errors/domain-error.ts` |
| `ValidationError` | class extends DomainError | `errors/validation-error.ts` |
| `InvariantViolation` | class extends DomainError | `errors/invariant-violation.ts` |
| `NotFoundError` | class extends DomainError | `errors/not-found-error.ts` |
| `ConflictError` | class extends DomainError | `errors/conflict-error.ts` |
| `DomainEventEnvelope<T>` | interface | `events/envelope.ts` |
| `DomainEvent` | interface | `events/domain-event.ts` |
| `Brand<T, B>` | type helper | `identity/branded-id.ts` |
| `PlayerId`, `RoundId`, `BetId`, `WalletId`, `TransactionId`, `CorrelationId` | branded types + constructors | `identity/branded-id.ts` |
| `sharedEnvSchema` | zod schema | `config/env-schema.ts` |
| `SharedEnv` | inferred type | `config/env-schema.ts` |

Money methods: `Money.of`, `Money.fromSnapshot`, `add`, `subtract`, `multiply`, `toCents`, `toSnapshot`, `toJSON`, `toString`, `isZero`, `equals`, `lessThan`, `greaterThan`.

## Slopcheck Results (Task 1)

| Package | Latest version | Pinned range | Repository | Weekly downloads | Last published |
|---------|---------------|--------------|------------|------------------|----------------|
| `dinero.js` | 2.0.2 | `^2.0.0` | github.com/dinerojs/dinero.js | 421,469 | 2026-03-13 |
| `zod` | 4.4.3 | `^3.23.0` (intentional 3.x line) | github.com/colinhacks/zod | 181,191,780 | 2026-05-04 (latest); 3.23.0 published earlier |
| `fast-check` | 4.8.0 | `^3.23.0` (intentional 3.x line) | github.com/dubzzz/fast-check | 17,583,227 | 2026-05-11 (latest); 3.23.x available |

All three packages are widely adopted, author-confirmed in research, and not deprecated or typo-squatted. The two `3.x` pins (zod, fast-check) honor the plan's pinned ranges rather than chasing the latest major; this matches RESEARCH §Output expectations and avoids cross-plan compatibility risk while v3 lines remain maintained.

## Dinero.js v2 Named Export Surface (Resolution of RESEARCH Assumption A3)

The installed `dinero.js@2.0.2` package exposes bigint-mode operations at the `dinero.js/bigint` subpath, not the root `dinero.js` import. The plan's sketch (`from "dinero.js"`) would have resolved to the number-based API, silently breaking REQ-DOM-06.

Imports used by `Money`:

```typescript
import {
  add, dinero, subtract, multiply, toSnapshot,
  isNegative, isZero, equal, lessThan, greaterThan,
} from "dinero.js/bigint";
import type { Dinero } from "dinero.js/bigint";
import type { DineroCurrency } from "dinero.js/bigint";
```

Snapshot shape per installed `index-D9iIqGL-.d.ts`: `{ amount: bigint, currency: DineroCurrency<bigint, TCurrency>, scale: bigint }`. The `MoneySnapshot` wire format converts `amount` to string and `scale` to `number` so the snapshot survives `JSON.stringify` / `JSON.parse`.

`multiply` for bigint accepts a scaled-amount shape `{ amount: bigint, scale?: bigint }` per the installed `MultiplyParams` type, matching the plan's intent.

## Money Test Results

```
bun test v1.3.11
 13 pass
 0 fail
 14 expect() calls
Ran 13 tests across 1 file. [26.00ms]
```

| # | Test | Asserts |
|---|------|---------|
| 1 | `Money.of(100n)` constructs and exposes `toCents()` | `toCents() === 100n` |
| 2 | `Money.of(-1n)` throws `NegativeMoneyError` | thrown type is `NegativeMoneyError` |
| 3 | `Money.of(0n)` constructs and `isZero()` returns true | `isZero() === true` |
| 4 | add returns sum | `toCents() === 150n` |
| 5 | subtract returns difference | `toCents() === 50n` |
| 6 | subtract that would go negative throws | thrown type is `NegativeMoneyError` |
| 7 | equals returns true/false correctly | `true`, `false` |
| 8 | lessThan compares correctly | `true`, `false` |
| 9 | greaterThan compares correctly | `true` |
| 10 | `Money.of(123456n).toString()` returns `"1234.56 CRD"` | string match |
| 11 | JSON round-trip preserves cents | `toCents() === 100_000n` |
| 12 | Currency mismatch throws | thrown type is `CurrencyMismatchError` |
| 13 | Property: round-trip preserves any bigint cents in [0, 10_000_000] | `fc.assert` passes |

## Files Committed

| Task | Commit | Message |
|------|--------|---------|
| 2 | `b0922c8` | `feat(01-04): scaffold @crash/shared-kernel package` |
| 3 | `caff032` | `test(01-04): cover Money VO invariants with 13 unit and property tests` |

Task 1 (slopcheck) is a verification-only step that produced no source changes and therefore no commit, per its plan definition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Frontend workspace placeholder**
- Found during: Task 2 `bun install`
- Issue: Root `package.json` workspaces array lists `frontend`, but `frontend/` contained only a `.gitkeep` with no `package.json`. `bun install` aborted with `Workspace not found "frontend"`.
- Fix: Added a minimal `frontend/package.json` (`@crash/frontend`, `private: true`). No code, no deps — just enough for bun's workspace resolver to succeed. Once Phase 7 scaffolds TanStack Start, that plan will replace this stub.
- Files modified: `frontend/package.json` (created)
- Commit: `b0922c8`

**2. [Rule 1 - API drift] Dinero v2 bigint subpath**
- Found during: Task 2 implementation
- Issue: Plan sketch imported Dinero APIs from `dinero.js`, but the installed `dinero.js@2.0.2` exposes the bigint variant only at `dinero.js/bigint`. The root import is number-based and would have silently violated REQ-DOM-06.
- Fix: All Money imports use `dinero.js/bigint`. Currency type aliased from `DineroCurrency<bigint>` (the actual exported name).
- Files modified: `packages/shared-kernel/src/money/money.ts`, `packages/shared-kernel/src/money/currency.ts`
- Commit: `b0922c8`

**3. [Rule 2 - Correctness] `Money.fromSnapshot` enforces currency code**
- Found during: Task 2 implementation
- Issue: Plan's `fromSnapshot` ignored the snapshot's `currency` field and always rebuilt as CRD. A consumer deserializing a USD snapshot would silently get a CRD Money — currency confusion across the trust boundary.
- Fix: `fromSnapshot(snap, currency = CRD)` throws `CurrencyMismatchError` if `snap.currency !== currency.code`.
- Files modified: `packages/shared-kernel/src/money/money.ts`
- Commit: `b0922c8`

**4. [Rule 2 - Correctness] `Money.equals` does not throw across currencies**
- Found during: Task 2 implementation
- Issue: Strict `assertSameCurrency` before `equal` would throw on `crd.equals(usd)`. The standard semantic for cross-currency equality is `false`, not "error". Throwing here would force every caller into a try/catch when comparing potentially-cross-currency values.
- Fix: `equals` returns `false` when currencies differ; `lessThan`/`greaterThan` still throw (ordering across currencies is undefined, not safely defaulted).
- Files modified: `packages/shared-kernel/src/money/money.ts`
- Commit: `b0922c8`

### Auth Gates

None.

### Architectural Decisions Surfaced

None requiring a checkpoint. All deviations were Rules 1-3 (bugs / correctness / blockers) handled inline.

## Threat Surface Scan

No new trust boundaries beyond those already enumerated in the plan's `<threat_model>`. All mitigations in T-01.4-01 through T-01.4-03 are present (bigint-only money path, post-subtract negative check, `assertSameCurrency` before binary ops). T-01.4-04 (DomainError stack trace masking) is correctly deferred to Phase 3's exception filter — only the `code` discriminator field is shipped here.

## Self-Check: PASSED

- All listed `key-files.created` paths exist on disk.
- Commits `b0922c8` (Task 2) and `caff032` (Task 3) are present in `git log` on `main`.
- `bunx tsc --noEmit` exits 0 against `packages/shared-kernel/tsconfig.json`.
- `bun test packages/shared-kernel/tests/money.test.ts` reports 13/13 pass.
- `grep -rE 'from "(@nestjs|@mikro-orm|socket\.io|axios|pg)' packages/shared-kernel/src/` returns no matches.
- `bun install --frozen-lockfile` is idempotent (no lockfile drift on re-run).
