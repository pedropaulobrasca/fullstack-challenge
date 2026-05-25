---
phase: 03-wallet-service
plan: 02
subsystem: wallets-domain
tags: [ddd, aggregate, money-vo, immutable-ledger, tdd, domain-purity]
requires:
  - "@crash/shared-kernel (Money VO, branded IDs, DomainError, NegativeMoneyError)"
provides:
  - "Wallet aggregate with provision/rehydrate/debit/credit behaviour methods"
  - "Transaction aggregate — immutable, factory-constructed ledger entry"
  - "InsufficientFundsError, WalletNotFoundError, WalletAlreadyExistsError"
  - "WalletRepository + TransactionRepository interfaces (no impl yet)"
affects:
  - "Defines the domain contract Plan 03-03 (entities) and Plan 03-05 (repository impl) must satisfy"
  - "Synchronous Wallet.debit/credit predicate is the building block for Plan 03-08 property test"
tech-stack:
  added: []
  patterns:
    - "Snapshot-style aggregate (debit/credit return next + Transaction, never mutate self)"
    - "Money invariant translation (NegativeMoneyError → InsufficientFundsError at aggregate boundary)"
    - "Factory-only construction + Object.freeze for ledger immutability"
    - "DomainError abstract base with subclass-declared `code` discriminant"
key-files:
  created:
    - services/wallets/src/domain/errors.ts
    - services/wallets/src/domain/wallet.repository.ts
    - services/wallets/src/domain/transaction.repository.ts
    - services/wallets/src/domain/transaction.aggregate.ts
    - services/wallets/src/domain/wallet.aggregate.ts
    - services/wallets/tests/unit/transaction.aggregate.test.ts
    - services/wallets/tests/unit/wallet.aggregate.test.ts
  modified: []
decisions:
  - "Transaction is its own aggregate (append-only ledger), not a child of Wallet — confirms ADR-011 intent"
  - "Wallet.debit catches NegativeMoneyError and rethrows as InsufficientFundsError carrying MoneySnapshot for both requested and available — keeps domain error vocabulary intact at the aggregate boundary"
  - "Transaction.id is derived from messageId (natural key per REQ-WALL-07 UNIQUE constraint) rather than a generated UUID"
  - "Domain methods are snapshot-style (return next + transaction; never mutate self) so the property test in Plan 03-08 can chain operations without aliasing"
metrics:
  duration: "~20 minutes"
  completed: 2026-05-25
---

# Phase 3 Plan 02: Wallet Domain Layer Summary

Pure-domain Wallet bounded context: rich `Wallet` aggregate with `provision/rehydrate/debit/credit`, immutable `Transaction` ledger entry, three domain errors, and two repository interfaces — built TDD-first with 13 unit tests covering every invariant.

## What landed

- **`Wallet` aggregate** (`src/domain/wallet.aggregate.ts`).
  - `provision(id, playerId, initial, now)` — factory for first-login provisioning.
  - `rehydrate(props)` — bypass for repository reconstruction after DB load.
  - `debit(amount, correlationId, messageId, now)` — wraps `Money.subtract`, catches `NegativeMoneyError`, rethrows as `InsufficientFundsError` with both `requested` and `available` as `MoneySnapshot` strings. Returns `{ next: Wallet, transaction: Transaction }`.
  - `credit(amount, correlationId, messageId, now)` — symmetric via `Money.add`.
  - Caller-side snapshot semantics: original instance unchanged after either operation.
- **`Transaction` aggregate** (`src/domain/transaction.aggregate.ts`).
  - Private constructor + `Transaction.record(props)` factory.
  - `Object.freeze(this)` + `Object.freeze(this.props)` on construction.
  - Validates: positive amount (`amount.toCents() > 0n`), non-empty `messageId`, non-empty `correlationId`.
  - `toSnapshot()` returns serializable shape with `MoneySnapshot` for `amount` / `previousBalance` / `newBalance` — never raw bigint on the wire (Pitfall 3 / REQ-DOM-06).
  - `id` getter exposes `messageId` as the natural key (REQ-WALL-07 UNIQUE constraint).
- **Domain errors** (`src/domain/errors.ts`). `InsufficientFundsError`, `WalletNotFoundError`, `WalletAlreadyExistsError` — each extends `DomainError`, each declares its `code`, each stores params as `readonly` fields.
- **Repository interfaces** (`src/domain/wallet.repository.ts`, `src/domain/transaction.repository.ts`). Discriminated-union return shapes for `applyDebitAtomically` (OK / INSUFFICIENT_FUNDS / NOT_FOUND) and `applyCreditAtomically` (OK / NOT_FOUND); `TransactionRepository.append` only — append-only contract.

