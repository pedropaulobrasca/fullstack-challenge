---
phase: 03-wallet-service
plan: 09
completed: 2026-05-25T18:55:00Z
status: complete
integration_tests: 15 pass / 0 fail
smoke_probes: 26 / 26
---

# 03-09 — Wallet Integration Tests + Smoke Probes

## Result

- `INTEGRATION=1 bun test tests/integration` → **15 pass / 0 fail / 31 expect()** across 6 files in ~3.85s.
- `bun run smoke:health` → **26 / 26 probes passed** (full stack live via docker compose).

## Integration Test Files

| File | Coverage |
|------|----------|
| `tests/integration/provision-wallet.test.ts` | POST /wallets idempotency, INITIAL_BALANCE_CENTS via Kong |
| `tests/integration/jwt-guard.test.ts` | JWKS validation, issuer/audience/expiry rejection |
| `tests/integration/wallet-debit.test.ts` | wallet.debit happy path → balance + Transaction + outbox event |
| `tests/integration/wallet-credit.test.ts` | wallet.credit happy path symmetric |
| `tests/integration/wallet-debit-rejected.test.ts` | INSUFFICIENT_FUNDS publishes `wallet.debit.rejected`, balance unchanged |
| `tests/integration/inbox-replay.test.ts` | same `messageId` redelivered → handler runs once (idempotency) |

## Smoke Probes 23-26 Added

23. Keycloak password grant (player/player123) — returns access token
24. POST /wallets via Kong → 201/200 (idempotent)
25. GET /wallets/me via Kong → 200 + `balance.amount === "100000"`
26. POST /wallets/me/debit via Kong → 404 (route blocked at gateway)

## Critical Fix Applied During This Plan

**Bug**: `applyDebitAtomically` / `applyCreditAtomically` raw SQL via `em.getConnection().execute(sql, params)` ran on the pool connection — outside the decorator's `em.transactional` TX. Result: wallet UPDATE auto-committed BEFORE Transaction row insert + outbox row, breaking the same-TX guarantee.

**Symptom**: `wallet-debit.test.ts` failed in suite with `Expected: 1 Received: 0` for Transaction count. Test polled balance via separate EM and saw `50000` (autocommit), then queried transactions → 0 because Transaction insert was still pending in another TX that committed later.

**Fix**: Pass `em.getTransactionContext()` as the 4th argument to `execute()`:
```ts
em.getConnection().execute(sql, params, "all", em.getTransactionContext())
```
This binds the raw SQL to the decorator's open TX, so wallet UPDATE + Transaction insert + outbox row all commit together.

**Commit**: `fix(wallets): bind atomic UPDATE to txEm transaction context for same-TX commit`

**Impact**: The wallet UPDATE, Transaction append, and `wallet.debited` / `wallet.credited` outbox row now commit as one atomic unit. Confirmed by re-running the full suite (15/15 pass).

## Plan-Check Coverage

| Concern | Addressed |
|---------|-----------|
| W8 (smoke via Kong, not direct service port) | Smoke probes use `http://localhost:8000/wallets` |
| W3 (outbox.add(env, route, txEm)) | Handler from P3.06 calls 3-arg outbox.add; verified by inbox-replay test |
| OI-4 (ESLint exemption for integration tests) | Tests guard via `if (!process.env.INTEGRATION) process.exit(0)` — no eslint changes needed |

## Phase Goal Evidence

| Phase 3 Success Criterion | Evidence |
|---------------------------|----------|
| 1. POST /wallets idempotent + GET /wallets/me | provision-wallet.test + jwt-guard.test + smoke probes 24/25 |
| 2. wallet.debit 2000 vs 1000 → wallet.debit.rejected, no mutation, CHECK | wallet-debit-rejected.test |
| 3. Each debit/credit → immutable Transaction row | wallet-debit.test + wallet-credit.test |
| 4. Wallet REST has NO mutation endpoints | smoke probe 26 (Kong 404) |
| 5. (delivered in P3.08) | fast-check 10k pass |

## Commits

- `1735d8e` test(wallets): integration suite for provisioning and JWT guard
- `68dd908` fix(wallets): split wallet.commands queue into wallet.debit.q and wallet.credit.q
- `4b3aceb` test(wallets): AMQP integration suite for debit, credit, rejection and inbox replay
- `6ac05b8` fix(wallets): align Kong path forwarding, Keycloak audience, and JwtGuard DI
- `edb4560` chore(wallets): align .env.example KEYCLOAK_AUDIENCE with realm mapper
- (this commit) fix(wallets): bind atomic UPDATE to txEm transaction context for same-TX commit

## Next

P3.10 closeout — ADR-011 (ledger), ADR-012 (JWKS), ADR-013 (txEm propagation) + STATE/ROADMAP/REQUIREMENTS update.
