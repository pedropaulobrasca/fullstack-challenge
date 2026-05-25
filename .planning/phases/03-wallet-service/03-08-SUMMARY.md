---
phase: 03-wallet-service
plan: 08
subsystem: wallets-tests
tags: [property-test, fast-check, tdd, idempotency, race-condition, unit-test]
requires:
  - "Wallet aggregate from Plan 03-02 (Wallet.provision / debit / credit)"
  - "ProvisionWalletUseCase from Plan 03-05 (idempotent provisioning + 23505 race handling)"
  - "fast-check 3.23 (workspace, hoisted from shared-kernel)"
provides:
  - "ROADMAP SC#5 lock — 10_000-case property test on zero-net debit/credit sequences"
  - "Unit-level idempotency contract for ProvisionWalletUseCase (REQ-WALL-01 + REQ-WALL-03)"
  - "Regression net for SQLSTATE 23505 UNIQUE(player_id) race (Open Question 3 from research)"
  - "Sanity test that an off-by-one bug in Wallet.debit/credit makes the property fail (W7 plan-check)"
affects:
  - "Phase 3 ROADMAP success criterion #5 is observably true"
  - "Future regressions in Wallet.debit/credit or balance invariants are caught by the 10k property predicate in CI"
tech-stack:
  added:
    - "fast-check ^3.23.0 (services/wallets devDep — aligned with shared-kernel)"
  patterns:
    - "Pure-domain fast-check predicate (no DB) so 10k cases run in ~170ms"
    - "Padding logic: when a DEBIT would exceed balance, prepend a CREDIT of the same amount and account for the credit in the running net so the balancer at the end still produces zero"
    - "In-memory WalletRepository test double with swappable saveImpl for race simulation"
    - "Fake EntityManager that invokes the transactional callback inline and counts invocations"
    - "Dynamic import + pre-import process.env stubs to bring up env-dependent modules without touching the runtime .env file"
key-files:
  created:
    - services/wallets/tests/property/wallet-zero-net.test.ts
    - services/wallets/tests/unit/provision-wallet.use-case.test.ts
  modified:
    - services/wallets/package.json
    - bun.lock
decisions:
  - "fast-check pinned to ^3.23.0 (shared-kernel's existing range) instead of the plan's 4.8.0 — avoids workspace version drift, the 3.x API in the test design works verbatim, and the 10k runtime budget is met by an order of magnitude"
  - "Property predicate runs against the pure-domain Wallet aggregate (not the repository) — keeps 10k cases under 200ms and isolates the invariant from the persistence path covered separately by integration tests"
  - "Padding bookkeeping tracks both forward AND inverse direction in the running net so a CREDIT-pad inserted to enable a DEBIT does not break the balancer (CREDIT-pad adds to net, the DEBIT subtracts the same amount, so net effect is zero — but only if both are counted)"
  - "Sanity test (W7) uses fc.assert wrapped in expect().rejects.toThrow() so a green run proves the predicate detects an off-by-one — replaces the need to manually inject a bug into the aggregate at CI time"
  - "Env-dependent test bootstrap uses top-of-file process.env.X ??= ... + dynamic import inside beforeAll — keeps the test self-contained, no bunfig.toml preload, no .env mutation"
metrics:
  duration: "~25 minutes"
  completed: 2026-05-25
---

# Phase 3 Plan 08: Property Test + ProvisionWalletUseCase Idempotency Summary

Locks ROADMAP SC#5 (10k zero-net property test) and the unit-level idempotency + 23505 race contract for `ProvisionWalletUseCase`. Both suites run pure-domain or against in-memory test doubles, finish in under 500ms combined, and require no Docker stack.

## What landed

- **`tests/property/wallet-zero-net.test.ts`** — fast-check 3.23, `numRuns: 10_000` literal, `fc.asyncProperty` over `(initialCents, ops)`. Property predicate provisions a fresh `Wallet`, applies each op (DEBIT / CREDIT) to the running snapshot, pads insufficient debits with a preceding CREDIT and tracks both in the running net, finally applies one balancer op to drive net back to zero, asserts `wallet.balance.toCents() === initialCents`.
- **`tests/property/wallet-zero-net.test.ts`** also includes the W7 sanity test — an intentionally wrong predicate (`credit 100, debit 101, then expect initial`) is asserted to reject via `fc.assert(...)` so a passing test run is proof that the property's `expect(...).toBe(initialCents)` does fire as a failure when the math doesn't add up. Independent verification (mid-execution) confirmed by mutating `Wallet.debit` to `nextBalance.add(Money.of(1n))` and watching fast-check shrink to a single failing op; reverted before commit.
- **`tests/unit/provision-wallet.use-case.test.ts`** — 5 tests covering first-call creation at `env.INITIAL_BALANCE_CENTS`, second-call no-op idempotency, distinct playerIds get distinct walletIds, SQLSTATE 23505 race resolution (returns the racing wallet without re-creating), and `em.transactional` invocation count.
- **`services/wallets/package.json`** — `fast-check` added to devDependencies at `^3.23.0` to match the version range already hoisted by shared-kernel; Bun lockfile updated.

