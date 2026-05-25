---
phase: 03-wallet-service
verified: 2026-05-25T00:00:00Z
status: passed
verdict: PASS
score: 5/5 success criteria verified
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 3: Wallet Service — Goal-Backward Verification

**Phase Goal:** A player has a provisioned wallet on first login and can be debited or credited exclusively via RabbitMQ commands with non-negative-balance and exact-precision guarantees.

**Verified:** 2026-05-25
**Status:** PASS
**Re-verification:** No — initial verification

## VERDICT: PASS

All five ROADMAP success criteria observably true in the codebase, the live stack, and the test suites. Three ADRs landed with substantive Context/Decision/Consequences sections. Critical fixes (W3 outbox + txEm, W4 previous_balance RETURNING, W6 env.CURRENCY_CODE, atomic UPDATE bound to em.getTransactionContext()) are all present. Eight REQ-IDs satisfied. One out-of-scope finding (35 lint errors in test fixtures) is documented and explicitly accepted as Phase 3 deferred tech debt with a resolution path.

---

## Goal Achievement — Success Criteria

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | `POST /wallets` with valid JWT provisions at `INITIAL_BALANCE_CENTS`, idempotent on re-call; `GET /wallets/me` returns balance | VERIFIED | Live: smoke probe 24 PASS (`first=201, second=200`), smoke probe 25 PASS (`balance.amount === "100000"`). Code: `WalletsController` (POST + GET behind `@UseGuards(JwtGuard)`), `ProvisionWalletUseCase` (idempotent on UNIQUE race). Tests: `provision-wallet.test.ts` integration, `jwt-guard.test.ts` integration, `provision-wallet.use-case.test.ts` unit |
| 2 | `wallet.debit 200000` against 100000 balance emits `wallet.debit.rejected{INSUFFICIENT_FUNDS}`, no balance mutation, Postgres CHECK constraint backs invariant | VERIFIED | Migration `20260525001-create-wallets.ts` line 13: `CONSTRAINT wallets_balance_non_negative CHECK (balance_cents >= 0)`. Atomic UPDATE in `mikro-wallet.repository.ts:65-70` uses `WHERE balance_cents >= ?` (primary guard). Integration test `wallet-debit-rejected.test.ts` asserts balance unchanged at 100000, zero Transaction rows, outbox emits `INSUFFICIENT_FUNDS` |
| 3 | Each debit/credit creates immutable Transaction row tied to correlationId; replaying same messageId is no-op (inbox dedupe) | VERIFIED | Migration `20260525002-create-transactions.ts` line 16: `message_id TEXT NOT NULL UNIQUE`, line 15: `correlation_id TEXT NOT NULL`. Handler writes `Transaction.record({correlationId, messageId})` in same txEm. Integration test `inbox-replay.test.ts` publishes same envelope twice, asserts `transactions count = 1`, `inbox count = 1`, balance unchanged after second publish |
| 4 | Wallet REST has NO mutation endpoints (Kong narrowed) | VERIFIED | Live: smoke probe 26 PASS (`POST /wallets/me/debit → 404`). Kong admin API confirms exactly 3 routes: `wallets-provision` (POST `~/wallets$`), `wallets-me` (GET `~/wallets/me$`), `games-routes`. `kong.yml` uses PCRE-anchored regex paths with method whitelisting. Controller exposes only `@Post()` and `@Get('me')` — zero mutation endpoints in source |
| 5 | Property test (fast-check, 10k cases) confirms zero-net sequence returns wallet to original balance | VERIFIED | `services/wallets/tests/property/wallet-zero-net.test.ts` configured `numRuns: 10_000`. Re-run from `services/wallets`: 27 pass / 10083 expect() calls / 316ms across property + unit suites. Sanity-test branch (off-by-one) correctly fails via `expect(fc.assert(...)).rejects.toThrow()` |

**Score:** 5/5 success criteria verified

---

## Required Artifacts (Three-Level Check)

