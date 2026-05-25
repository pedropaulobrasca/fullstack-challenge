---
phase: 03-wallet-service
plan: 03
subsystem: wallet + transaction persistence schema (EntitySchema + Postgres DDL)
tags: [schema, mikro-orm, entity-schema, postgres, migrations, wallets, transactions, ledger]
requires:
  - "@mikro-orm/core@7.1.0, @mikro-orm/migrations@7.1.0"
  - "Phase 2 messaging-spine schemas already registered in mikro-orm.config"
provides:
  - "WalletRow EntitySchema mapping the wallets table"
  - "TransactionRow EntitySchema mapping the transactions table (immutable, no onUpdate)"
  - "Migration 20260525001 creating wallets with CHECK(balance_cents >= 0) and UNIQUE(player_id)"
  - "Migration 20260525002 creating transactions with UNIQUE(message_id), FK to wallets, indexes on (wallet_id, applied_at DESC) and (correlation_id)"
  - "mikro-orm.config.ts now registers WalletEntitySchema + TransactionEntitySchema alongside the three messaging schemas"
affects:
  - services/wallets/src/application (Plan 03-05/03-06 will consume the schemas via repository)
  - services/wallets/src/infrastructure/repositories (Plan 03-06 will type-parameterize against WalletRow/TransactionRow)
tech-stack:
  added: []
  patterns:
    - "EntitySchema (not decorators) — same convention as Phase 2 spine entities"
    - "POJO row class + paired *EntitySchema constant per file"
    - "BigIntType from @mikro-orm/core for *_cents columns (string round-trip preserves bigint precision)"
    - "camelCase TS field + fieldName override to snake_case SQL column"
    - "onCreate / onUpdate hooks only on WalletEntitySchema; Transaction stays immutable"
    - "DB CHECK as fail-closed backstop alongside domain invariant (defence in depth for REQ-DOM-03)"
    - "UNIQUE(message_id) on transactions as defensive idempotency alongside Phase 2 inbox dedup"
key-files:
  created:
    - services/wallets/src/infrastructure/persistence/wallet.entity.ts
    - services/wallets/src/infrastructure/persistence/transaction.entity.ts
    - services/wallets/src/infrastructure/mikro-orm/migrations/20260525001-create-wallets.ts
    - services/wallets/src/infrastructure/mikro-orm/migrations/20260525002-create-transactions.ts
    - .planning/phases/03-wallet-service/03-03-SUMMARY.md
  modified:
    - services/wallets/mikro-orm.config.ts
decisions:
  - "EntitySchema (no decorators) — mirrors Phase 2 spine pattern; MikroORM 7.1 has no @Entity/@Property exports"
  - "BigIntType for balance_cents, amount_cents, previous_balance_cents, new_balance_cents — keeps bigint round-trip safe via string"
  - "Repository layer (Plan 03-06) handles Money <-> bigint conversion; EntitySchema stays pure persistence"
  - "TransactionEntitySchema has zero onUpdate hooks — append-only ledger per REQ-WALL-07"
  - "wallets.currency_code has length 3 + CHECK (length(currency_code) = 3) — single-currency CRD enforced at column level"
  - "transactions.amount_cents has CHECK (amount_cents > 0) — zero / negative amounts impossible at DB level (cents are unsigned at the ledger row)"
  - "transactions.wallet_id ON DELETE RESTRICT — wallet rows are never deleted while ledger entries reference them"
  - "Composite index transactions(wallet_id, applied_at DESC) — supports the Plan 03-06 'latest ledger entry by wallet' read path"
metrics:
  duration_minutes: 7
  tasks_completed: 3
  files_created: 4
  files_modified: 1
  completed: 2026-05-25
---

# Phase 03 Plan 03: Wallet/Transaction Persistence Schema Summary

MikroORM EntitySchema definitions plus two Postgres migrations giving Phase 3 its storage substrate — `wallets` (single-row snapshot with `CHECK (balance_cents >= 0)` + `UNIQUE (player_id)`) and `transactions` (append-only ledger with `UNIQUE (message_id)` + FK to wallets). Schemas registered in `mikro-orm.config.ts` so the next `bun run docker:up` migrate step creates both tables.

---

## What landed

### EntitySchemas (Task 1, commit `bf31149`)

**`services/wallets/src/infrastructure/persistence/wallet.entity.ts`**

POJO `WalletRow` + `WalletEntitySchema`. Mapping:

| TS field | SQL column | Type | Notes |
|----------|-----------|------|-------|
| `id` | `id` | `uuid` | Primary |
| `playerId` | `player_id` | `string` | `unique: true` |
| `balanceCents` | `balance_cents` | `BigIntType` | bigint round-trip via string |
| `currencyCode` | `currency_code` | `string(3)` | length 3 (`CRD`) |
| `createdAt` | `created_at` | `Date` | `defaultRaw: 'now()'`, `onCreate` |
| `updatedAt` | `updated_at` | `Date` | `defaultRaw: 'now()'`, `onCreate`, `onUpdate` |

**`services/wallets/src/infrastructure/persistence/transaction.entity.ts`**

POJO `TransactionRow` + `TransactionEntitySchema`. Mapping:

| TS field | SQL column | Type | Notes |
|----------|-----------|------|-------|
| `id` | `id` | `uuid` | Primary |
| `walletId` | `wallet_id` | `uuid` | FK to wallets(id) |
| `playerId` | `player_id` | `string` | |
| `kind` | `kind` | `string` | `'DEBIT' \| 'CREDIT'` literal type |
| `amountCents` | `amount_cents` | `BigIntType` | |
| `currencyCode` | `currency_code` | `string(3)` | |
| `previousBalanceCents` | `previous_balance_cents` | `BigIntType` | |
| `newBalanceCents` | `new_balance_cents` | `BigIntType` | |
| `correlationId` | `correlation_id` | `string` | |
| `messageId` | `message_id` | `string` | `unique: true` (idempotency backstop) |
| `appliedAt` | `applied_at` | `Date` | `defaultRaw: 'now()'`, no `onUpdate` |

Indexes:
- `transactions_wallet_id_applied_at_idx ON (walletId, appliedAt)`
- `transactions_correlation_id_idx ON (correlationId)`

`grep -nE "@nestjs|@crash/shared-kernel" services/wallets/src/infrastructure/persistence/*.ts` returns no hits — entities are pure persistence shapes.

### Migrations (Task 2, commit `7787fff`)

**`20260525001-create-wallets.ts`** — `up()`:

```sql
CREATE TABLE wallets (
  id UUID PRIMARY KEY,
  player_id TEXT NOT NULL UNIQUE,
  balance_cents BIGINT NOT NULL,
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallets_balance_non_negative CHECK (balance_cents >= 0)
);
CREATE INDEX wallets_player_id_idx ON wallets(player_id);
```

`down()` drops the table with `CASCADE`.

**`20260525002-create-transactions.ts`** — `up()`:

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DEBIT', 'CREDIT')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code TEXT NOT NULL,
  previous_balance_cents BIGINT NOT NULL,
  new_balance_cents BIGINT NOT NULL,
  correlation_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transactions_wallet_id_applied_at_idx ON transactions(wallet_id, applied_at DESC);
