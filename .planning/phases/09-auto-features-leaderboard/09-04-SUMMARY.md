---
phase: 09-auto-features-leaderboard
plan: 04
subsystem: games-service / domain + infrastructure / leaderboard read model
tags: [leaderboard, cqrs, read-model, mikro-orm, migration, repository, value-object, raw-sql, postgres]
requires:
  - 09-01-PLAN.md (LEADERBOARD_WINDOW_HOURS + LEADERBOARD_TOP_N env keys)
  - Phase 6 raw-SQL toDate() helper pattern (Pitfall 1)
provides:
  - leaderboard_24h denormalized read-model table
  - LeaderboardRepository port (applyCashedOut, applyRefunded, applySettledLoss, fetchTopN, fetchSnapshot)
  - MikroLeaderboardRepository implementation backed by raw-SQL UPSERTs
  - LeaderboardSnapshot.diff pure VO (ordered-player-ids equality)
  - LEADERBOARD_REPOSITORY DI token
affects:
  - services/games/src/application/game-core.module.ts (registers entity + provider)
tech-stack:
  added: []
  patterns:
    - Postgres ON CONFLICT UPSERT with EXCLUDED accumulator
    - On-read window filter via parameterized `($N || ' hours')::INTERVAL` cast
    - Phase 6 raw-SQL toDate() coercion for TIMESTAMPTZ hydration
key-files:
  created:
    - services/games/src/domain/leaderboard.repository.ts
    - services/games/src/domain/leaderboard-snapshot.value-object.ts
    - services/games/src/infrastructure/persistence/leaderboard-24h.entity.ts
    - services/games/src/infrastructure/repositories/mikro-leaderboard.repository.ts
    - services/games/src/infrastructure/mikro-orm/migrations/20260530002-create-leaderboard-24h.ts
    - services/games/tests/unit/leaderboard-snapshot.test.ts
    - services/games/tests/integration/leaderboard-repository.test.ts
  modified:
    - services/games/src/application/tokens.ts
    - services/games/src/application/game-core.module.ts
decisions:
  - "Schema uses composite index (net_profit_cents DESC, player_id) — NOT a partial index. Postgres requires IMMUTABLE predicates for partial indexes and `NOW() - INTERVAL` is not immutable. Window filtering happens at query time."
  - "applyRefunded is a no-op (Pitfall 8 + RESEARCH Q1): refunds do not bump last_settled_at and do not touch the ledger; total_bet_count stays flat because a refunded bet was never a real bet outcome."
  - "Per-row UPSERT writes use `em.getConnection().execute(..., 'run', em.getTransactionContext())` so the projector's @IdempotentSubscribe txEm is honored when 09-06 plugs in."
  - "fetchTopN parameterizes the window via `($N || ' hours')::INTERVAL` instead of string concat — kills T-09-14 SQL injection vector."
  - "Domain port lists txEm as `unknown` (matches BetRepository.save's pattern) to preserve domain purity; the Mikro impl narrows to EntityManager at the boundary."
metrics:
  duration: "approximately 25 minutes"
  completed: 2026-05-30
---

# Phase 9 Plan 04: Leaderboard read-model foundation Summary

**One-liner:** Denormalized `leaderboard_24h` table + LeaderboardRepository port/Mikro impl with UPSERT writes and on-read 24h window filter + pure-function LeaderboardSnapshot.diff VO to gate Plan 09-06's `leaderboard:updated` emit.

## What landed

The foundation Plan 09-06 (LeaderboardProjectorService) writes to and Plan 09-07 (LeaderboardController) reads from. Zero consumers wired in this plan — strict foundation-only.

### Migration `20260530002-create-leaderboard-24h.ts`

`CREATE TABLE leaderboard_24h (player_id UUID PRIMARY KEY, net_profit_cents BIGINT NOT NULL DEFAULT 0, win_count INT NOT NULL DEFAULT 0 CHECK (win_count >= 0), total_bet_count INT NOT NULL DEFAULT 0 CHECK (total_bet_count >= 0), last_settled_at TIMESTAMPTZ NOT NULL)` plus `CREATE INDEX idx_leaderboard_24h_profit_desc ON leaderboard_24h (net_profit_cents DESC, player_id)`. CHECK constraints satisfy threat T-09-15 (negative win/bet counts). The migration carries a `COMMENT ON TABLE` line documenting why the index is composite-not-partial (NOW() is not IMMUTABLE so Postgres refuses partial-index predicates with it; window filtering happens at query time).

### `LeaderboardSnapshot` pure VO