## Test evidence

| Suite | Result | Runtime | Command |
|-------|--------|---------|---------|
| Property (zero-net 10k + sanity) | 2 pass / 0 fail / 10003 expect() | ~170ms | `bun test tests/property/wallet-zero-net.test.ts` |
| Provision-wallet use case | 5 pass / 0 fail / 14 expect() | ~180ms | `bun test tests/unit/provision-wallet.use-case.test.ts` |
| Full unit suite | 25 pass / 0 fail / 81 expect() | ~290ms | `bun test tests/unit` |

The plan's success criterion "10_000 cases in under 10 seconds" is met with a margin of roughly 60x.

## Plan must_haves traceability

| must_have truth | Evidence |
|-----------------|----------|
| 10_000 fast-check cases on the pure-domain Wallet aggregate confirm zero-net preservation | `wallet-zero-net.test.ts` line 85 `numRuns: 10_000`; predicate at lines 28-79 chains `Wallet.provision` → debit/credit ops → final balancer; `expect(wallet.balance.toCents()).toBe(initialCents)` at line 81 |
| First call returns `{created:true}` at `INITIAL_BALANCE_CENTS`, second returns `{created:false}` | `provision-wallet.use-case.test.ts` "first call creates" (lines 65-70) + "second call ... returns the existing wallet" (lines 73-79) |
| Predicate is pure (no DB), 10k cases under 10 seconds | Predicate uses only `Wallet.provision / debit / credit` and `Money` arithmetic — no `em`, no `walletRepo`, no async I/O; actual runtime 170ms |
| `services/wallets/tests/property/wallet-zero-net.test.ts` provides 10k zero-net property | File exists at the declared path; contains `numRuns: 10_000` |
| `services/wallets/tests/unit/provision-wallet.use-case.test.ts` provides idempotent provisioning test | File exists at the declared path; contains the `ProvisionWalletUseCase` symbol import and 5 named tests |
| key_link `wallet.debit(` from property test to `wallet.aggregate.ts` | `grep -n 'wallet\\.debit(' tests/property/wallet-zero-net.test.ts` matches lines 46 and 50 |

## Threat mitigations confirmed

| Threat ID | Mitigation in test |
|-----------|--------------------|
| T-03-29 (Tampering — domain regression) | 10k-case property predicate; any negative balance, lost cents, or off-by-one shrinks to a minimal failing op sequence in fast-check |
| T-03-30 (Repudiation — double-provision race) | "UNIQUE(player_id) race ... resolves the race without creating a duplicate" test simulates a 23505 throw on save and asserts the usecase re-reads + returns the racing wallet |
| T-03-SC (Supply chain — fast-check) | Already in repo via shared-kernel; no new dependency added at a different version |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] fast-check version aligned to existing 3.23.0 (plan asked for 4.8.0)**
- **Found during:** Task 1 setup
- **Issue:** shared-kernel already pins `fast-check ^3.23.0` and Bun's lockfile resolves 3.23.2. Installing 4.x in `services/wallets` would create two coexisting major versions in the workspace, with no test-design feature requiring the 4.x API.
- **Fix:** Added `fast-check: ^3.23.0` to `services/wallets/devDependencies`, ran `bun install`. All API surfaces used in the test design (`fc.asyncProperty`, `fc.bigInt`, `fc.constantFrom`, `fc.array`, `fc.record`, `fc.assert` with `numRuns`) exist in 3.x.
- **Files modified:** `services/wallets/package.json`, `bun.lock`
- **Commit:** `681947c`

