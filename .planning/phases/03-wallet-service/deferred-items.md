# Phase 3 Deferred Items

Items found during Phase 3 execution that are out of scope for their owning plan and need triage by `/gsd:verify-phase 3` or a follow-up housekeeping plan.

## Lint failures in wallet test fixtures (found during P3.10)

`bun run lint` exits 1 with 35 `no-restricted-properties` errors across the wallets test suite:

- `services/wallets/tests/integration/inbox-replay.test.ts` — `process.env` access (lines 1, 70)
- `services/wallets/tests/integration/jwt-guard.test.ts` — `process.env` access (lines 1, 70)
- `services/wallets/tests/integration/provision-wallet.test.ts` — `process.env` access (lines 1, 70)
- `services/wallets/tests/integration/setup.ts` — `process.env` access (multiple lines)
- `services/wallets/tests/integration/wallet-credit.test.ts` — `process.env` access (lines 1, 70)
- `services/wallets/tests/integration/wallet-debit-rejected.test.ts` — `process.env` access (lines 1, 70)
- `services/wallets/tests/integration/wallet-debit.test.ts` — `process.env` access (lines 1, 70)
- `services/wallets/tests/unit/provision-wallet.use-case.test.ts` — `process.env` access (lines 10, 11, 13, 14)

These violate the Phase 1 ESLint rule `no-restricted-properties` against `process.env` outside `src/config/defaults.ts`. The rule was intentionally added (ADR-004 + ADR-006) to keep the typed config layer the only env consumer.

**Out of P3.10 scope** — P3.10 wrote ADRs and updated planning files only; no source/test edits were in scope. P3.04 SUMMARY (deviation 1) and P3.06 SUMMARY (pre-existing test failure note) already flagged the `process.env` pattern in test fixtures as a follow-up.

**Resolution path** — Either (a) add an ESLint override for `services/wallets/tests/**` that allows `process.env` (the runtime config layer is for runtime code, not test fixtures that intentionally bootstrap env), or (b) refactor each test to import a test-only env helper. Option (a) is the lower-impact fix; option (b) preserves the rule's intent more strictly. Pick during `/gsd:verify-phase 3` or a Phase 3 housekeeping pass.

## Pre-existing untracked-then-committed `provision-wallet.use-case.test.ts` env-fixture failure

Flagged in 03-06 SUMMARY § "Pre-existing test failure (out of scope)". This file's RED-phase env-fixture setup was committed in P3.08 (`bdd0779`) but the `process.env` bootstrap still violates the ESLint rule (see above). Same resolution path.