| Artifact | Exists | Substantive | Wired | Status |
|----------|--------|-------------|-------|--------|
| `services/wallets/src/domain/wallet.aggregate.ts` | yes | 118 lines — pure-domain Wallet with provision/rehydrate/debit/credit; zero infra imports | imported by repos, handlers, use-case, property test | VERIFIED |
| `services/wallets/src/domain/transaction.aggregate.ts` | yes | Immutable factory + frozen instance | imported by handlers + repo | VERIFIED |
| `services/wallets/src/application/handlers/wallet-debit.handler.ts` | yes | `@IdempotentSubscribe` decorator wires queue `wallet.debit.q`; passes `txEm` through atomic UPDATE + Transaction.append + outbox.add (4 same-TX writes) | mounted in AppModule, queue `wallet.debit.q` asserted (smoke probe RabbitMQ) | VERIFIED |
| `services/wallets/src/application/handlers/wallet-credit.handler.ts` | yes | Mirror of debit handler, routing-key `wallet.credit`, queue `wallet.credit.q` | queue asserted (smoke probe) | VERIFIED |
| `services/wallets/src/infrastructure/repositories/mikro-wallet.repository.ts` | yes | Atomic UPDATE with `RETURNING id, balance_cents, (balance_cents +/- ?) AS previous_balance_cents` bound to `em.getTransactionContext()` on all three SQL paths (debit, credit, debit-miss) | wired via `WALLET_REPOSITORY` DI token | VERIFIED |
| `services/wallets/src/presentation/controllers/wallets.controller.ts` | yes | Only `POST /wallets` (idempotent) + `GET /wallets/me` behind `JwtGuard`; zero mutation routes | mounted at `/wallets` | VERIFIED |
| `services/wallets/src/presentation/guards/jwt.guard.ts` | yes | `jose@^6.2.3` `createRemoteJWKSet` (cache 600s, cooldown 30s), validates issuer + audience + signature + expiry via `jwtVerify`; injects `playerId` from `sub` | applied via `@UseGuards(JwtGuard)` on WalletsController | VERIFIED |
| `services/wallets/src/infrastructure/mikro-orm/migrations/20260525001-create-wallets.ts` | yes | DDL: id UUID PK, player_id UNIQUE, balance_cents BIGINT, **CHECK (balance_cents >= 0)** | applied at boot — smoke probe `wallets.wallets` table check passes implicitly via probes 24/25 | VERIFIED |
| `services/wallets/src/infrastructure/mikro-orm/migrations/20260525002-create-transactions.ts` | yes | DDL: id UUID PK, FK wallet_id, kind CHECK IN ('DEBIT','CREDIT'), amount_cents > 0, **message_id UNIQUE**, correlation_id index | applied at boot | VERIFIED |
| `docker/kong/kong.yml` | yes | PCRE-anchored regex paths `~/wallets$` + `~/wallets/me$` with explicit `methods: [POST]` / `[GET]` — every other method/path returns Kong-origin 404 | Kong admin API lists exactly 3 routes; smoke probe 26 confirms mutation blocked | VERIFIED |
| `scripts/smoke-health.sh` | yes | 26 probes including 4 Phase 3 probes (token, provision idempotent, balance, mutation-blocked) | `bun run smoke:health` → 26/26 PASS | VERIFIED |
| `services/wallets/tests/property/wallet-zero-net.test.ts` | yes | `numRuns: 10_000`, sanity-test branch validates property machinery detects regressions | re-runs green; 10003+ expect() in ~170ms | VERIFIED |
| `services/wallets/tests/integration/*.test.ts` (6 files) | yes | All 5 SCs covered: provision, jwt-guard, debit, credit, debit-rejected, inbox-replay | 15/15 pass when run via `cd services/wallets && INTEGRATION=1 bun test tests/integration` (3.87s) | VERIFIED |

---

## Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `WalletDebitHandler.handle` | atomic SQL UPDATE | `walletRepo.applyDebitAtomically(playerId, amount, txEm)` | WIRED — `txEm` propagated, bound to `em.getTransactionContext()` |
| `WalletDebitHandler.handle` | inbox dedupe row | `@IdempotentSubscribe` decorator (Phase 2) | WIRED — decorator opens TX, passes `txEm` as 3rd handler arg (ADR-013) |
| `WalletDebitHandler.handle` | outbox `wallet.debited` event | `this.outbox.add(envelope, route, txEm)` | WIRED — same-TX outbox insert; route to `EXCHANGES.WALLET_EVENTS` |
| `WalletDebitHandler.handle` | Transaction ledger row | `txRepo.append(transaction, { playerId, txEm })` | WIRED — same-TX append; FK to wallet via UUID |
| `WalletsController.create` | `ProvisionWalletUseCase` | DI injection | WIRED — controller calls `provision.execute(playerId)` |
| `WalletsController.*` | JWT verification | `@UseGuards(JwtGuard)` | WIRED — guard injects `req.user.playerId` |
| `JwtGuard` | Keycloak JWKS | `createRemoteJWKSet(KEYCLOAK_JWKS_URI)` | WIRED — env-driven, cached 600s |
| `mikro-wallet.repository.ts:applyDebitAtomically` | atomic UPDATE bound to TX | `em.getConnection().execute(sql, params, "all", em.getTransactionContext())` | WIRED — critical fix from P3.09 (commit `5678c0f`) |
| Kong → `wallets-provision` route | upstream `wallets:4002` | `~/wallets$` + `POST` only | WIRED — mutation paths blocked; admin API confirms 3 named routes |

---

## REQ-ID Coverage

| REQ-ID | Description | Status | Evidence |
|--------|-------------|--------|----------|
| REQ-DOM-03 | Wallet aggregate balance + precision invariants | SATISFIED | `wallet.aggregate.ts` debit/credit translate `NegativeMoneyError` → `InsufficientFundsError`; property test 10k cases asserts zero-net invariance |
| REQ-AUTH-04 | JWT validation via cached JWKS at each service | SATISFIED | `JwtGuard` via `jose` `createRemoteJWKSet` (600s cacheMaxAge, 30s cooldownDuration); issuer + audience + signature + expiry verified |
| REQ-WALL-01 | `POST /wallets` idempotent provisioning | SATISFIED | Smoke probe 24 (first=201, second=200); `ProvisionWalletUseCase` handles 23505 race; integration test `provision-wallet.test.ts` |
| REQ-WALL-02 | `GET /wallets/me` returns balance + metadata | SATISFIED | Smoke probe 25 (`balance.amount === "100000"`); controller `@Get('me')` |
| REQ-WALL-03 | Initial balance from `INITIAL_BALANCE_CENTS` env | SATISFIED | `config/defaults.ts` exposes `env.INITIAL_BALANCE_CENTS` (default 100000); `ProvisionWalletUseCase` reads it; smoke probe 25 confirms 100000 |
| REQ-WALL-04 | Debit/credit only via RabbitMQ (no REST mutations) | SATISFIED | Controller exposes only POST `/wallets` + GET `/wallets/me`; Kong route narrowing blocks all mutation paths at gateway (smoke probe 26 returns Kong-origin 404); AMQP handlers via `@IdempotentSubscribe` on `wallet.debit.q` and `wallet.credit.q` |
| REQ-WALL-07 | Immutable Transaction ledger row per debit/credit | SATISFIED | `transactions` table with `message_id UNIQUE`, `correlation_id` index; handler appends Transaction in same TX as wallet UPDATE; replay test confirms exactly one row per messageId |

**ORPHANED requirements:** None. All 7 REQ-IDs declared in ROADMAP Phase 3 are claimed by plans and satisfied.

---

## ADR Catalogue Check

| ADR | Title | Status | Substantive |
|-----|-------|--------|-------------|
| ADR-011 | Ledger model — Wallet snapshot + immutable Transaction aggregate over event sourcing | Accepted | Full Context (REQ-WALL-07 + REQ-DOM-03 + REQ-DOM-05 collision), 3 options compared, Decision + Consequences sections present |
| ADR-012 | JWT validation via `jose` cached JWKS over passport-jwt + Kong JWT plugin | Accepted | Records `KEYCLOAK_AUDIENCE=account` (Option B), 600s cache + 30s cooldown rationale, Bun + passport-jwt + SWC friction documented |
| ADR-013 | `@IdempotentSubscribe` propagates `txEm` to handler signature | Accepted | Documents OI-3 bug surfaced in Phase 2, three resolution shapes compared, Option A chosen — propagates `txEm` as 3rd positional arg; spine public API minor-version change documented |

