# ADR-011: Ledger model — Wallet snapshot + immutable Transaction aggregate over event sourcing

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 3

## Context

REQ-WALL-07 demands an immutable ledger row per debit/credit referencing the source command. REQ-DOM-03 requires O(1) balance reads on every wallet endpoint and AMQP consume — `GET /wallets/me` must return in single-row latency, and the AMQP debit/credit handlers (Plan 03-06) must read the pre-mutation balance inside a single conditional UPDATE round-trip without rebuilding state from a stream. REQ-DOM-05 + the Plan 03-03 Postgres `CHECK (balance_cents >= 0)` constraint require the database to enforce non-negativity directly on the balance column.

These three requirements collide on a single architectural choice: where does balance live? Three persistence shapes were on the table when Plan 03-02 modelled the domain layer.

The 25% architecture / DDD scoring band in the recruiter rubric matters here twice: once for picking a shape the arguição can defend, and once for keeping the ledger guarantees observable in a single SQL round-trip rather than buried inside a projector. Phase 3 also runs in parallel with Phase 4 (the Game core), so the chosen shape must not impose cross-aggregate read coupling that would force Phase 4 to wait on Phase 3 projections.

## Considered

- **Full event sourcing** — `Wallet` is rehydrated from a `wallet_events` stream on every read; the balance is derived, never stored. Pure DDD, audit-perfect, supports time travel out of the box. Costs: every read pays the rebuild; every debit/credit must replay before mutating; the conditional `UPDATE ... WHERE balance_cents >= ?` pattern from Plan 03-06 has no analogue (the column doesn't exist); snapshots become mandatory to recover read latency, and snapshots are *exactly* a balance column with extra ceremony. Recruiter-defensible but over-engineered for the requirement set — no time travel asked, no projection store, no replay UI.
- **Transactions-only, no snapshot** — `Wallet` is a row of metadata (id, playerId, currency, createdAt) with no balance column; balance is `SUM(amount) FROM transactions WHERE wallet_id = ?` on every read. Aggregation per read; the Postgres `CHECK (balance_cents >= 0)` from Plan 03-03 has nowhere to attach (you can't put a CHECK on an aggregate expression — only on a column); the atomic-debit pattern from Plan 03-06 disappears because the WHERE clause becomes a subquery against the same table being mutated, opening a race window the `UPDATE ... WHERE balance_cents >= ?` form closes natively.
- **Wallet snapshot + immutable Transaction in same DB TX (chosen)** — `wallets.balance_cents` is a mutable snapshot; every debit/credit (a) appends an immutable `transactions` row referencing `correlationId` + `message_id` and (b) updates the snapshot, both inside the decorator's `em.transactional(...)` callback. Reads cost a single-row lookup. The CHECK constraint attaches to the snapshot column. The atomic UPDATE pattern reduces the debit happy path to one round-trip. The `transactions(message_id) UNIQUE` constraint from Plan 03-03 plus the Phase 2 inbox dedupe row together make the ledger insert idempotent at two levels.

## Decision

**Wallet snapshot + immutable Transaction aggregate, written together in a single Postgres transaction.**

`wallets` table (Plan 03-03 migration `Migration20260525101000_CreateWallets`):

- `id UUID PK`, `player_id TEXT UNIQUE NOT NULL`, `balance_cents BIGINT NOT NULL`, `currency_code TEXT NOT NULL`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`.
- `CHECK (balance_cents >= 0)` is the defence-in-depth backstop — the conditional UPDATE WHERE clause is the primary guard, the CHECK fires if any future writer skips the WHERE.

`transactions` table (same migration):

- `id UUID PK`, `wallet_id UUID FK NOT NULL`, `player_id TEXT NOT NULL`, `kind TEXT NOT NULL` (`DEBIT` / `CREDIT`), `amount_cents BIGINT NOT NULL`, `previous_balance_cents BIGINT NOT NULL`, `new_balance_cents BIGINT NOT NULL`, `correlation_id TEXT NOT NULL`, `message_id TEXT NOT NULL`, `occurred_at TIMESTAMPTZ NOT NULL`.
- `UNIQUE (message_id)` — even if the inbox layer above is bypassed, the ledger refuses a duplicate insert.

Write path (Plan 03-06 `WalletDebitHandler` / `WalletCreditHandler`):

1. The `@IdempotentSubscribe` decorator opens `host.em.transactional(async (txEm) => {...})`.
2. `inbox.tryClaim(consumerName, messageId, txEm)` inserts the inbox dedupe row.
3. `walletRepository.applyDebitAtomically(playerId, amount, txEm)` runs one raw SQL `UPDATE wallets SET balance_cents = balance_cents - ?, updated_at = now() WHERE player_id = ? AND balance_cents >= ? RETURNING id, balance_cents, (balance_cents + ?) AS previous_balance_cents`, bound to the open TX via `em.getConnection().execute(sql, params, "all", em.getTransactionContext())` (Plan 03-09 fix for autocommit).
4. `transactionRepository.append(transaction, { playerId, txEm })` persists the immutable ledger row inside the same TX.
5. `outbox.add(envelope, route, txEm)` appends the `wallet.debited` / `wallet.credited` event row inside the same TX.

All four writes commit or none do. Read path (`GET /wallets/me`, Plan 03-05) is a single-row `findOne` against the `wallets` snapshot — no aggregation, no rebuild.

Rationale, per 03-RESEARCH §Summary + §"Decisions to Make in Phase 3" + the Plan 03-06 SUMMARY's W3/W4 deviations: the snapshot column carries the invariant the CHECK constraint enforces; the immutable transactions row carries the audit guarantee REQ-WALL-07 requires; together they preserve the property test's zero-net invariant (Plan 03-08, 10_000 fast-check cases) without ever rebuilding state. Event sourcing's rebuild cost has no payoff in a system without time-travel UX, and transactions-only loses both the DB-level invariant and the atomic-debit round-trip. The chosen shape is what every production wallet ledger looks like (Plaid, Stripe internal balance ledger, Square wallet) — a snapshot with an append-only audit trail co-written in one transaction.

## Consequences

- **Locked in**: `wallets` table carries `balance_cents` as the authoritative snapshot; `transactions` table is append-only (no DELETE / UPDATE path exists in any repository method); every mutation handler MUST go through the four-write same-TX dance (inbox claim → wallet UPDATE → transaction append → outbox add); the conditional `UPDATE ... WHERE balance_cents >= ?` pattern is the only debit path (any future "subtract via load-then-save" code would be a Rule-1 bug).
- **Foreclosed**: full event sourcing (would require dropping `balance_cents`, rewriting Plan 03-05 read paths, replacing the atomic UPDATE with a replay-then-mutate dance — multi-week refactor); transactions-only without snapshot (no DB-level non-negativity guarantee, no atomic conditional UPDATE).
- **Audit trail**: `transactions(message_id) UNIQUE` + `correlation_id` indexed lets the recruiter trace any saga's effect on the ledger via correlationId; replay safety is double-anchored (Phase 2 inbox dedupe + UNIQUE message_id on the ledger).
- **Property test surface**: Plan 03-08 (commit `681947c`) hammers the pure-domain `Wallet.debit/credit` predicate with 10_000 fast-check cases asserting zero-net sequences preserve balance — the property is meaningful precisely because balance is a single mutable value, not a derived projection.
- **Operational cost**: two writes per mutation instead of one (snapshot UPDATE + transaction INSERT); both inside the same TX so the latency cost is one network round-trip plus the WAL flush, well within the smoke-probe targets.
- **Anticipated recruiter question**: "Why not event-sourced?" — defended by the no-time-travel-required scope, the atomic-debit round-trip argument, and the property that the snapshot+ledger shape preserves every invariant event sourcing would preserve while keeping reads O(1).

## Alternatives Rejected

- **Full event sourcing** — rebuild cost on every read; the atomic conditional `UPDATE ... WHERE balance_cents >= ?` round-trip from Plan 03-06 has no analogue; snapshots would have to be reintroduced anyway to recover read latency.
- **Transactions-only, no snapshot** — no column for the Postgres `CHECK (balance_cents >= 0)` to attach to; the WHERE-clause race-free debit pattern becomes a subquery against the same mutated table.
- **Transaction as a child entity of Wallet (not its own aggregate)** — would force `WalletRepository.load(playerId)` to hydrate the entire transaction history just to apply one debit; aggregate boundary smear; rejected at Plan 03-02 design time.
