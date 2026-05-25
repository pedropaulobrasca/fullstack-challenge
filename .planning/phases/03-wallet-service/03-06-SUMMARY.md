---
phase: 03-wallet-service
plan: 06
subsystem: wallets-amqp-mutation
tags: [amqp, rabbitmq, idempotent-subscribe, atomic-update, outbox, contracts, ddd]
requires:
  - "Plan 03-01 — patched @IdempotentSubscribe with txEm + clean envelope unwrap"
  - "Plan 03-01 — OutboxRepository.add(env, route, em?) accepts optional transactional EM"
  - "Plan 03-02 — Wallet aggregate, Transaction aggregate, repository interfaces"
  - "Plan 03-03 — wallets table (CHECK >= 0), transactions table (UNIQUE message_id, FK to wallets)"
  - "Plan 03-05 — MikroWalletRepository read paths + WALLET_REPOSITORY DI token"
  - "@crash/shared-kernel — Money VO, branded ID factories, NegativeMoneyError"
provides:
  - "MikroWalletRepository.applyDebitAtomically — conditional UPDATE WHERE balance_cents >= ? RETURNING previous_balance_cents"
  - "MikroWalletRepository.applyCreditAtomically — UPDATE RETURNING previous_balance_cents (no balance guard)"
  - "MikroTransactionRepository.append — persists immutable ledger row inside the active TX"
  - "WalletDebitHandler — AMQP consumer for wallet.debit via @IdempotentSubscribe"
  - "WalletCreditHandler — AMQP consumer for wallet.credit via @IdempotentSubscribe"
  - "@crash/contracts/wallet — five zod schemas (walletDebit/walletCredit/walletDebited/walletCredited/walletDebitRejected payloads)"
affects:
  - "Phase 5 games-service saga will consume wallet.debited / wallet.debit.rejected via these schemas"
  - "Plan 03-08 (integration tests) and the property test in Plan 03-08 (already landed under 681947c) prove this code end-to-end"
  - "TransactionRepository interface now takes AppendTransactionContext { playerId, txEm } — domain stays pure (txEm is unknown)"
tech-stack:
  added: []
  patterns:
    - "Atomic conditional UPDATE with WHERE balance_cents >= ? + RETURNING previous_balance_cents — observed pre-update balance in same round-trip (W4 plan-check fix)"
    - "Discriminated-union repo result {kind: OK | INSUFFICIENT_FUNDS | NOT_FOUND} — caller pattern-matches, no exceptions for expected business outcomes"
    - "Rowcount-0 disambiguation via follow-up SELECT to distinguish missing wallet from insufficient balance"
    - "outbox.add(env, route, txEm) — outbox row commits with wallet UPDATE + Transaction append in a single Postgres TX (W3 plan-check fix)"
    - "Domain repository interface accepts `txEm: unknown` so the application layer threads the transactional EM without leaking @mikro-orm/* into domain"
    - "Defence-in-depth payload validation: walletDebitPayloadSchema.parse at handler entry, even though parseEnvelope already ran at the decorator boundary"
    - "Saga compensation surface — INSUFFICIENT_FUNDS publishes wallet.debit.rejected event with the available balance instead of throwing"
key-files:
  created:
    - packages/contracts/src/wallet/payloads.ts
    - packages/contracts/src/wallet/index.ts
    - services/wallets/src/infrastructure/repositories/mikro-transaction.repository.ts
    - services/wallets/src/application/handlers/envelope-types.ts
    - services/wallets/src/application/handlers/wallet-debit.handler.ts
    - services/wallets/src/application/handlers/wallet-credit.handler.ts
  modified:
    - packages/contracts/src/index.ts
    - services/wallets/src/domain/wallet.repository.ts
    - services/wallets/src/domain/transaction.repository.ts
    - services/wallets/src/infrastructure/repositories/mikro-wallet.repository.ts
    - services/wallets/src/application/use-cases/tokens.ts
    - services/wallets/src/app.module.ts