ADR catalogue `README.md` Phase 3 section correctly links all three. STATE/ROADMAP/REQUIREMENTS all updated to reflect Phase 3 complete.

---

## Critical Fixes Verification

| Fix | Where | Status |
|-----|-------|--------|
| W3 — `outbox.add(env, route, txEm)` propagates TX to publisher write | `wallet-debit.handler.ts:84`, `wallet-debit.handler.ts:109`, `wallet-debit.handler.ts:144`, `wallet-credit.handler.ts:84`, `wallet-credit.handler.ts:119` | VERIFIED — third arg `txEm` present on every outbox.add call |
| W4 — `previous_balance_cents` returned from SQL RETURNING (not reconstructed) | `mikro-wallet.repository.ts:66`: `(balance_cents + ?) AS previous_balance_cents`; `:98`: `(balance_cents - ?) AS previous_balance_cents` | VERIFIED — handler reads `result.previousBalance` directly |
| W6 — `env.CURRENCY_CODE` (no hardcoded "CRD") | `mikro-wallet.repository.ts:46`, `mikro-transaction.repository.ts`, `wallet-view.mapper.ts` all use `env.CURRENCY_CODE` | VERIFIED — zero hardcoded "CRD" literals in src/ outside currency.ts default |
| P3.09 discovery — atomic UPDATE binds `em.getTransactionContext()` | `mikro-wallet.repository.ts:69` (debit), `:101` (credit), `:134` (debit-miss) — all three SQL calls pass `em.getTransactionContext()` as 4th `execute()` arg | VERIFIED — same-TX guarantee for wallet UPDATE + Transaction + outbox + inbox |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `services/wallets/tests/{integration,unit}/*.test.ts` + `setup.ts` | 35 `process.env` direct accesses violating `no-restricted-properties` ESLint rule | Info | Pre-existing test-fixture tech debt explicitly logged to `deferred-items.md` with resolution path. Out of P3.10 scope. Tests bootstrap env at top-of-file before dynamic AppModule import because Bun's runner doesn't auto-load `.env`. Not a goal blocker — Phase 3 goal is correctness of wallet service, not lint cleanliness of test fixtures. |

**Debt markers (TODO/FIXME/XXX/TBD/HACK/PLACEHOLDER) in Phase 3 source:** Zero. `grep -rE "TODO|FIXME|XXX|TBD|HACK|PLACEHOLDER" services/wallets/src/` returns no matches.

**AI fingerprints in commits (last 50):** Zero. `git log --oneline -50 | grep -iE "claude|co-authored|generated by|🤖"` returns no matches.

**Emojis in committed wallet code:** Zero. No emoji characters in `services/wallets/src/`.

---

## Live Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Docker stack health | `docker compose ps` | All 6 containers healthy (games, wallets, postgres, rabbitmq, keycloak, kong) |
| Smoke probes (Phase 1+2+3) | `bun run smoke:health` | **26/26 PASS** |
| Wallet integration suite | `cd services/wallets && INTEGRATION=1 bun test tests/integration` | **15/15 pass / 31 expect() / 3.87s** |
| Property + unit suite | `cd services/wallets && bun test tests/property tests/unit` | **27/27 pass / 10083 expect() / 316ms** |
| Kong admin route listing | `curl http://localhost:8001/routes` | 3 named routes: `wallets-provision` (POST `~/wallets$`), `wallets-me` (GET `~/wallets/me$`), `games-routes` |
| Root-level lint | `bun run lint` | 35 errors (all pre-existing in test fixtures — see Anti-Patterns) |