CREATE INDEX transactions_correlation_id_idx ON transactions(correlation_id);
```

`down()` drops the table with `CASCADE`.

Required-token grep (Task 2 verify) returns all three (`balance_cents >= 0`, `UNIQUE`, `REFERENCES wallets`).

### Config registration (Task 3, commit `86f9f59`)

`services/wallets/mikro-orm.config.ts` now imports `WalletEntitySchema` and `TransactionEntitySchema` and appends both to `entities` and `entitiesTs` (preserving the three Phase 2 messaging schemas).

`grep -nE 'WalletEntitySchema|TransactionEntitySchema' mikro-orm.config.ts | wc -l` returns 6 (>= 4 required: each schema appears once in imports + once in each of the two arrays).

---

## Constraints created (REQ traceability)

| Constraint | Backs | DDL location |
|------------|-------|--------------|
| `CHECK (balance_cents >= 0)` on wallets | REQ-DOM-03 (DB-level fail-closed backstop for balance invariant) | `20260525001-create-wallets.ts:13` |
| `UNIQUE (player_id)` on wallets | Provisioning idempotency (T-03-09 mitigation) | `20260525001-create-wallets.ts:8` |
| `CHECK (length(currency_code) = 3)` on wallets | Single-currency CRD invariant | `20260525001-create-wallets.ts:9` |
| `CHECK (kind IN ('DEBIT','CREDIT'))` on transactions | Ledger kind literal | `20260525002-create-transactions.ts:9` |
| `CHECK (amount_cents > 0)` on transactions | Ledger entry has non-zero amount | `20260525002-create-transactions.ts:10` |
| `UNIQUE (message_id)` on transactions | REQ-WALL-07 idempotency backstop (T-03-10 mitigation) | `20260525002-create-transactions.ts:16` |
| `wallet_id REFERENCES wallets(id) ON DELETE RESTRICT` | Ledger integrity — wallets can't be deleted while transactions reference them | `20260525002-create-transactions.ts:8` |

---

## Deviations from Plan

### Task 1 verify command substitution

- **Found during:** Task 1
- **Issue:** Plan said `bun run typecheck` from `services/wallets`. The `services/wallets/package.json` does not declare a `typecheck` script — only the root `package.json` does.
- **Fix:** Ran `bunx tsc --noEmit -p tsconfig.json` from inside `services/wallets` instead (equivalent to the root script). Exit 0. No script files added — root `typecheck` covers all workspaces, and adding a per-service script is out of scope for this plan.
- **Files modified:** none
- **Commit:** n/a (verification only)

### Task 3 migration:list step skipped (CLI cannot load TS config)

- **Found during:** Task 3
- **Issue:** `bunx mikro-orm migration:list` failed with "Neither oxc, swc, tsx, jiti nor tsimp found" and "MikroORM config file not found in ['./dist/mikro-orm.config.js', './mikro-orm.config.js']". The MikroORM CLI does not ship a TS loader by default; the project doesn't pin one because migrations are executed by the docker wallets-migrate container, not the host CLI.
- **Fix:** Same posture as Phase 2 — accept that the CLI requires a TS loader plugin we don't install. The migrations are valid TS files extending `Migration`, placed in the configured `migrations.path`, and will be picked up at boot by the migrate container's runtime (which bootstraps via Bun in the application module, not the standalone CLI). Docker stack was not up during this plan, so the runtime confirmation defers to the next `bun run docker:up` or to Plan 03-06's repository tests.
- **Files modified:** none
- **Commit:** n/a (verification adjustment)
- **Impact:** zero functional impact; confirmed by static-file inspection that both migration files exist with the expected `up()` / `down()` bodies and the config arrays include both schemas.

No auto-fixed bugs (Rules 1–3) — pre-existing TypeScript errors in `src/domain/wallet.repository.ts` and `src/domain/transaction.repository.ts` referencing `./wallet.aggregate` / `./transaction.aggregate` were observed during the initial typecheck. Those modules were authored by parallel Wave-2 plans (`03-02`) and committed during this plan's execution. By the time Task 3 completed, those aggregate files had landed and the typecheck went clean.

---

## Authentication gates

None. Plan was offline (file authoring + tsc + static greps).

---

## Verification results

| Check | Result |
|-------|--------|
| `bunx tsc --noEmit -p tsconfig.json` in `services/wallets` (after parallel waves landed) | exit 0 |
| `grep -nE "@nestjs\|@crash/shared-kernel" services/wallets/src/infrastructure/persistence/*.ts` | no hits (entities have zero forbidden imports) |
| `grep -nE 'balance_cents >= 0\|UNIQUE\|REFERENCES wallets' services/wallets/src/infrastructure/mikro-orm/migrations/20260525*-*.ts` | all three tokens found |
| `grep -nE 'WalletEntitySchema\|TransactionEntitySchema' services/wallets/mikro-orm.config.ts` line count | 6 (>= 4 required) |
| Migration files placed in `services/wallets/src/infrastructure/mikro-orm/migrations/` (the configured `migrations.path`) | confirmed via `ls` |
| Three commits landed without AI attribution / emojis | confirmed via `git log --oneline` |

Deferred to next compose run:
- `wallets-migrate` container exit 0 after applying 20260525001 + 20260525002.
- `docker exec wallets-postgres psql -c "\d wallets"` showing the `wallets_balance_non_negative` CHECK constraint.
- `docker exec wallets-postgres psql -c "\d transactions"` showing the FK to wallets and UNIQUE(message_id).

These are runtime-only checks that require `bun run docker:up`; they aren't gates for this plan since the migrations are static SQL and any DDL syntax error would surface to Plan 03-06's integration tests.

---

## Commits

| Commit | Task | Description |
|--------|------|-------------|
| `bf31149` | Task 1 | EntitySchemas for `wallets` and `transactions` tables |
| `7787fff` | Task 2 | Migrations creating `wallets` (CHECK + UNIQUE) and `transactions` (UNIQUE + FK + indexes) |
| `86f9f59` | Task 3 | Register `WalletEntitySchema` + `TransactionEntitySchema` in `mikro-orm.config.ts` |

---

## Self-Check: PASSED

- `services/wallets/src/infrastructure/persistence/wallet.entity.ts` — FOUND
- `services/wallets/src/infrastructure/persistence/transaction.entity.ts` — FOUND
- `services/wallets/src/infrastructure/mikro-orm/migrations/20260525001-create-wallets.ts` — FOUND
- `services/wallets/src/infrastructure/mikro-orm/migrations/20260525002-create-transactions.ts` — FOUND
- Commit `bf31149` — FOUND in `git log --oneline`
- Commit `7787fff` — FOUND in `git log --oneline`
- Commit `86f9f59` — FOUND in `git log --oneline`
