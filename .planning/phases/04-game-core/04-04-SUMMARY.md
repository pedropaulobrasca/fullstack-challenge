---
phase: 04-game-core
plan: 04
subsystem: games-persistence
tags: [persistence, mikro-orm, migration, ddl, partial-unique-index, fsm-check, atomic-update]
dependency-graph:
  requires:
    - Plan 04-02 (Round aggregate + RoundRepository + SeedChainRepository interfaces)
    - Plan 04-03 (Bet aggregate + BetRepository interface)
    - Phase 3 P3.09 pattern (em.getTransactionContext() bound atomic UPDATE)
  provides:
    - services/games/src/infrastructure/persistence/seed-chain.entity.ts (SeedChainEntitySchema, nonce BIGINT PK)
    - services/games/src/infrastructure/persistence/round.entity.ts (RoundEntitySchema, crash_point_centi_x INT scale times 100)
    - services/games/src/infrastructure/persistence/bet.entity.ts (BetEntitySchema, partial unique enforced at DB layer)
    - services/games/src/infrastructure/mikro-orm/migrations/20260526001-create-seed-chain.ts
    - services/games/src/infrastructure/mikro-orm/migrations/20260526002-create-rounds.ts (rounds_fsm_check 4-arm)
    - services/games/src/infrastructure/mikro-orm/migrations/20260526003-create-bets.ts (bets_one_active_per_player, bets_status_check)
    - services/games/src/infrastructure/repositories/mikro-seed-chain.repository.ts
    - services/games/src/infrastructure/repositories/mikro-round.repository.ts
    - services/games/src/infrastructure/repositories/mikro-bet.repository.ts
    - services/games/src/application/tokens.ts (ROUND_REPOSITORY, BET_REPOSITORY, SEED_CHAIN_REPOSITORY DI tokens)
  affects:
    - services/games/mikro-orm.config.ts (entities and entitiesTs arrays extended)
    - Plan 04-05 (seed chain bootstrap will consume insertChain batching)
    - Plan 04-06 (round loop module wiring will register the three repos against the DI tokens)
    - Phase 5 saga (Bet.place consumer will hit bets_one_active_per_player and translate SQLSTATE 23505)
tech-stack:
  added:
    - "(none; reuses MikroORM 7.1 + @mikro-orm/postgresql + @mikro-orm/migrations already on Phase 3 baseline)"
  patterns:
    - "EntitySchema<Row> with fieldName mapping for snake_case columns (mirrors WalletEntitySchema)"
    - "Migration class extends @mikro-orm/migrations Migration; addSql() per DDL block + per index"
    - "em.getConnection().execute(sql, params, 'all'|'run', em.getTransactionContext()) for raw SQL paths"
    - "resolveEm(txEm) helper for optional caller-supplied EntityManager (saga transaction context)"
    - "Multi-row VALUES batching at 1000 rows for the 1M seed-chain bootstrap (avoids Postgres parameter ceiling)"
key-files:
  created:
    - services/games/src/infrastructure/persistence/seed-chain.entity.ts
    - services/games/src/infrastructure/persistence/round.entity.ts
    - services/games/src/infrastructure/persistence/bet.entity.ts
    - services/games/src/infrastructure/mikro-orm/migrations/20260526001-create-seed-chain.ts
    - services/games/src/infrastructure/mikro-orm/migrations/20260526002-create-rounds.ts
    - services/games/src/infrastructure/mikro-orm/migrations/20260526003-create-bets.ts
    - services/games/src/infrastructure/repositories/mikro-seed-chain.repository.ts
    - services/games/src/infrastructure/repositories/mikro-round.repository.ts
    - services/games/src/infrastructure/repositories/mikro-bet.repository.ts
    - services/games/src/application/tokens.ts
  modified:
    - services/games/mikro-orm.config.ts
decisions:
  - "Routed the multi-row INSERT batching at 1000 rows per statement — the 1M seed-chain bootstrap in Plan 04-05 invokes insertChain once with 1M entries; a single multi-VALUES INSERT would blow past Postgres' ~65k bind-parameter ceiling. 1000 rows times 2 placeholders equals 2000 binds per batch leaves comfortable headroom."
  - "Kept the seed-chain repository's mapping shallow — no mapRowToAggregate because SeedChainRepository interface returns primitives (string | null, bigint) not an aggregate. SeedChain is a flat ledger, not a domain object with behavior."
  - "Multiplier scale conversion at the persistence boundary: DB stores cashed_out_multiplier_centi_x as INT scale times 100, Multiplier domain VO works in tenThousandths scale times 10_000. The mapRowToAggregate computes BigInt(centiX) * 100n to lift back to ten-thousandths. Loss-free because centi-X is always a multiple of 100 in ten-thousandths terms."
  - "Did NOT register the three repositories in any NestJS module yet — DI wiring lives in Plan 04-06 (round loop module) per the plan's explicit scope boundary."