**Note on integration suite execution path:** Running `INTEGRATION=1 bun test services/wallets/tests/integration` from the repo root fails with a `ReferenceError: Cannot access 'AppModule' before initialization` in every test file — Bun's parallel test runner triggers a circular-import race against `app.module` when test files are batched across the workspace. The supported execution path is from the service directory (`cd services/wallets && INTEGRATION=1 bun test tests/integration`), which runs serially and goes 15/15 green. This is a test-runner workspace ergonomics quirk, not a wallet-service defect — every integration test passes correctness once it can load the module. Documented for the human verifier as a follow-up tooling item (could be addressed by extracting the integration setup to its own workspace test command in Phase 10's CI hardening pass).

---

## Open Issues Forwarded to Phase 5 (Saga Integration)

Phase 4 (Game Core) is parallel and does not consume the wallet. Phase 5 is the consumer.

1. **Saga-side dedupe contract** — Game service will consume `wallet.debited` / `wallet.credited` / `wallet.debit.rejected` from `games.wallet-events.q`. Phase 5 must wire `@IdempotentSubscribe` on the games side with the same `correlationId`-as-saga-key convention used here.
2. **Timeout compensation** — When the saga times out (`SAGA_TIMEOUT_MS=5000`) after publishing `wallet.debit`, the wallet service may eventually respond. Phase 5 must issue a compensating `wallet.credit` and rely on the inbox dedupe verified here to prevent double-effect on retry.
3. **Wallet-not-found path** — `WalletDebitHandler` emits `wallet.debit.rejected{WALLET_NOT_FOUND}` for unprovisioned players. Phase 5 saga must surface this as a discriminated error code distinct from `INSUFFICIENT_FUNDS`.
4. **Currency code symmetry** — `env.CURRENCY_CODE` is read on both services. Phase 5 must ensure the games service shares the same env value (already in `config/defaults.ts` of both).

---

## Anti-Shallow Findings

- **Goal observably true end-to-end:** A player CAN provision a wallet via Kong with a Keycloak JWT (smoke probe 24), CAN read balance (probe 25), CANNOT mutate via REST (probe 26), CAN be debited/credited via AMQP with same-TX guarantees (integration suite + atomic UPDATE bound to `em.getTransactionContext()`), CANNOT go negative (Postgres CHECK + WHERE-clause primary guard), and replays are no-ops (inbox-replay test).
- **No surface artifacts:** Wallet/Transaction aggregates carry behaviour (`provision`, `debit`, `credit`, `record`) — not anemic ORM rows. Domain has zero infra imports.
- **No hardcoded business constants:** `INITIAL_BALANCE_CENTS` and `CURRENCY_CODE` flow from `config/defaults.ts` (zod-parsed env). Searched src/ — no `"CRD"` literal outside the shared-kernel currency default and `.env.example`.
- **Same-TX guarantees observable in code, not just claimed in SUMMARY:** All four writes (inbox dedupe row, wallet UPDATE, Transaction INSERT, outbox row) flow through the decorator's `em.transactional(...)` callback via `txEm`. The raw SQL UPDATE explicitly binds to `em.getTransactionContext()` — verified by reading the repository implementation.
- **Test depth:** Property test runs 10000 cases against the pure-domain aggregate AND has a sanity-test branch that wraps an off-by-one in `expect(...).rejects.toThrow()` proving the property machinery would catch regressions. Integration tests cover all 5 SCs end-to-end, not just unit-level mocks.
- **Kong narrowing not just "documented" — provably enforced:** Admin API returns exactly 3 routes with explicit method constraints and PCRE-anchored paths. Mutation paths return Kong-origin 404 (not service-origin 404), confirming the gateway is rejecting before reaching the service.

---

## Confidence

**HIGH.** Every success criterion has multiple independent evidence sources (live probe + integration test + source-code inspection + migration DDL). No must-have artifact is a stub. No wiring is partial. No claim in the P3.09 / P3.10 SUMMARYs was found to be unsupported by code. The single non-blocking finding (35 lint errors in test fixtures) is explicitly tracked in `deferred-items.md` and does not impact the phase goal.

---

_Verified: 2026-05-25_
_Verifier: Claude (gsd-verifier, goal-backward)_
