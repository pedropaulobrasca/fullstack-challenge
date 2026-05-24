---
phase: 01-foundation-infra
plan: 05
subsystem: contracts
tags: [contracts, wire-format, money-snapshot, zod, workspace]
requires:
  - "@crash/shared-kernel (Money VO, MoneySnapshot, ValidationError, NegativeMoneyError)"
  - "zod 3.23"
  - "dinero.js 2.0 (type-only at the snapshot boundary)"
provides:
  - "@crash/contracts workspace package"
  - "serializeMoney(money: Money) -> MoneySnapshot"
  - "parseMoneySnapshot(input: unknown) -> Money"
  - "moneySnapshotSchema (strict zod) + MoneySnapshotInput type"
  - "Reserved subdirs: events/, dtos/, provably-fair/"
affects:
  - "Phase 2: events/ will host zod-validated AMQP envelope schemas"
  - "Phase 3: dtos/ will host wallet REST DTOs"
  - "Phase 4: provably-fair/ will host the crash-point algorithm shared FE/BE"
  - "Phase 5: dtos/ will host bet REST DTOs"
  - "Phase 7: frontend will import @crash/contracts for Money wire parsing"
tech-stack:
  added: []
  patterns:
    - "Shape vs domain separation: zod validates wire shape, Money.fromSnapshot validates domain (negative amounts)"
    - "strict() schema rejects unknown keys at AMQP/HTTP/WS boundaries to fail loudly on payload drift"
    - "Workspace dep on @crash/shared-kernel keeps the Money VO single-sourced"
key-files:
  created:
    - "packages/contracts/package.json"
    - "packages/contracts/tsconfig.json"
    - "packages/contracts/src/index.ts"
    - "packages/contracts/src/money/snapshot.ts"
    - "packages/contracts/src/events/.gitkeep"
    - "packages/contracts/src/dtos/.gitkeep"
    - "packages/contracts/src/provably-fair/.gitkeep"
    - "packages/contracts/tests/money-snapshot.test.ts"
  modified:
    - "bun.lock (added @crash/contracts workspace edge)"
decisions:
  - "Two-layer validation: zod enforces `/^-?\\d+$/` integer-string shape; Money.fromSnapshot enforces non-negative domain rule. Negative amounts reach Money.fromSnapshot and throw NegativeMoneyError — they do NOT fold into ValidationError."
  - "moneySnapshotSchema.strict() rejects unknown keys. A misbehaving producer adding fields is a Tampering threat (T-01.5-01) — the contract must fail loudly, not silently strip."
  - "Phase 1 barrel exports only the money snapshot helpers. The three subdir placeholders stay unexported until their phase fills them — keeps the public surface a true reflection of what is actually implemented."
metrics:
  duration: "~7 minutes"
  completed: "2026-05-24T18:48:34Z"
  tasks: 2
  tests: "7 pass / 0 fail"
---

# Phase 1 Plan 5: Contracts Package Summary

`@crash/contracts` ships as an installable workspace package whose Phase 1 surface is the `MoneySnapshot` round-trip helpers — `serializeMoney`, `parseMoneySnapshot`, and the strict `moneySnapshotSchema` — plus reserved subdirectories for the contracts that later phases will add.

## What landed

| Surface | File | Notes |
|---|---|---|
| `serializeMoney(money)` | `src/money/snapshot.ts` | Thin alias over `money.toSnapshot()`; the explicit name makes wire-boundary call sites self-documenting |
| `parseMoneySnapshot(input)` | `src/money/snapshot.ts` | Two-stage: zod safeParse → `ValidationError`, then `Money.fromSnapshot` → `NegativeMoneyError` propagates |
| `moneySnapshotSchema` | `src/money/snapshot.ts` | `z.object({ amount: z.string().regex(/^-?\d+$/), currency: z.string().min(1), scale: z.number().int().nonnegative() }).strict()` |
| `MoneySnapshotInput` | `src/money/snapshot.ts` | `z.infer<typeof moneySnapshotSchema>` — consumers in Phase 3 can type AMQP payloads against it |
| `src/index.ts` | barrel | `export * from "./money/snapshot"` — events/dtos/provably-fair stay invisible until they exist |

## Zod schema (canonical)

```ts
z.object({
  amount: z.string().regex(/^-?\d+$/),  // integer string, sign permitted, no decimals, no scientific notation
  currency: z.string().min(1),          // currency code — actual currency match enforced by Money.fromSnapshot against CRD
  scale: z.number().int().nonnegative(),
}).strict()
```

The regex permits a minus sign so the failure path for negative amounts can be tested at the domain layer (`NegativeMoneyError`) rather than the shape layer (`ValidationError`). The separation of concerns matters in Phase 3's exception filter: shape failures get a 400 with field paths, domain failures get a 422 with a domain error code.