metrics:
  duration_seconds: 432
  task_count: 2
  files_created: 10
  files_modified: 1
  completed_at: "2026-05-26"
---

# Phase 04 Plan 04: Games Persistence (Schemas, Migrations, Repositories) Summary

Three MikroORM EntitySchemas, three migrations (one per table with the canonical CHECK constraints and the bets partial unique index at the DB layer), and three MikroORM-backed repositories implementing the Plan 04-02/03 interfaces using the Phase 3 `em.getTransactionContext()` atomic-UPDATE pattern. REQ-DOM-02 anti-double-bet is now enforced at the DB layer before any saga code exists; REQ-DOM-01 FSM legality is double-guarded (aggregate primary, `rounds_fsm_check` 4-arm CHECK secondary).

## What Landed

- **SeedChainEntitySchema + 20260526001-create-seed-chain.ts** — `nonce BIGINT PRIMARY KEY, hash TEXT NOT NULL, seed TEXT NULL, revealed_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Partial index `seed_chain_unrevealed_idx ON seed_chain(nonce) WHERE seed IS NULL` keeps the unrevealed lookup hot during a 1M-entry chain.
- **RoundEntitySchema + 20260526002-create-rounds.ts** — UUID PK, `nonce BIGINT UNIQUE REFERENCES seed_chain(nonce)`, `status TEXT CHECK (status IN ('BETTING','RUNNING','CRASHED','SETTLED'))`, **`crash_point_centi_x INT NULL` (scale times 100 — avoids pg NUMERIC to JS Number drift)**, formula_version INT, four timestamp columns (betting_ends_at NOT NULL, started_at/crashed_at/settled_at NULL), and the headline **`rounds_fsm_check` 4-arm constraint** encoding the FSM column nullability matrix:
  - `BETTING` → started_at NULL, crash_point NULL, server_seed NULL, crashed_at NULL, settled_at NULL
  - `RUNNING` → started_at NOT NULL, crash_point NULL, server_seed NULL, crashed_at NULL, settled_at NULL
  - `CRASHED` → started_at NOT NULL, crash_point NOT NULL, server_seed NULL, crashed_at NOT NULL, settled_at NULL
  - `SETTLED` → started_at NOT NULL, crash_point NOT NULL, server_seed NOT NULL, crashed_at NOT NULL, settled_at NOT NULL
- Plus `rounds_status_idx` (partial on open statuses) and `rounds_history_idx` (settled_at DESC for the history endpoint).
- **BetEntitySchema + 20260526003-create-bets.ts** — UUID PK, FK to rounds, `amount_cents BIGINT CHECK (amount_cents BETWEEN 100 AND 100000)` (spec defaults, defense-in-depth; env override at app layer), `payout_cents BIGINT NULL CHECK (payout_cents IS NULL OR >= 0)`, `currency_code TEXT CHECK (length(currency_code) = 3)`, `status TEXT CHECK (status IN ('PENDING','ACTIVE','CASHED_OUT','LOST','REFUNDED'))`, **`bets_status_check` two-arm constraint** (only CASHED_OUT carries cashed_out_at + cashed_out_multiplier_centi_x + payout_cents; every other status has all three NULL), and the four indexes:
  - **`bets_one_active_per_player`** UNIQUE on `(player_id, round_id) WHERE status IN ('PENDING','ACTIVE')` — the REQ-DOM-02 partial unique index. Concurrent double-bet INSERT returns SQLSTATE 23505 at the DB level.
  - `bets_player_history_idx` on `(player_id, created_at DESC)` for listByPlayer.
  - `bets_round_active_idx` partial on round_id for active-only fan-out at cashout time.
  - `bets_round_player_status_idx` covering index on `(player_id, round_id, status)` per research §Pitfall 4 — supports findActiveByRoundAndPlayer without scanning the active partial.
- **MikroSeedChainRepository** — `countEntries` via em.count, `insertChain` batches at 1000 rows per multi-VALUES INSERT bound to `em.getTransactionContext()`, `findHashByNonce` / `findSeedByNonce` via em.findOne, `revealSeedAtNonce` UPDATE WHERE seed IS NULL (idempotent — second call hits zero rows).
- **MikroRoundRepository** — findById / findOpen / findServerSeedByNonce / listSettledHistory via em.findOne / em.find. `saveScheduled` em.persist + em.flush. **Three FSM transition methods** all use `UPDATE rounds SET ... WHERE id=? AND status=<from> RETURNING *` bound to `em.getTransactionContext()`; returns Round.rehydrate on hit or null on status race-loss.
- **MikroBetRepository** — findById / findActiveByRoundAndPlayer / findActiveByRound / listByPlayer via em.find. `save` via em.upsert + em.flush. **`tryTransition`** uses `UPDATE bets SET status=?, cashed_out_at=?, cashed_out_multiplier_centi_x=?, payout_cents=?, refund_reason=? WHERE id=? AND status=<from> RETURNING *` bound to `em.getTransactionContext()`.
- **mapRowToAggregate / mapDbRowToAggregate helpers in both Round and Bet repos** translate the row-shape (camelCase via EntitySchema fieldName mapping vs snake_case from raw SQL RETURNING) into domain objects with runtime status narrowing (`ROUND_STATUSES.includes(...)` / `BET_STATUSES.includes(...)`) — a defense-in-depth check that would only fire if the rounds_fsm_check / bets_status_check CHECKs were somehow bypassed.

## Verification

| Check | Outcome |
|-------|---------|
| `bunx tsc --noEmit` from services/games | clean, exit 0 |
| `grep -c em.getTransactionContext mikro-round.repository.ts` | 3 (one per FSM transition) |
| `grep -c em.getTransactionContext mikro-bet.repository.ts` | 1 (tryTransition) |
| `grep -c em.getTransactionContext mikro-seed-chain.repository.ts` | 2 (insertChain + revealSeedAtNonce) |
| `grep -c RoundEntitySchema\|BetEntitySchema\|SeedChainEntitySchema mikro-orm.config.ts` | 9 (3 entities array + 3 entitiesTs array + 3 imports) |
| `grep -E rounds_fsm_check\|bets_status_check\|bets_one_active_per_player migrations/*.ts` | all three names present verbatim |

## Migration files committed

| Order | File | DDL |
|-------|------|-----|
| 1 | 20260526001-create-seed-chain.ts | seed_chain table + seed_chain_unrevealed_idx |
| 2 | 20260526002-create-rounds.ts | rounds table + rounds_fsm_check + rounds_status_idx + rounds_history_idx |
| 3 | 20260526003-create-bets.ts | bets table + bets_status_check + bets_one_active_per_player + bets_player_history_idx + bets_round_active_idx + bets_round_player_status_idx |

Timestamp prefixes 20260526001..003 sort strictly after Phase 1/2/3 migrations (20260524001 through 20260525002), so a fresh `bun run docker:up` applies them in dependency order: outbox → inbox → dead-letter → wallets → transactions → seed_chain → rounds → bets.

## DDL constraint and index inventory

| Object | Kind | Purpose |
|--------|------|---------|
| seed_chain_unrevealed_idx | partial INDEX | hot lookup for pre-reveal nonces |
| rounds_fsm_check | CHECK | 4-arm FSM legality — REQ-DOM-01 defense-in-depth |
| rounds_status_idx | partial INDEX | open-round filter (3 statuses) |
| rounds_history_idx | partial INDEX | settled history DESC scan |
| bets_status_check | CHECK | only CASHED_OUT may carry cashed_out_* fields |
| **bets_one_active_per_player** | partial UNIQUE INDEX | **REQ-DOM-02 anti-double-bet at DB layer** |
| bets_player_history_idx | INDEX | listByPlayer ordered by created_at DESC |
| bets_round_active_idx | partial INDEX | round-scoped active fan-out |
| bets_round_player_status_idx | INDEX | findActiveByRoundAndPlayer covering scan |

## Repository method count

| Repository | Methods | em.getTransactionContext() calls |
|------------|---------|----------------------------------|
| MikroSeedChainRepository | 5 (countEntries, insertChain, findHashByNonce, findSeedByNonce, revealSeedAtNonce) | 2 (insertChain, revealSeedAtNonce) |
| MikroRoundRepository | 8 (findById, findOpen, findServerSeedByNonce, listSettledHistory, saveScheduled, transitionFromBettingToRunning, transitionFromRunningToCrashed, transitionFromCrashedToSettled) | 3 (all three FSM transitions) |
| MikroBetRepository | 6 (findById, findActiveByRoundAndPlayer, findActiveByRound, listByPlayer, save, tryTransition) | 1 (tryTransition) |
| **Total** | **19** | **6** |

## mikro-orm.config.ts diff

```diff
-import { OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema } from "@crash/messaging-spine";
+import { OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema } from "@crash/messaging-spine";
+import { SeedChainEntitySchema } from "./src/infrastructure/persistence/seed-chain.entity";
+import { RoundEntitySchema } from "./src/infrastructure/persistence/round.entity";
+import { BetEntitySchema } from "./src/infrastructure/persistence/bet.entity";

-  entities: [OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema],
+  entities: [OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema, SeedChainEntitySchema, RoundEntitySchema, BetEntitySchema],
   entitiesTs: [
     OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema,
+    SeedChainEntitySchema, RoundEntitySchema, BetEntitySchema,
   ],
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `em.persistAndFlush` not on MikroORM 7 EntityManager type**

- **Found during:** Task 2 typecheck (`Property 'persistAndFlush' does not exist on type 'PostgreSqlEntityManager<PostgreSqlDriver>'`)
- **Issue:** MikroORM 7 split `persistAndFlush(entity)` into `persist(entity) + flush()` on the EntityManager API. The plan's `behavior` block specified `em.persistAndFlush(em.create(...))` but the typecheck rejected it on the Phase 3 baseline MikroORM 7.1 version.
- **Fix:** Replaced with the two-step pattern `this.em.persist(this.em.create(RoundEntitySchema, row)); await this.em.flush();` — exact same shape used by `services/wallets/src/infrastructure/repositories/mikro-transaction.repository.ts:33`.
- **Files modified:** services/games/src/infrastructure/repositories/mikro-round.repository.ts (saveScheduled body)
- **Commit:** b750bda

No Rule 1 / Rule 2 / Rule 4 deviations.

## Threat Model Compliance

| Threat ID | Disposition | Mitigation in this plan |
|---|---|---|
| T-04-04-01 (SQL injection via raw execute) | mitigate | Every execute() call uses positional `?` placeholders bound to `params` array; no string concatenation of caller input. |
| T-04-04-02 (FSM bypass at DB layer) | mitigate | `rounds_fsm_check` 4-arm CHECK rejects any INSERT/UPDATE that lands a (status, columns) tuple outside the four legal FSM states. |
| T-04-04-03 (Double-active-bet race) | mitigate | `bets_one_active_per_player` partial UNIQUE INDEX on `(player_id, round_id) WHERE status IN ('PENDING','ACTIVE')`. Concurrent INSERTs serialize at the index; second commit returns SQLSTATE 23505. |
| T-04-04-04 (Tx-context unbound writes) | mitigate | Every raw-SQL execute in the three repositories passes `em.getTransactionContext()` as the 4th arg — verified by grep count (6 occurrences across the three files). |
| T-04-04-05 (Cross-player bet read) | accept | Repositories are unscoped at this layer; Plan 04-08 controllers add JwtGuard + per-player filter. |

## Threat Flags

None — no new trust boundaries or surfaces introduced beyond what was already modeled.

## Known Stubs

None. Every method is fully implemented against the interface; no placeholders, no TODOs.

## Requirements Closed

- REQ-DOM-02 — Partial unique index `bets_one_active_per_player` live at DB layer (the critical anti-double-bet guard, ahead of Phase 5 saga)
- REQ-DOM-01 — `rounds_fsm_check` 4-arm CHECK constraint at DB layer (defense-in-depth; aggregate is primary)
- REQ-DOM-08 — Repository implementations preserve the rich aggregate boundary (rehydrate via Round.rehydrate / Bet.rehydrate; no anemic row leakage)

## Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | EntitySchemas + three migrations + mikro-orm.config + DI tokens | 54da592 |
| 2 | Three MikroORM repositories with em.getTransactionContext() bound atomic UPDATEs | b750bda |

## Self-Check: PASSED

- services/games/src/infrastructure/persistence/seed-chain.entity.ts — FOUND
- services/games/src/infrastructure/persistence/round.entity.ts — FOUND
- services/games/src/infrastructure/persistence/bet.entity.ts — FOUND
- services/games/src/infrastructure/mikro-orm/migrations/20260526001-create-seed-chain.ts — FOUND
- services/games/src/infrastructure/mikro-orm/migrations/20260526002-create-rounds.ts — FOUND
- services/games/src/infrastructure/mikro-orm/migrations/20260526003-create-bets.ts — FOUND
- services/games/src/infrastructure/repositories/mikro-seed-chain.repository.ts — FOUND
- services/games/src/infrastructure/repositories/mikro-round.repository.ts — FOUND
- services/games/src/infrastructure/repositories/mikro-bet.repository.ts — FOUND
- services/games/src/application/tokens.ts — FOUND
- services/games/mikro-orm.config.ts — three schemas wired in both arrays
- Commit 54da592 — FOUND in git log
- Commit b750bda — FOUND in git log
- `bunx tsc --noEmit` from services/games — clean