decisions:
  - "ApplyDebitResult / ApplyCreditResult now carry previousBalance: Money on the OK branch — sourced from the atomic UPDATE's RETURNING (balance_cents + ?) expression, NOT reconstructed by subtracting the requested amount client-side. Closes plan-check W4."
  - "outbox.add called with the decorator's txEm so the outbox row lands in the same TX as the wallet UPDATE + Transaction append + inbox dedupe row. Closes plan-check W3."
  - "TransactionRepository.append signature is (tx: Transaction, ctx: AppendTransactionContext) — ctx carries playerId AND txEm. Required because the Transaction aggregate does not carry playerId (it carries walletId only), and the transactions table column player_id is NOT NULL. Cleaner than retrofitting playerId onto Transaction; keeps the aggregate focused on the ledger entry."
  - "INSUFFICIENT_FUNDS and NOT_FOUND both publish wallet.debit.rejected with discriminating reason field — saga compensation in Phase 5 fans out on the same routing key, no second exchange needed."
  - "WALLET_NOT_FOUND on credit publishes wallet.credit.rejected for symmetry, even though the canonical saga doesn't depend on it. Future Phase 5 saga compensation may need it."
  - "Domain repository interfaces accept `txEm: unknown` (not `EntityManager`) — the application-side repository implementation does the typecheck via instanceof. Preserves Plan 03-02's domain-purity guarantee."
metrics:
  duration_minutes: 18
  tasks_completed: 3
  files_created: 6
  files_modified: 6
  completed: 2026-05-25
---

# Phase 3 Plan 06: Wallet AMQP Mutation Path Summary

Three commits land the entire AMQP-driven mutation surface for the wallets service: shared envelope payload schemas in `@crash/contracts`, the atomic conditional UPDATE pattern in `MikroWalletRepository`, the immutable ledger append in `MikroTransactionRepository`, and two `@IdempotentSubscribe`-decorated handlers (`wallet.debit` + `wallet.credit`) that thread the transactional EM through the entire side-effect chain so the wallet UPDATE, the Transaction row, the outbox event, and the inbox dedupe row all commit in a single Postgres TX.

## What landed

### Task 1 — `@crash/contracts/wallet` (`8cdb3e0`)

Five strict zod schemas + inferred types in `packages/contracts/src/wallet/payloads.ts`:

| Schema | Fields | Used by |
|--------|--------|---------|
| `walletDebitPayloadSchema` | `{ playerId, amount: moneySnapshotSchema }` | inbound `wallet.debit` envelope |
| `walletCreditPayloadSchema` | `{ playerId, amount: moneySnapshotSchema }` | inbound `wallet.credit` envelope |
| `walletDebitedPayloadSchema` | `{ walletId (uuid), playerId, newBalance: moneySnapshotSchema }` | outbound `wallet.debited` event |
| `walletCreditedPayloadSchema` | `{ walletId, playerId, newBalance }` | outbound `wallet.credited` event |
| `walletDebitRejectedPayloadSchema` | `{ playerId, reason: enum, requested, available? }` | outbound `wallet.debit.rejected` |

`packages/contracts/src/index.ts` now re-exports `./wallet`. `bun run typecheck` exits 0.

### Task 2 — Atomic UPDATE + Transaction append (`7884b4e`)

**`MikroWalletRepository.applyDebitAtomically`** — single raw conditional UPDATE through `(txEm ?? this.em).getConnection().execute(...)`:

```sql
UPDATE wallets
SET balance_cents = balance_cents - ?, updated_at = now()
WHERE player_id = ? AND balance_cents >= ?
RETURNING id, balance_cents, (balance_cents + ?) AS previous_balance_cents
```

The third positional bind captures the observed pre-update balance in the same round-trip — `previous_balance_cents` is `(new_balance_cents + requested_amount)`. This closes plan-check W4: the Transaction row carries the actual observed previousBalance, not a value reconstructed client-side that could drift if any other writer touched the row between SELECT and UPDATE.

Rowcount-0 path runs a follow-up `SELECT id, balance_cents FROM wallets WHERE player_id = ?` to disambiguate:
- 0 rows → `{ kind: "NOT_FOUND" }`
- 1 row → `{ kind: "INSUFFICIENT_FUNDS", available: Money.of(BigInt(row.balance_cents)) }`

**`MikroWalletRepository.applyCreditAtomically`** — same shape minus the balance guard:

```sql
UPDATE wallets
SET balance_cents = balance_cents + ?, updated_at = now()
WHERE player_id = ?
RETURNING id, balance_cents, (balance_cents - ?) AS previous_balance_cents
```

Credits never fail on funds; rowcount-0 means the wallet does not exist.

**`MikroTransactionRepository.append(tx, ctx)`** — creates a `TransactionRow` via `em.create(TransactionEntitySchema, row)`, persists, flushes. `ctx.txEm` (if provided and an `EntityManager` instance) overrides the root EM so the insert participates in the handler's open TX. `ctx.playerId` supplies the column the Transaction aggregate doesn't carry.

Both repositories registered in `AppModule.providers` against the `WALLET_REPOSITORY` and new `TRANSACTION_REPOSITORY` DI tokens.

### Task 3 — Handlers (`6278d38`)

**`WalletDebitHandler.handle(envelope, _msg, txEm)`** decorated with:

```ts
@IdempotentSubscribe({
  consumerName: "wallets.debit",
  exchange: EXCHANGES.WALLET_COMMANDS,   // "wallet.commands"
  routingKey: "wallet.debit",
  queue: QUEUES.WALLET_COMMANDS,         // "wallet.commands.q"
})
```

Handler body (in execution order):

1. `walletDebitPayloadSchema.parse(envelope.payload)` — defence in depth at the trust boundary.
2. `Money.fromSnapshot(payload.amount)` and `PlayerId(payload.playerId)`.
3. `walletRepo.applyDebitAtomically(playerId, amount, txEm)`.
4. If `kind === "NOT_FOUND"` → publish `wallet.debit.rejected` with `reason: "WALLET_NOT_FOUND"` and return.
5. If `kind === "INSUFFICIENT_FUNDS"` → publish `wallet.debit.rejected` with `reason: "INSUFFICIENT_FUNDS"` + `available` snapshot and return.
6. Happy path → `Transaction.record(...)` using the observed `result.previousBalance` and `result.newBalance` directly from the atomic UPDATE.
7. `txRepo.append(transaction, { playerId, txEm })`.
8. `outbox.add(buildEnvelope({...wallet.debited...}), {exchange: WALLET_EVENTS, routingKey: "wallet.debited", aggregateType: "Wallet", aggregateId: result.walletId}, txEm)`.

**`WalletCreditHandler`** — symmetric, no INSUFFICIENT_FUNDS branch. Publishes `wallet.credited` on OK or `wallet.credit.rejected{ reason: WALLET_NOT_FOUND }` on missing wallet (kept for saga compensation symmetry).

Both handlers registered as providers in `AppModule`.

## TX-context threading — how OutboxRepository.add received the TX

`OutboxRepository.add(envelope, route, em?: EntityManager)` is the post-Plan-03-01 3-arg shape. The decorator delivers `txEm` (the EM bound to `host.em.transactional(async (txEm) => {...})`) as the third positional argument to `handle()`. Both handlers pass that same `txEm` to:

1. `walletRepo.applyDebitAtomically(playerId, amount, txEm)` → atomic UPDATE participates in the open TX.
2. `txRepo.append(transaction, { playerId, txEm })` → Transaction insert participates in the open TX.
3. `outbox.add(envelope, route, txEm)` → outbox row persisted via `txEm.persist(row)` (W3 fix in `outbox-repository.ts:47`).

The inbox dedupe row was already in this TX (decorator opens the TX *before* `inbox.tryClaim`, so the row is appended inside it). Net effect: one Postgres TX commits the inbox dedupe row, the wallet balance UPDATE, the Transaction ledger row, and the outbox event row together — or nothing at all.

## NOT_FOUND vs INSUFFICIENT_FUNDS resolution

The conditional UPDATE's WHERE clause is `player_id = ? AND balance_cents >= ?`. Rowcount 0 is ambiguous — it could mean the wallet doesn't exist OR the wallet exists but lacks funds. The repository disambiguates with a single follow-up SELECT against the same TX:

```sql
SELECT id, balance_cents FROM wallets WHERE player_id = ?
```