**2. [Rule 3 - Blocking] Env stubs + dynamic import in provision-wallet use case test**
- **Found during:** Task 2 first test run (zod parse failed for missing KEYCLOAK_ISSUER / KEYCLOAK_JWKS_URI / KEYCLOAK_AUDIENCE)
- **Issue:** `ProvisionWalletUseCase` statically imports `env` from `config/defaults.ts`. Bun's test runner does not auto-load `.env`, and the runtime `.env` is stale (missing the KEYCLOAK_* keys the schema requires).
- **Fix:** Top-of-file `process.env.X ??= "..."` statements (idempotent — only set if absent so a CI environment with real env vars still wins), then dynamic `import("...provision-wallet.use-case")` inside `beforeAll`. Test stays self-contained; no `bunfig.toml` preload, no mutation of `.env`.
- **Files modified:** `services/wallets/tests/unit/provision-wallet.use-case.test.ts`
- **Commit:** `bdd0779`

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 — 10k property test + fast-check devDep | `681947c` | `services/wallets/tests/property/wallet-zero-net.test.ts`, `services/wallets/package.json`, `bun.lock` |
| Task 2 — ProvisionWalletUseCase idempotency + 23505 race unit tests | `bdd0779` | `services/wallets/tests/unit/provision-wallet.use-case.test.ts` |

## In-memory repository contract used by Task 2

```
InMemoryWalletRepository implements WalletRepository
  - walletsByPlayerId: Map<string, Wallet>           // playerId -> Wallet
  - saveImpl: SaveFn (swappable per-test)            // default: put into the map
  - findByPlayerId(playerId): returns map entry or null
  - save(wallet): delegates to saveImpl
  - applyDebitAtomically / applyCreditAtomically: throw "not used by ProvisionWalletUseCase"
  - forcePut(wallet): bypass for race-simulation tests

FakeEntityManager
  - transactionalCallCount: number
  - transactional(cb): increments counter, invokes cb() inline, returns its result
```

Race simulation (test 4): test swaps `repo.saveImpl` with a function that (a) builds a `Wallet.rehydrate(...)` representing the wallet a concurrent transaction would have written, (b) `repo.forcePut(...)` to make `findByPlayerId` see it, (c) throws an `Error` carrying `code = "23505"`. The use case's catch block detects the unique-violation code, re-reads via `findByPlayerId`, and returns `{ created: false, wallet: racingWallet }` — assertion checks the returned `wallet` is the exact `racingWallet` instance.

## Shrinking behaviour observed during development

During the mid-execution probe (where I temporarily mutated `Wallet.debit` to add 1 cent on every operation), fast-check shrunk from the random 100-op test case down to a sequence with **1 DEBIT and 1 expect mismatch** within ~10 attempts (`(fail) zero-net sequence ... [9.19ms]`). The shrink hint surfaced `cents: 1n` as the minimal counter-example. This confirms fast-check's shrinking is working and the predicate is sensitive at single-cent granularity. The bug-injection commit was never made; the diff was reverted via `cp /tmp/wallet.aggregate.bak.ts` before the Task 1 commit.

## Known Stubs

None. Both test files exercise real production code paths (the actual `Wallet` aggregate, the actual `ProvisionWalletUseCase`) via small, focused test doubles for the dependencies that demand a DB (the EntityManager and the repository). No hardcoded balances, no placeholder assertions, no skipped tests.

## TDD Gate Compliance

Plan-level `type: tdd`. Both tasks are test-only — they add coverage to the existing GREEN implementation from Plan 03-02 (Wallet aggregate) and Plan 03-05 (ProvisionWalletUseCase). The `test(...)` commits (`681947c`, `bdd0779`) are the RED gate; the predicate and use case under test were already GREEN before this plan ran. Per the orchestrator's wave plan, P3.08 is a coverage-tightening plan, not a behavior-adding one.

Mid-execution sanity injection (off-by-one bug in `Wallet.debit`) demonstrated that a GREEN predicate flips to RED when the aggregate regresses — proving the gate detects regressions even though no new behavior was committed in this plan.

## Self-Check: PASSED

- `services/wallets/tests/property/wallet-zero-net.test.ts` — FOUND
- `services/wallets/tests/unit/provision-wallet.use-case.test.ts` — FOUND
- `services/wallets/package.json` — FOUND, contains `fast-check: ^3.23.0` in devDependencies
- Commit `681947c` — FOUND in `git log`
- Commit `bdd0779` — FOUND in `git log`
- `bun test tests/property/wallet-zero-net.test.ts` — 2 pass / 0 fail / 10003 expect() in ~170ms
- `bun test tests/unit/provision-wallet.use-case.test.ts` — 5 pass / 0 fail in ~180ms
- `bun test tests/unit` — 25 pass / 0 fail across the full unit suite
- `grep -n 'numRuns: 10_000' tests/property/wallet-zero-net.test.ts` — matches at line 85
- `grep -n '23505' tests/unit/provision-wallet.use-case.test.ts` — matches at lines 110 and 125
- `grep -n 'wallet\\.debit(' tests/property/wallet-zero-net.test.ts` — matches at lines 46 and 50