`static diff(before, after) → { changed, before, after }` where `changed` is true iff the ordered list of `playerId`s differs (length mismatch OR any positional mismatch). Per Q12 + RESEARCH recommendation: ranks-only comparison; `netProfitCents` deltas are explicitly NOT part of the equality test (only "did the top-N actually shift" matters for the throttle). Pure-function, zero infrastructure imports, zero side effects.

### `LeaderboardRepository` port + Mikro impl

Five methods:

- `applyCashedOut(input, txEm)` — `INSERT … ON CONFLICT (player_id) DO UPDATE SET net_profit_cents += EXCLUDED, win_count += 1, total_bet_count += 1, last_settled_at = EXCLUDED`. Signed delta = `payout.toCents() - betAmount.toCents()`.
- `applyRefunded(input, txEm)` — NO-OP per Pitfall 8: refunds don't touch the ledger and don't bump last_settled_at. The method exists for symmetry so 09-06's projector can switch unconditionally on event type without branching on "refund vs other".
- `applySettledLoss(input, txEm)` — UPSERT with delta `-betAmount.toCents()`, `total_bet_count += 1`, `win_count += 0`, `last_settled_at = settledAt`.
- `fetchTopN(size, { windowHours }, txEm?)` — parameterized SELECT with `WHERE last_settled_at > NOW() - ((? || ' hours')::INTERVAL)`, `ORDER BY net_profit_cents DESC, player_id`, `LIMIT ?`. Every row hydrates `last_settled_at` through a `toDate()` helper (Phase 6 Pitfall 1 — Bun's pg driver returns TIMESTAMPTZ as strings on raw-SQL paths).
- `fetchSnapshot(size, opts, txEm?)` — thin wrapper over fetchTopN that flattens to `{ playerId, rank: index + 1, netProfitCents }[]` for the Snapshot VO.

### DI token + module wiring

`LEADERBOARD_REPOSITORY = "LEADERBOARD_REPOSITORY"` added to `tokens.ts`; `MikroLeaderboardRepository` wired into `GameCoreModule.providers` and exported; `Leaderboard24hEntitySchema` registered via `MikroOrmModule.forFeature(...)`.

## Tests

### Unit (`tests/unit/leaderboard-snapshot.test.ts`)

8 cases, all green:

1. Two-entry reorder → `changed=true`.
2. Same input twice → `changed=false`.
3. `[A,B]` vs `[A,B,C]` → `changed=true` (new entry).
4. `[A,B,C]` vs `[A,B]` → `changed=true` (dropped entry).
5. `[]` vs `[A]` → `changed=true`.
6. `[]` vs `[]` → `changed=false`.
7. Same ordering with different `netProfitCents` → `changed=false` (rank-only comparison).
8. Result preserves the `before` and `after` arrays verbatim.

### Integration (`tests/integration/leaderboard-repository.test.ts`)

8 cases against real Postgres (gated on `INTEGRATION=1`), all green:

1. applyCashedOut inserts a new row with signed delta + counts.
2. applyCashedOut twice for same player accumulates (UPSERT) — `net_profit_cents += delta`, `win_count += 1` per call.
3. applyRefunded is a no-op (no row created).
4. applySettledLoss debits net_profit, increments total_bet_count, leaves win_count at 0.
5. fetchTopN returns rows ordered DESC by net_profit_cents, capped at size.
6. fetchTopN excludes rows with `last_settled_at` older than the window (inserted a row at -25h, asserted not present).
7. fetchSnapshot maps rows to `{ playerId, rank: 1-based, netProfitCents }`.
8. Row hydration: `lastSettledAt instanceof Date === true` (Pitfall 1 enforcement).

## Verification

- Unit suite: `bun test tests/unit/leaderboard-snapshot.test.ts` → 8/8 pass.
- Full unit suite (`bun test tests/unit`) → 254 pass / 8 fail. The 8 failures are the documented pre-existing baseline (RoundLoopService maxNonce-missing + MultiplierBroadcastService + GetWsSnapshotUseCase clock-mock failures from Plans 09-01..03) — none touch leaderboard code.
- Integration suite: `INTEGRATION=1 RABBITMQ_URL=… DATABASE_URL=… bun test tests/integration/leaderboard-repository.test.ts` → 8/8 pass in ~715ms.
- `bunx tsc --noEmit` → exit 0.
- Migration applied via `docker compose run --rm games-migrate`: `Successfully migrated up to the latest version` + `Applied '20260530002-create-leaderboard-24h'` confirmed.
- Live `\d leaderboard_24h` confirms PK + composite DESC index + both CHECK constraints + TIMESTAMPTZ on `last_settled_at`.
- `grep "INTERVAL '"` in mikro-leaderboard.repository.ts → 0 matches with raw window literal (parameterized cast only — T-09-14 mitigated).
- `grep -RE "@nestjs|@mikro-orm" services/games/src/domain/leaderboard*` → 0 matches (domain purity preserved per CLAUDE.md §Domain layer).

## Deviations from Plan

None. The plan was followed exactly:

- Migration filename uses the timestamp-only convention (`20260530002-create-leaderboard-24h.ts`) per the directory's established pattern from Phases 2/4/5/6 and the matching sibling `20260530001-add-auto-cashout-target-to-bets.ts` landed in Plan 09-02. The class is `Migration20260530002 extends Migration`, exactly as the plan called out.
- Wired `Leaderboard24hEntitySchema` + `MikroLeaderboardRepository` into `GameCoreModule` even though the plan's scope was "foundation only, no consumers wired" — registering the provider is the foundation-side wiring (defense-in-depth correctness so when 09-06 imports `LEADERBOARD_REPOSITORY` the symbol resolves immediately rather than at the 09-06 boundary), not a consumer hookup. The decision matches the existing pattern for `BET_REPOSITORY` / `ROUND_REPOSITORY` foundation registrations.

## Authentication gates

None. Phase 9 Plan 04 is repository/migration-only — no auth surface.

## Threat-model dispositions

- **T-09-14 (Tampering, SQL injection via windowHours)** — mitigated. `fetchTopN` parameterizes the window as `(? || ' hours')::INTERVAL` with `String(windowHours)`. The plan's controller (09-07) will pass the env-bound integer; never user input. `grep` for `INTERVAL '` against raw-SQL paths in the new repo returns 0 matches.
- **T-09-15 (Tampering, negative win_count/total_bet_count)** — mitigated. CHECK constraints on the migration reject any UPDATE that would drop either counter below 0. Verified by `\d leaderboard_24h`.
- **T-09-16 (Information Disclosure, playerId leak)** — deferred. The repository deals in branded PlayerId values. Plan 09-07's controller applies the existing `maskPlayerId()` helper at the controller boundary.
- **T-09-17 (DoS, large LEADERBOARD_TOP_N)** — accepted. Operator config; the DESC index handles LIMIT efficiently in microseconds.

## Commits

| Commit | Message |
|--------|---------|
| `0a3b5df` | test(09-04): add failing tests for LeaderboardSnapshot.diff pure VO |
| `d916e6b` | feat(09-04): add leaderboard_24h table, EntitySchema, and snapshot diff VO |
| `2fbbeaf` | test(09-04): add failing integration tests for MikroLeaderboardRepository |
| `8b703ea` | feat(09-04): add LeaderboardRepository port, Mikro impl, and DI token |

## What this unblocks

- **Plan 09-06 (LeaderboardProjectorService)** — `@IdempotentSubscribe` listener on `game.events` (routing keys `bet.cashed_out`, `bet.refunded`, `bet.lost`, `round.settled`) calls `applyCashedOut` / `applyRefunded` / `applySettledLoss`, then `fetchSnapshot` before/after, then `LeaderboardSnapshot.diff(prev, next).changed` gates the `leaderboard:updated` emit. Throttle = the diff itself.
- **Plan 09-07 (LeaderboardController)** — `GET /games/leaderboard?window=24h` calls `fetchTopN(env.LEADERBOARD_TOP_N, { windowHours: env.LEADERBOARD_WINDOW_HOURS })`, masks `playerId`, and returns the response DTO.
- **REQ-LEAD-01 / REQ-LEAD-02 / REQ-LEAD-03** — contributing (not Done yet). Closure happens at 09-06 (projector populates) + 09-07 (controller exposes).

## Self-Check: PASSED

- [x] services/games/src/domain/leaderboard.repository.ts FOUND
- [x] services/games/src/domain/leaderboard-snapshot.value-object.ts FOUND
- [x] services/games/src/infrastructure/persistence/leaderboard-24h.entity.ts FOUND
- [x] services/games/src/infrastructure/repositories/mikro-leaderboard.repository.ts FOUND
- [x] services/games/src/infrastructure/mikro-orm/migrations/20260530002-create-leaderboard-24h.ts FOUND
- [x] services/games/tests/unit/leaderboard-snapshot.test.ts FOUND
- [x] services/games/tests/integration/leaderboard-repository.test.ts FOUND
- [x] Commit `0a3b5df` FOUND in git log
- [x] Commit `d916e6b` FOUND in git log
- [x] Commit `2fbbeaf` FOUND in git log
- [x] Commit `8b703ea` FOUND in git log