## Reserved subdirectories

| Path | Filled by | Phase |
|---|---|---|
| `src/events/` | AMQP event envelope schemas (`wallet.debit`, `wallet.debited`, `game.bet.placed`, etc.) | Phase 2 |
| `src/dtos/` | Wallet REST DTOs (POST/GET `/wallets`); bet REST DTOs (`POST /games/bet`, `GET /bets/:id`) | Phase 3 then Phase 5 |
| `src/provably-fair/` | Bustabit-style HMAC-SHA-256 hash chain + crash-point pure function shared FE/BE | Phase 4 |

`.gitkeep` markers carry zero bytes — only their presence in git matters.

## Tests

7 pass / 0 fail (16 expect calls):

1. `serializeMoney(Money.of(100n))` -> `{ amount: "100", currency: "CRD", scale: 2 }`
2. `parseMoneySnapshot({ amount: "100", currency: "CRD", scale: 2 }).toCents() === 100n`
3. `parseMoneySnapshot({})` throws `ValidationError`
4. `parseMoneySnapshot({ amount: 100, ... })` (number not string) throws `ValidationError`
5. `parseMoneySnapshot({ amount: "-1", ... })` throws `NegativeMoneyError` (domain layer wins on shape-valid but domain-invalid input)
6. Round-trip identity over `[0n, 1n, 100n, 100_000n, 999_999_999n]`
7. `.strict()` rejection on unknown keys (extra field on the snapshot)

## Verification

| Gate | Command | Result |
|---|---|---|
| Frozen install idempotent | `bun install --frozen-lockfile` | 0 changes |
| Typecheck | `bunx tsc --noEmit -p packages/contracts/tsconfig.json` | exit 0 |
| Tests | `bun test packages/contracts/tests/money-snapshot.test.ts` | 7/7 pass |
| Zero infra imports | `grep -rE "@nestjs|@mikro-orm|socket\.io" packages/contracts/src/` | no matches |
| Workspace registered | `bun pm ls` includes `@crash/contracts@workspace:packages/contracts` | yes |

## Deviations from Plan

The plan documented six tests; the implementation ships seven. The seventh test asserts that `.strict()` rejects unknown keys — required by the acceptance criterion "The zod schema uses `.strict()` (verified by inspecting the source)" but better verified at runtime than by source-grep. No-op for downstream phases; just a stricter contract.

No auto-fixes (Rules 1-3) triggered. No architectural decisions (Rule 4) needed. No authentication gates.

## Notable observations

- The shared-kernel `Money` VO uses `dinero.js/bigint` (the bigint subpath). The contracts package only depends on `dinero.js` for the `Currency<bigint>` *type*, which is re-exported transitively via shared-kernel's `MoneySnapshot`. No direct `dinero.js/bigint` import is needed in this package — the snapshot is a plain object once it crosses the wire.
- `z.infer` on a strict object schema in zod 3.23 produces the expected `{ amount: string; currency: string; scale: number }` type — no surprise.
- Bun's workspace registry picks up `packages/contracts` from the root `packages/*` glob without further config. The `services/games/node_modules/@crash/contracts` symlink the plan called for materializes only once a service declares the dependency (Phase 3+ for wallets, Phase 4+ for games). Bun hoists workspace links to root `node_modules/@crash/` only when something consumes them.

## TDD gate compliance

- RED commit: `6baa754` — `test(01-05): add failing tests for money snapshot wire format` (exit code 1 on first run, "Cannot find module '../src'")
- GREEN commit: `24d044c` — `feat(01-05): implement money snapshot wire format with zod validation` (7/7 pass)
- REFACTOR: skipped — the GREEN code is already minimal (one source file, one barrel)

## Commits

| Hash | Type | Subject |
|---|---|---|
| `c2b76f4` | feat | scaffold @crash/contracts workspace package |
| `6baa754` | test | add failing tests for money snapshot wire format |
| `24d044c` | feat | implement money snapshot wire format with zod validation |

## Self-Check: PASSED

- `packages/contracts/package.json` — FOUND
- `packages/contracts/tsconfig.json` — FOUND
- `packages/contracts/src/index.ts` — FOUND
- `packages/contracts/src/money/snapshot.ts` — FOUND
- `packages/contracts/src/events/.gitkeep` — FOUND
- `packages/contracts/src/dtos/.gitkeep` — FOUND
- `packages/contracts/src/provably-fair/.gitkeep` — FOUND
- `packages/contracts/tests/money-snapshot.test.ts` — FOUND
- Commits `c2b76f4`, `6baa754`, `24d044c` — all FOUND in `git log`
