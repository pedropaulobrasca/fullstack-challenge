# ADR-014: Bet is its own aggregate — not nested inside Round

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 4

## Context

REQ-DOM-02 requires "single bet per player per round" as a domain invariant; REQ-DOM-08 requires rich aggregates with behavior methods (no anemic ORM rows); REQ-DOM-01 requires the Round FSM (`BETTING → RUNNING → CRASHED → SETTLED`) to be enforceable at the aggregate boundary. Phase 5 will layer the saga (Game ↔ Wallet) and Phase 6 will layer the WebSocket gateway, both of which write to Bets concurrently with the round loop running its own Round transitions.

DDD orthodoxy points at the obvious shape — model the Round as the consistency boundary containing a collection of Bets, the way `Order` contains `OrderLine`. That shape ships the invariant for free: a Bet only exists in the context of a Round, the Round's `acceptBet(...)` method validates `status === "BETTING"`, the Round repository hydrates the whole graph, MikroORM's Identity Map keeps Bets in sync with their parent.

But the crash-game write pattern collides with that shape head-on:

- **Multi-player concurrency at cashout**: every active player in a 200-bet round may attempt cashout within the same 10ms tick. If Bet is nested in Round, every cashout's transaction must acquire a write lock on the Round row to flush a child mutation through the aggregate's invariant gate (MikroORM's Unit of Work flushes the whole aggregate together when any child is dirty). Two hundred concurrent cashouts queue against a single Round row — the lock contention is the *primary* bottleneck of the entire game loop, and it lands on the hottest row in the database.
- **Cross-aggregate consistency for crash sweep**: when the Round transitions to CRASHED, every still-ACTIVE Bet must transition to LOST. Nested modeling forces "load the Round with all Bets → mutate each child → flush the parent" — one giant transaction holding the Round write lock for the duration of the sweep. With 200 bets that's a multi-hundred-millisecond TX, blocking every concurrent cashout that races the crash boundary.
- **Saga timeout pattern (Phase 5)**: a PENDING Bet that times out without a Wallet reply gets auto-refunded by the saga's timeout worker. Worker mutations on a child entity through the parent aggregate require the parent to be loaded — the worker would re-load Round to refund a single Bet, holding the Round lock while doing it.
- **Phase 2 outbox-spine guarantee**: every state transition that writes a domain event needs the outbox row co-written in the same Postgres TX (ADR-007). Bet transitions write `bet.placed`, `bet.cashed_out`, `bet.lost`, `bet.refunded` events — each one shouldn't drag the Round into its TX boundary.

Phase 4 also runs in parallel with Phase 3 (Wallet) per the roadmap parallelization map, so the chosen aggregate shape can't impose cross-aggregate read coupling that would force Phase 5 to wait on a re-modeled Game core later.

Three aggregate shapes were on the table at Plan 04-02 design time.

## Considered

- **Option A — Bet nested inside Round (rejected DDD orthodoxy)** — `Round.bets: Bet[]` collection, `Round.acceptBet(...)`, `Round.cashOutBet(...)`, `Round.crashAndSweep()`. Pros: textbook DDD, invariant gate sits naturally on the parent, one repository to hydrate. Cons: every Bet mutation locks the Round row; multi-hundred-bet concurrent cashout serializes through one row; crash-sweep is a single giant TX holding the Round lock; Phase 5 saga compensations must re-hydrate the parent to refund a single child; Identity Map memory footprint scales O(bets-per-round) on every load.
- **Option B — Bet as its own aggregate referencing Round by `RoundId` (chosen)** — Bet is a sibling-of-Round aggregate with private constructor + static factories (`Bet.place`, `Bet.rehydrate`) and behavior methods (`confirm()`, `cashOut(multiplier, time)`, `lose()`, `refund(reason)`). Round references nothing of Bet — `services/games/src/domain/round.aggregate.ts` has no `bets[]` collection, no `acceptBet()` method, no awareness of Bet existence. Cross-aggregate consistency for round-crash → all-ACTIVE-bets → LOST flows through the round loop's `CrashRoundUseCase` (Plan 04-06) as a Bets-only sweep TX. Pros: per-cashout TX touches one Bet row only; no Round-lock contention; per-bet outbox row commits in a single-aggregate TX; saga refund in Phase 5 touches one row; partial unique index `bets_one_active_per_player` enforces REQ-DOM-02 at the DB before any aggregate code runs. Cons: the "no bet exists without a Round" invariant lives at the FK + repository contract layer, not as a parent-aggregate membership; the absence of `Round.bets[]` looks unfamiliar in a code review.
- **Option C — Anemic Bet row with all transitions in a service layer** — Bet is a dumb data class; transitions live in `BetService.placeBet`, `BetService.cashOutBet`, etc. Pros: locking granularity matches Option B (single-row TX per mutation). Cons: violates REQ-DOM-08 directly (anemic, no behavior methods on the aggregate); the FSM (`PENDING → ACTIVE → CASHED_OUT | LOST | REFUNDED`) leaks across every service method; property tests in Plan 04-03 lose their pure-domain target (you can't `fc.property` a service); arguição-indefensible for the 25% architecture-and-DDD scoring band.

## Decision

**Option B — Bet is its own aggregate, references Round via `RoundId`, lives alongside Round at the same DDD level.** `services/games/src/domain/bet.aggregate.ts` ships the rich aggregate (private ctor, static `place` / `rehydrate` factories, immutable behavior methods `confirm()` / `cashOut(multiplier, time)` / `lose()` / `refund(reason)`) and `services/games/src/domain/round.aggregate.ts` has zero awareness of Bet — `grep "round:" services/games/src/domain/bet.aggregate.ts` returns no nav property, and `grep "bets" services/games/src/domain/round.aggregate.ts` returns no collection. The absence is a tested invariant of the design, not an oversight.

Cross-aggregate consistency for the round-crash sweep (every ACTIVE Bet must transition to LOST when the Round transitions to CRASHED) is orchestrated by `CrashRoundUseCase` (Plan 04-06, commit `1ce4a2d`, `services/games/src/application/use-cases/crash-round.use-case.ts`):

1. Round CRASHED commits first inside `roundRepository.transitionFromRunningToCrashed(round, crashPoint, txEm)` — single-row TX, single outbox row, releases immediately.
2. The sweep loads only the still-ACTIVE Bets for that round via `betRepository.findActiveByRound(roundId)`.
3. For each Bet, a per-bet micro-TX calls `betRepository.tryTransition(bet, "ACTIVE", "LOST", txEm)` — single-row TX, single outbox row, releases immediately.
4. Idempotent on already-LOST bets: the recovery branch in `RoundLoopService.recoverInFlightRound` (Plan 04-06) re-invokes `CrashRoundUseCase` on a CRASHED round at startup; the sweep is a no-op for any Bet already in LOST.

DB-level invariant enforcement (Plan 04-04 migration `Migration20260526100000_CreateGameCoreTables`):

- `bets` table: `id UUID PK`, `round_id UUID FK NOT NULL`, `player_id TEXT NOT NULL`, `amount_cents BIGINT NOT NULL`, `status TEXT NOT NULL` (`PENDING|ACTIVE|CASHED_OUT|LOST|REFUNDED`), `cashed_out_at TIMESTAMPTZ NULL`, `cashed_out_multiplier_centi_x INT NULL`, `created_at`, `updated_at`.
- `bets_one_active_per_player` partial unique index: `CREATE UNIQUE INDEX bets_one_active_per_player ON bets (player_id, round_id) WHERE status IN ('PENDING','ACTIVE')` — REQ-DOM-02 enforced at the DB before any application code runs. Plan 04-10 integration test asserts SQLSTATE 23505 on a concurrent duplicate-PENDING insert.
- `bets_status_state_consistency_check` CHECK constraint: `cashed_out_at` and `cashed_out_multiplier_centi_x` are NOT NULL iff `status = 'CASHED_OUT'`.

Read paths (Plan 04-08):

- `GET /games/rounds/current` (`GetCurrentRoundUseCase`) calls `betRepository.findActiveByRound(roundId)` + `betRepository.countByRoundId(roundId)` — query each Bet independently, no Round-graph hydration.
- `GET /games/bets/me` (`GetPlayerBetsUseCase`) calls `betRepository.listByPlayer(playerId, limit, offset)` directly.

Rationale: this is the same shape every production multiplayer-betting system reviewed in 04-RESEARCH §Architecture Patterns Pattern 2 ("Bet aggregate") converges on; the alternative (nested) is the textbook-correct DDD shape that doesn't survive the multi-player concurrency the game requires. The Pattern 2 source-of-truth in research is explicit: "Round having a collection of Bets" is an Anti-Pattern documented in 04-RESEARCH §Anti-Patterns. ADR-014 codifies that research finding.

## Consequences

- **Locked in (aggregate shape)**: Bet aggregate is co-equal to Round; both live in `services/games/src/domain/`; neither references the other except by ID. The `Round.bets[]` collection is absent by construction and tested-absent (Plan 04-02 absence test `grep "bets" round.aggregate.ts` returns 0 hits).
- **Locked in (DB constraints)**: `bets_one_active_per_player` partial unique index is the canonical REQ-DOM-02 enforcement point; the aggregate-level `Bet.place` factory is a defence-in-depth check, not the primary guard. Plan 04-10 integration test `bet-uniqueness.test.ts` proves the DB-level constraint fires before the aggregate's check.
- **Locked in (sweep pattern)**: round-crash sweep is per-bet micro-TX, not a single multi-row TX. `CrashRoundUseCase.execute` (Plan 04-06) iterates `findActiveByRound` and calls `tryTransition` per bet; each call is its own `em.transactional` boundary, releases the row lock immediately. Throughput scales linearly with bet count, not quadratically with Round-lock contention.
- **Locked in (Phase 5 saga path)**: the bet saga (REQ-SAGA-01) will write Bet transitions via `betRepository.tryTransition` with `txEm` threaded from `@IdempotentSubscribe` (ADR-013); the saga never holds any Round lock; the saga's timeout-refund worker touches one Bet row per refund. Phase 5 inherits ADR-014's locking discipline.
- **Foreclosed**: the nested `Round.bets[]` shape (would require rewriting `round.aggregate.ts`, every repository signature, every use case in Plan 04-06, Plan 04-08, and rewiring the upcoming Phase 5 saga to load Round-graphs to mutate child Bets); the service-layer anemic shape (would lose the pure-domain property test in Plan 04-03 and violate REQ-DOM-08).
- **Operational cost**: the FSM gate that a parent-aggregate would have provided lives in two places — the Bet aggregate's transition methods (e.g., `Bet.cashOut` throws if `status !== "ACTIVE"`) and the repository's `tryTransition(bet, fromStatus, toStatus)` (optimistic-locking SQL `UPDATE ... WHERE id = ? AND status = ?`). Both are tested (Plan 04-03 `bet.aggregate.test.ts` covers the aggregate side; Plan 04-10 `bet-uniqueness.test.ts` covers the repository side). The duplication is the cost of avoiding the Round-lock contention.
- **Test surface**: Plan 04-03 `bet.aggregate.test.ts` ships 27 cases across every legal + illegal FSM transition, immutability, and rehydrate; `money-rounding.property.test.ts` ships 20k fast-check cases against `Bet.cashOut` because the aggregate is pure-domain. Property-test reachability is a *direct* consequence of choosing Option B — Option C would have made the property untestable.
- **Anticipated recruiter question**: "Why isn't Bet nested in Round? That's the textbook DDD aggregate shape." — defended by the multi-player cashout concurrency argument, the per-bet micro-TX sweep pattern, the documented Anti-Pattern in 04-RESEARCH §Anti-Patterns "Round having a collection of Bets", and the property-test reachability that pure-domain Bet enables.

## Alternatives Rejected

- **Option A — Bet nested inside Round** — Round-row lock contention at multi-player cashout; crash-sweep TX holds the parent lock for the full sweep; Phase 5 saga refund must re-hydrate the parent to mutate one child; Identity Map memory scales O(bets-per-round) on every load; documented Anti-Pattern in research.
- **Option C — Anemic Bet row with service-layer transitions** — violates REQ-DOM-08 (no behavior methods on the aggregate); the FSM leaks across every service method; property tests in Plan 04-03 lose their pure-domain target; arguição-indefensible for the architecture / DDD scoring band.