- 0 rows → wallet does not exist → `{ kind: "NOT_FOUND" }` → handler publishes `wallet.debit.rejected{ reason: "WALLET_NOT_FOUND" }`.
- 1 row → wallet exists, balance below requested → `{ kind: "INSUFFICIENT_FUNDS", available: Money }` → handler publishes `wallet.debit.rejected{ reason: "INSUFFICIENT_FUNDS", available }`.

Both branches return *without throwing*. The saga in Phase 5 compensates based on the `reason` discriminator on the same routing key.

## Routing keys and exchanges (catalog)

| Direction | Routing key | Exchange | Queue (bound) | Schema |
|-----------|------------|----------|---------------|--------|
| Inbound (command) | `wallet.debit` | `EXCHANGES.WALLET_COMMANDS` (`wallet.commands`) | `QUEUES.WALLET_COMMANDS` (`wallet.commands.q`) | `walletDebitPayloadSchema` |
| Inbound (command) | `wallet.credit` | `EXCHANGES.WALLET_COMMANDS` | `QUEUES.WALLET_COMMANDS` | `walletCreditPayloadSchema` |
| Outbound (event) | `wallet.debited` | `EXCHANGES.WALLET_EVENTS` (`wallet.events`) | n/a (publishers don't bind) | `walletDebitedPayloadSchema` |
| Outbound (event) | `wallet.credited` | `EXCHANGES.WALLET_EVENTS` | n/a | `walletCreditedPayloadSchema` |
| Outbound (event) | `wallet.debit.rejected` | `EXCHANGES.WALLET_EVENTS` | n/a | `walletDebitRejectedPayloadSchema` |
| Outbound (event) | `wallet.credit.rejected` | `EXCHANGES.WALLET_EVENTS` | n/a | `walletDebitRejectedPayloadSchema` (shared) |

Topology bindings for the two inbound routing keys are already declared in `AppModule` (Phase 2 wiring untouched).

## Threat mitigations confirmed

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-03-21 (Tampering — balance race on concurrent debits) | `UPDATE ... WHERE balance_cents >= ?` is atomic; rowcount 0 unambiguously signals insufficiency; no SELECT-then-UPDATE window |
| T-03-22 (Tampering — replay attack) | `@IdempotentSubscribe` inbox dedupe via `UNIQUE (consumer_name, message_id)` runs *before* handler body — replay never reaches the side-effect block |
| T-03-23 (Tampering — outbox outside the side-effect TX) | `outbox.add(env, route, txEm)` — the third arg threads the decorator's transactional EM; outbox row commits with the wallet UPDATE in a single TX |
| T-03-24 (Tampering — forged envelope payload) | `walletDebitPayloadSchema.parse` and `walletCreditPayloadSchema.parse` at handler entry; payload type/shape mismatches throw, decorator routes to DLX (Nack(false)) |
| T-03-25 (Info Disclosure — bigint JSON serialization) | All Money on the outbox payload uses `Money.toSnapshot()` — wire format is always `{ amount: string, currency: string, scale: number }` |
| T-03-26 (Repudiation — lost Transaction row) | `txRepo.append(tx, { playerId, txEm })` runs `em.persist + em.flush` on the transactional EM; UNIQUE(message_id) on the transactions table blocks duplicate inserts at the DB; the TX commits the row with the wallet UPDATE atomically |

## Deviations from Plan

**1. [Rule 3 — Blocker] Transaction aggregate does not carry playerId, but the `transactions` table requires it**

- **Found during:** Task 2 (MikroTransactionRepository implementation).
- **Issue:** The Plan 03-03 `transactions` table has `player_id TEXT NOT NULL`. The Plan 03-02 `Transaction` aggregate only carries `walletId` — there is no `playerId` field on the aggregate or its snapshot. The plan said `append(transaction)` would suffice, but the row build can't satisfy NOT NULL `player_id` without it.
- **Fix:** Extended the `TransactionRepository.append` signature to `(tx, ctx: AppendTransactionContext)` where `AppendTransactionContext = { playerId, txEm? }`. Domain stays pure — the context type lives in `transaction.repository.ts` and `playerId` flows from the handler (which already has it from `payload.playerId`). The alternative — adding `playerId` to the Transaction aggregate — would have polluted the ledger entry with a denormalised field; cleaner to thread it through the persistence boundary instead. Plan 03-02's `Transaction` shape is untouched.
- **Files modified:** `services/wallets/src/domain/transaction.repository.ts`, `services/wallets/src/infrastructure/repositories/mikro-transaction.repository.ts`.
- **Commit:** `7884b4e`.

**2. [Rule 3 — Type] Repository interface signatures had to accept `txEm: unknown`**

- **Found during:** Task 2.
- **Issue:** The plan's repository interface signatures imply `txEm?: EntityManager` (a `@mikro-orm/postgresql` type), but `domain/wallet.repository.ts` and `domain/transaction.repository.ts` are domain-layer files with the documented "zero infra imports" rule from `CLAUDE.md` and Plan 03-02 SUMMARY (`grep -rnE "^import.*(@nestjs|@mikro-orm|...)" services/wallets/src/domain/ # exit 1 — no matches`).
- **Fix:** Domain interfaces type `txEm` as `unknown`. The infrastructure-layer `MikroWalletRepository` / `MikroTransactionRepository` do an `instanceof EntityManager` runtime check inside a `resolveEm` helper and fall back to the root EM if the passed value is not an EntityManager. Application-layer handlers pass the real `EntityManager` (from the decorator's transactional callback), so the typecheck succeeds at the call site while the domain stays infrastructure-free.
- **Files modified:** `services/wallets/src/domain/wallet.repository.ts`, `services/wallets/src/domain/transaction.repository.ts`.
- **Commit:** `7884b4e`.

**3. [Rule 2 — Critical] Discriminated-union return type extended with `previousBalance` and `available`**

- **Found during:** Task 2 (closing plan-check W4).
- **Issue:** Plan 03-02's `ApplyDebitResult` was `{ kind: "OK"; walletId; newBalance } | { kind: "INSUFFICIENT_FUNDS" } | { kind: "NOT_FOUND" }`. The plan-check W4 fix requires the OK branch to carry `previousBalance` (so `Transaction.record` gets the observed value, not a reconstructed one). Additionally, the INSUFFICIENT_FUNDS branch needs `available` so the rejection envelope can carry it to the saga.
- **Fix:** `ApplyDebitResult` now includes `previousBalance: Money` on OK and `available: Money` on INSUFFICIENT_FUNDS. `ApplyCreditResult` includes `previousBalance: Money` on OK for symmetry.
- **Files modified:** `services/wallets/src/domain/wallet.repository.ts`.
- **Commit:** `7884b4e`.

No Rule 1 (bug) or Rule 4 (architectural) deviations triggered.

## Pre-existing test failure (out of scope)

`services/wallets/tests/unit/provision-wallet.use-case.test.ts` is untracked in git (not committed by any prior plan), and fails on `bun test` with a `defaults.ts` env-load `ZodError` (missing `DATABASE_URL`, `RABBITMQ_URL`, `KEYCLOAK_*`). This failure existed *before* any change in this plan — confirmed via `git stash && bun test` showing the same `1 fail`. The file appears to be a leftover from prior wave authoring; it is unrelated to P3.06 scope (Wave 4 boundary: `services/wallets/src/infrastructure/repositories/`, `services/wallets/src/application/handlers/`, `services/wallets/src/app.module.ts`, `packages/contracts/src/wallet/`). Logging to phase-level deferred items for the verify phase to triage — it's likely either a test that needs env-fixture wiring or a stale draft to delete.

## Authentication gates

None. Plan was offline (typecheck + unit tests + static greps). No external service calls attempted.

## Verification snapshot

```text
$ cd packages/contracts && bun run typecheck
$ tsc --noEmit
(exit 0)

$ cd services/wallets && bunx tsc --noEmit -p tsconfig.json
(exit 0)

$ grep -nE 'wallet\.debit|wallet\.credit|wallet\.debited|wallet\.credited|wallet\.debit\.rejected' services/wallets/src/application/handlers/*.ts | wc -l
14

$ grep -n 'balance_cents >= ' services/wallets/src/infrastructure/repositories/mikro-wallet.repository.ts
65:         WHERE player_id = ? AND balance_cents >= ?

$ grep -nE '@IdempotentSubscribe\(' services/wallets/src/application/handlers/wallet-debit.handler.ts services/wallets/src/application/handlers/wallet-credit.handler.ts
services/wallets/src/application/handlers/wallet-debit.handler.ts:44:  @IdempotentSubscribe({
services/wallets/src/application/handlers/wallet-credit.handler.ts:44:  @IdempotentSubscribe({
```

All four `must_haves.truths` from the plan frontmatter that don't require a live broker are satisfied by the code:

1. `WalletDebitHandler.handle` accepts `(envelope, msg, txEm)` and `@IdempotentSubscribe` declares `consumerName: "wallets.debit"`, `exchange: WALLET_COMMANDS`, `routingKey: "wallet.debit"`, `queue: WALLET_COMMANDS`.
2. Debit happy path code: atomic UPDATE → `txRepo.append(tx, {playerId, txEm})` → `outbox.add(walletDebitedEnvelope, route, txEm)` — three writes, one TX.
3. Debit INSUFFICIENT_FUNDS code: balance unchanged (rowcount 0), no Transaction insert, `outbox.add(walletDebitRejectedEnvelope{reason: INSUFFICIENT_FUNDS}, route, txEm)`.
4. Credit happy path code: symmetric structure to debit.
5. Replay no-op is enforced by the decorator's `inbox.tryClaim` inside the open TX — code lives in `idempotent-subscribe.decorator.ts:124-130`, no per-handler implementation needed.
6. `applyDebitAtomically` uses `WHERE balance_cents >= ?` — line 65 of `mikro-wallet.repository.ts`.

Runtime end-to-end proof (publishing real envelopes through RabbitMQ) is the remit of Plan 03-08 (integration tests) and `/gsd:verify-phase 3`.

## Commits

| Commit | Task | Description |
|--------|------|-------------|
| `8cdb3e0` | Task 1 | `@crash/contracts/wallet` — five zod payload schemas + inferred types |
| `7884b4e` | Task 2 | Atomic UPDATE debit/credit + Transaction append repository; ApplyDebitResult/ApplyCreditResult extended with previousBalance |
| `6278d38` | Task 3 | WalletDebitHandler + WalletCreditHandler via @IdempotentSubscribe; AppModule registers both |

## Known Stubs

None. Every code path is real:
- Repository methods execute real SQL against the active EM (no `throw "not yet implemented"`).
- Handlers parse-validate-mutate-publish on every branch; no TODO markers.
- Contract schemas are strict and have inferred types ready for the games-service consumer in Phase 5.

## Deferred / open items

- Plan 03-08 (already in flight in Wave 4) provides the fast-check property test that exercises `applyDebitAtomically` semantics via the domain `Wallet.debit/credit` predicate.
- Integration tests (Plan 03-09 per RESEARCH) prove the end-to-end AMQP round-trip — out of scope for this plan.
- `provision-wallet.use-case.test.ts` env-fixture failure noted above for the verify phase.

## Self-Check: PASSED

- `packages/contracts/src/wallet/payloads.ts` — FOUND
- `packages/contracts/src/wallet/index.ts` — FOUND
- `services/wallets/src/infrastructure/repositories/mikro-transaction.repository.ts` — FOUND
- `services/wallets/src/application/handlers/envelope-types.ts` — FOUND
- `services/wallets/src/application/handlers/wallet-debit.handler.ts` — FOUND
- `services/wallets/src/application/handlers/wallet-credit.handler.ts` — FOUND
- Commit `8cdb3e0` — FOUND in `git log`
- Commit `7884b4e` — FOUND in `git log`
- Commit `6278d38` — FOUND in `git log`
- `bun run typecheck` (packages/contracts) — exit 0
- `bunx tsc --noEmit -p tsconfig.json` (services/wallets) — exit 0
- `grep 'balance_cents >= ' mikro-wallet.repository.ts` — 1 hit (line 65)
- `grep '@IdempotentSubscribe(' wallet-{debit,credit}.handler.ts` — 2 hits
- All five routing keys present in handler files (`wallet.debit`, `wallet.credit`, `wallet.debited`, `wallet.credited`, `wallet.debit.rejected`)