## Test evidence

| Suite | Pre-impl | Post-impl | Command |
|-------|---------|-----------|---------|
| Transaction unit (6 tests) | module not found (RED) | 6 pass | `bun test tests/unit/transaction.aggregate.test.ts` |
| Wallet unit (7 tests) | module not found (RED) | 7 pass | `bun test tests/unit/wallet.aggregate.test.ts` |
| Domain unit (full) | n/a | 13 pass / 56 expect() | `bun test tests/unit/` |
| Service typecheck | n/a | clean (exit 0) | `bunx tsc --noEmit` |

Transaction tests cover: factory immutability + getters, frozen-instance mutation no-op, `toSnapshot()` produces `MoneySnapshot` strings (never bigint), zero-amount rejection, empty/whitespace `messageId` rejection, empty/whitespace `correlationId` rejection.

Wallet tests cover: provisioning sets balance + timestamps, `rehydrate` reconstructs without provision-time logic, `debit` returns next + DEBIT transaction with previous/new balance equality, `debit` translates 200k > 100k into `InsufficientFundsError` with `requested.amount === "200000"` and `available.amount === "100000"`, `credit` returns next + CREDIT transaction, debit-then-credit chain on `next.next` preserves Money invariants, original instance unchanged (snapshot semantics).

## Purity verification

```bash
grep -rnE "^import.*(@nestjs|@mikro-orm|axios|socket\.io|from .pg.)" services/wallets/src/domain/
# exit 1 — no matches
```

Domain layer answers only to `@crash/shared-kernel` and itself. No infra imports. Bigint appears only in the zero-amount guard inside `Transaction.record` (`props.amount.toCents() <= 0n`) — never returned by any snapshot.

## Threat mitigations confirmed

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-03-04 (Tampering — balance invariant) | `Wallet.debit` catches `NegativeMoneyError` and throws `InsufficientFundsError`; defence in depth waits for Plan 03-03's Postgres CHECK |
| T-03-05 (Info Disclosure — bigint on wire) | `Transaction.toSnapshot` routes every Money field through `Money.toSnapshot()`; verified by `typeof snap.amount.amount === "string"` |
| T-03-06 (Repudiation — mutable ledger) | `Object.freeze(this)` + `Object.freeze(this.props)` in `Transaction` constructor; verified by `Object.isFrozen(tx)` assertion and direct-mutation no-op test |

## Deviations from Plan

None. Plan executed as written.

One micro-deviation on test count for clarity: the plan called for "5 transaction tests + 7 wallet tests = 12 tests". I split the plan's Test 5 (which combined `messageId` and `correlationId` whitespace guards) into two separate tests so each invariant gets its own named test. Total runtime tests: 6 transaction + 7 wallet = **13**. The plan's quantitative success criterion ("≥ 12") still holds.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 — domain errors + repository interfaces | `78aa2c8` | `errors.ts`, `wallet.repository.ts`, `transaction.repository.ts` |
| Task 2 — Transaction aggregate + tests | `24759d0` | `transaction.aggregate.ts`, `transaction.aggregate.test.ts` |
| Task 3 — Wallet aggregate + tests | `4172735` | `wallet.aggregate.ts`, `wallet.aggregate.test.ts` |

## Known Stubs

None. Every file delivered is production-ready domain code with full test coverage of the invariants it claims. Repository interfaces are intentionally interface-only (impl is Plan 03-05's job per the wave plan).

## Self-Check: PASSED

- `services/wallets/src/domain/errors.ts` — FOUND
- `services/wallets/src/domain/wallet.repository.ts` — FOUND
- `services/wallets/src/domain/transaction.repository.ts` — FOUND
- `services/wallets/src/domain/transaction.aggregate.ts` — FOUND
- `services/wallets/src/domain/wallet.aggregate.ts` — FOUND
- `services/wallets/tests/unit/transaction.aggregate.test.ts` — FOUND
- `services/wallets/tests/unit/wallet.aggregate.test.ts` — FOUND
- Commit `78aa2c8` — FOUND in `git log`
- Commit `24759d0` — FOUND in `git log`
- Commit `4172735` — FOUND in `git log`
- `bun test tests/unit/` — 13 pass / 0 fail
- `bunx tsc --noEmit` — exit 0
- `grep -rnE "^import.*(@nestjs|@mikro-orm|axios|socket\.io)" src/domain/` — no matches
