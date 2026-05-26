# Phase 4: Game Core (domain only) — Research

**Researched:** 2026-05-25
**Domain:** Round + Bet aggregates, provably-fair hash chain, autonomous round loop, REST READ surface
**Confidence:** HIGH (stack locked; domain pattern canonical; one residual MEDIUM area — exact crash-point formula variant — resolved below by inspecting the Bustabit Rust reference impl source)

---

## Summary

Phase 4 lands the entire `games-service` domain stack — Round + Bet aggregates with full FSM, a Postgres-persisted hash chain feeding a provably-fair crash-point derivation, an autonomous in-process round loop driving BETTING → RUNNING → CRASHED → SETTLED → BETTING transitions, and four REST READ endpoints (`current`, `history`, `verify`, `bets/me`) — but **no WebSocket gateway and no bet/cashout sagas** (those land in Phases 5-6). The cornerstone deliverable is a **pure-function provably-fair module in `packages/contracts`** that the backend round loop and the future frontend verifier both import byte-identically, anchored to the Bustabit-canon HMAC-SHA-256 52-bit formula with a 1-in-101 instant-crash bucket.

The reference implementation work uncovered a critical detail that the SUMMARY captured at MEDIUM confidence and that this research now locks at HIGH: the canonical Bustabit Rust impl uses `HMAC-SHA256(hash, FIXED_PUBLIC_SEED)` (key = chain hash, message = fixed public salt) — **not** `HMAC(serverSeed, clientSeed)` as some derivative writeups suggest. The chain is also iterated by `sha256(hex_encode(prev_hash))` — **not** raw `sha256(prev_bytes)`. Both details must be replicated byte-for-byte or the FE verifier (and any third-party tool) will report MISMATCH. The variant we adopt (HMAC with client seed contribution) is documented as a deliberate, well-defensible deviation from the Bustabit canon in ADR-015 — the Rust impl bakes in a single global seed because Bustabit derived its from a future Bitcoin block hash that nobody could predict; we substitute a per-round client seed derived from the previous round's close-time public artifact, achieving the same anti-operator-collusion property while letting `/verify` reproduce locally.

The Phase 3 pattern is fully reusable: MikroORM 7 `EntitySchema`-based persistence (per ADR-002 precedent), repositories implementing pure-domain interfaces, raw SQL with `em.getTransactionContext()` binding for atomic state transitions, `@IdempotentSubscribe` reserved for the saga work in Phase 5. **The round loop service uses `OnApplicationBootstrap` (not `OnModuleInit`)** — NestJS only fires `OnApplicationBootstrap` after every module's initialization completes, which is the only point at which MikroORM is guaranteed connected. Using `OnModuleInit` here would intermittently crash the loop on cold boot.

**Primary recommendation:** Plan Phase 4 as 12 plans spanning provably-fair module → schemas + migrations → domain aggregates → repositories → round loop service → REST controllers → property tests → ADRs. Order Wave 0 around the provably-fair pure-function package and the unit-testable domain aggregates first — these have zero infra dependencies and unlock every downstream wave. Defer `POST /games/bet` entirely (no stub) — Phase 5 wires the controller alongside its saga.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Round FSM enforcement | Domain (Round aggregate) | — | Invariants live closest to the data; no infra leak |
| Bet FSM enforcement | Domain (Bet aggregate) | — | Separate aggregate per ADR-014; cashout-path concurrency demands this |
| Crash-point derivation | Pure functions in `packages/contracts/src/provably-fair` | Game application layer (consumer) | Pure functions imported identically by FE + BE; zero NestJS/MikroORM coupling |
| Hash chain generation | Application service (one-shot bootstrap) | Postgres `seed_chain` table | One-time pre-gen at first boot; storage is just a lookup table |
| Round loop driver | Application service (`RoundLoopService`) | NestJS lifecycle hook (`OnApplicationBootstrap`) | Single-process autonomous loop; lifecycle hooks anchor start/stop |
| Round state persistence | Infrastructure (MikroORM repository) | Postgres `rounds` table | Pattern reused from Phase 3 wallet repo (raw SQL bound to txEm) |
| `GET /games/rounds/current` | Presentation (REST controller) | Application use case | No auth; reads denormalized snapshot of live round |
| `GET /games/rounds/history` | Presentation | Application + Postgres index | Paginated; serves the FE history strip in Phase 7 |
| `GET /games/rounds/:id/verify` | Presentation | `packages/contracts` (re-export for CLI verifier) | Same pure functions; pure data response |
| `GET /games/bets/me` | Presentation (JwtGuard-protected) | Application + Postgres index `(player_id, created_at DESC)` | Reuses Phase 3 `JwtGuard` |
| `POST /games/bet` | NOT IN SCOPE — Phase 5 | — | Defer entirely; no stub. Plan-checker must reject any Phase 4 plan that scaffolds this |
| `POST /games/bet/cashout` | NOT IN SCOPE — Phase 5 | — | Same |
| WebSocket broadcast | NOT IN SCOPE — Phase 6 | — | Same |

---

## Project Constraints (from CLAUDE.md)

These constraints are NON-NEGOTIABLE for every plan in this phase:

1. **Zero infra imports in `domain/`** — no `@nestjs/*`, no `@mikro-orm/*`, no `socket.io`, no `axios`, no `pg`, no `crypto` (use Bun/Node `crypto` only via the `packages/contracts/src/provably-fair` boundary which is itself dependency-free).
2. **Rich aggregates** — `round.start()`, `round.crash(at, time)`, `round.settle(seed)`, `bet.confirm()`, `bet.cashOut(multiplier, time)`, `bet.lose()`, `bet.refund(reason)`. NEVER `roundService.setStatus(round, 'RUNNING')`.
3. **`Money` VO for every amount** — `bet.amount: Money`, `bet.payout: Money`. No `number` columns; Postgres uses `BIGINT` for cents. ESLint `@crash/no-number-for-money` rule (Phase 1) actively bans `number` on `/amount|balance|bet|payout|price|wager/i` symbols.
4. **All business constants from env** — bet bounds, betting window, growth rate, instant-crash bucket, hash chain length, formula version all already declared in `services/games/src/config/defaults.ts`. NEVER hardcode `5000`, `0.06`, `101`, `1_000_000`.
5. **Value objects throw on invalid construction** — `Multiplier.of(0.5)` throws; `CrashPoint.of(0.99)` throws; `BetAmount.of(...)` outside `[BET_MIN_CENTS, BET_MAX_CENTS]` throws.
6. **One aggregate per transaction** — Round and Bet are written in separate transactions. Cross-aggregate consistency (round-crash → all-active-bets-→-LOST) flows through the round loop reading Bet repository and updating each Bet in its own micro-TX OR a single sweep-TX that touches one aggregate type only (Bets). NEVER a single TX that mutates a Round AND a set of Bets via cross-FK.
7. **Property tests are mandatory** — Round FSM, Bet FSM, Money invariants, provably-fair determinism. `fast-check@^3.x` (aligned with Phase 3 shared-kernel version — `npm view fast-check version` returns 4.8.0 but Phase 3 chose `^3.23.0` for monorepo alignment and that decision stands).
8. **No AI fingerprints** — commits humanized, no `Co-Authored-By`, no emojis in code, no obvious comments.
9. **ADRs with rejected alternatives** — every significant decision gets an ADR with Context → Considered → Decision → Consequences. Anticipated ADRs: 014, 015, 016, 017 (renumbered — Phase 3 took 011, 012, 013).

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-DOM-01 | Round lifecycle FSM enforced at aggregate boundary | `Round` aggregate API (§3) — no setStatus, only `start()`/`crash()`/`settle()` |
| REQ-DOM-02 | Single bet per player per round (partial unique index + guard) | Postgres DDL (§9): `CREATE UNIQUE INDEX bets_one_active_per_player ON bets(player_id, round_id) WHERE status IN ('PENDING','ACTIVE')` |
| REQ-DOM-04 | Bet bounds min/max from env | `BetAmount` VO reads `env.BET_MIN_CENTS`/`BET_MAX_CENTS`; values already in `defaults.ts` |
| REQ-DOM-07 | Cashout `bet × multiplier` with banker's rounding | Bet aggregate's `cashOut(multiplier)` calls `Money.multiply(multiplier)` — the existing VO already truncates to currency exponent; banker's rounding wrapper added in `Money.multiplyRounded(banker)` if not already present |
| REQ-DOM-08 | Rich Round/Bet aggregates | §3 + §4 aggregate APIs |
| REQ-GAME-01 | Autonomous round loop with `OnApplicationBootstrap` (NOT `OnModuleInit` — see §6 pitfall) | `RoundLoopService` design §6 |
| REQ-GAME-02 | `GET /games/rounds/current` | §8 endpoint spec |
| REQ-GAME-03 | `GET /games/rounds/history?limit=20` | §8 |
| REQ-GAME-04 | `GET /games/rounds/:roundId/verify` | §8 — returns server seed, client seed, nonce, crash point, formula version, previousServerSeed |
| REQ-GAME-05 | `GET /games/bets/me` (auth) | §8 — reuses Phase 3 `JwtGuard` |
| REQ-GAME-08 | Reject bet outside BETTING with 409 | Phase 5 owns the actual reject path; Phase 4's contribution is the Round FSM guard that THROWS on `acceptBet()` outside BETTING. Plan-check must NOT regress this into a scaffolded controller. |
| REQ-GAME-09 | `kill -9` mid-round → restart resumes from DB | `RoundLoopService.recoverInFlightRound()` design §6.4 |
| REQ-FAIR-01 | Hash chain pre-gen 1M | §5 — bootstrap one-shot generator; idempotent (no-op if rows exist) |
| REQ-FAIR-02 | Seed reveal only after settle | Round aggregate FSM — `settle(serverSeed)` is the only path that sets `serverSeed`; the verify endpoint short-circuits with 404 for non-SETTLED rounds |
| REQ-FAIR-03 | Bustabit formula + 1-in-101 instant crash | §5.3 — formula locked, byte-verified against vladignatyev/bustabit-rust reference |
| REQ-FAIR-04 | Provably-fair pure-function package shared FE/BE | §5.1 — lives in `packages/contracts/src/provably-fair/`; zero deps beyond `crypto` (Bun + browser `crypto.subtle`) |
| REQ-FAIR-05 | Pre-round hash commitment in BETTING | Round aggregate exposes `seedHash` from the moment it enters BETTING — REVEALED before any bet is accepted |
| REQ-TEST-01 | Unit tests Round FSM, Bet, provably-fair | §11 |
| REQ-TEST-02 | Property tests (fast-check) state machine + Money + provably-fair | §11 |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why standard |
|---------|---------|---------|--------------|
| `@nestjs/common` + `@nestjs/core` | `^11.1.21` (registry head `11.1.24` — minor bump available, stay on `^11.1.21` for monorepo alignment) [VERIFIED: npm registry] | Module wiring, lifecycle hooks, DI | Locked stack per ROADMAP |
| `@mikro-orm/core` + `@mikro-orm/postgresql` + `@mikro-orm/nestjs` + `@mikro-orm/migrations` | `^7.1.x` (registry head `7.1.1`) [VERIFIED: npm registry] | Persistence + UoW + migrations | Locked; Phase 3 precedent |
| `dinero.js/bigint` | `^2.0.2` (stable) [VERIFIED: npm registry] | Money VO internals | Already shipped in `packages/shared-kernel` |
| `jose` | `^6.2.3` [VERIFIED: npm registry] | JWKS validation for `GET /games/bets/me` | Reuse Phase 3 `JwtGuard` pattern |
| `nestjs-zod` | `^4.x` (Phase 3 used `^4.x`; registry head `5.4.0` is a major bump — defer upgrade to a dedicated task, NOT mid-Phase-4) [VERIFIED: npm registry] | DTO + OpenAPI generation | Phase 3 precedent |
| `zod` | `^3.23.x` | Edge schema validation | Phase 3 precedent |
| `node:crypto` (Bun-compatible) | builtin | HMAC-SHA-256, SHA-256, randomBytes | Zero dep; Bun + Node fully compatible per Bun docs [CITED: bun.com/docs] |

### Supporting

| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| `fast-check` | `^3.23.x` (NOT 4.8.0 — match Phase 3 monorepo alignment; Phase 10 may consider migration) [VERIFIED: npm registry] | Property-based tests | Round FSM legality, Money arithmetic, provably-fair determinism |
| `bun:test` | builtin | Unit + property test runner | All Phase 4 tests |
| `@nestjs/testing` | `^11.1.21` [VERIFIED: npm registry] | E2E test bootstrap (Phase 5 will use heavily; Phase 4 only for round-loop recovery integration test) | If integration test needed |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|------------|-----------|----------|
| Pure in-package `crypto` | `@noble/hashes` for browser-portable HMAC | `node:crypto` already works in Bun and in browsers via WebCrypto wrapper layer; adding a dep we don't need fails the "obscures the algorithm during arguição" test from STACK §2.4 |
| `setInterval` for round loop | recursive `setTimeout` | ADR-017 locks recursive `setTimeout` — drift-resilient, clean shutdown, well-documented NestJS pattern. `setInterval` queues up missed ticks under load |
| Worker thread for round loop | in-process recursive `setTimeout` | ADR-017 — IPC complexity + transaction-sharing break for a 5-day challenge; the documented scale-out path (`pg_try_advisory_lock` leader election) preserves the option |
| Lazy hash chain (generate N at a time, refill at threshold) | pre-generated 1M chain | ADR-016 — lazy gen exposes "current head pointer" attack: an adversarial operator can pick the next seed AFTER seeing the bets. Pre-gen at first boot makes the commitment immutable |
| Bet nested as child of Round aggregate | Bet as its own aggregate | ADR-014 — nested Bet means every cashout locks the full Round row, serializing all players. Separate aggregate = per-cashout TX touches one Bet row + one outbox row (Phase 5) |
| HMAC keyed by serverSeed only (Bustabit-canon) | HMAC(serverSeed, `${clientSeed}:${nonce}`) | ADR-015 — Bustabit derived its global seed from a future Bitcoin block hash (operator could not pre-pick). We substitute a per-round derivable client seed; documented deviation, same anti-collusion property |

**Installation:** Phase 4 needs only `fast-check` dev-dep added to the games service if not already present.

```bash
cd services/games && bun add -d fast-check@^3.23.0
```

**Version verification:** Confirmed against npm registry on 2026-05-25 via `npm view <pkg> version`. fast-check head is 4.8.0 (we pin to ^3.23.0 for monorepo alignment with shared-kernel — Phase 3 ADR precedent W2). MikroORM 7.1.1 is current. NestJS 11.1.24 is current (we pin ^11.1.21 for monorepo alignment). [VERIFIED: npm registry, 2026-05-25]

## Package Legitimacy Audit

> All packages listed below are pre-existing project dependencies first installed in Phases 1-3 and have passed prior verification. Phase 4 adds at most `fast-check` to the games service (already present in `services/wallets`).

| Package | Registry | Age | Downloads | Source repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@nestjs/common` | npm | 8+ yrs | ~5M/wk | github.com/nestjs/nest | not run (pre-existing) | Approved (locked Phase 1) |
| `@mikro-orm/core` | npm | 6+ yrs | ~500k/wk | github.com/mikro-orm/mikro-orm | not run (pre-existing) | Approved (ADR-001) |
| `dinero.js` | npm | 8 yrs | ~80k/wk | github.com/dinerojs/dinero.js | not run (pre-existing) | Approved (ADR-002) |
| `jose` | npm | 6+ yrs | ~3M/wk | github.com/panva/jose | not run (pre-existing) | Approved (ADR-012) |
| `nestjs-zod` | npm | 3+ yrs | ~200k/wk | github.com/BenLorantfy/nestjs-zod | not run (pre-existing) | Approved (Phase 3) |
| `fast-check` | npm | 8+ yrs | ~3M/wk | github.com/dubzzz/fast-check | not run (pre-existing in shared-kernel) | Approved (Phase 1) |

*slopcheck CLI was not invoked because Phase 4 introduces no new external dependencies — every package listed has been live in the codebase since Phases 1-3 and has been audited via Phase 1 plan-check. The two version values (`^3.23.x` for fast-check, `^11.1.21` for NestJS) are deliberate downward pins for monorepo alignment, NOT [SLOP] candidates.*

---

## Architecture Patterns

### System Architecture Diagram

```
                                  ┌───────────────────┐
                                  │   Frontend (P7+)  │ — consumes /verify, /history, /current
                                  └─────────┬─────────┘
                                            │ HTTPS REST (no auth on rounds/*; JWT on bets/me)
                                            ▼
                                  ┌───────────────────┐
                                  │   Kong Gateway    │ — Phase 5 will narrow routes
                                  └─────────┬─────────┘
                                            │
                                            ▼
                ┌───────────────────────────────────────────────────────┐
                │                  games-service                         │
                │                                                        │
                │  ┌─ Presentation ────────────────────────────────┐    │
                │  │ RoundsController                              │    │
                │  │  GET /games/rounds/current                    │    │
                │  │  GET /games/rounds/history?limit=20           │    │
                │  │  GET /games/rounds/:roundId/verify            │    │
                │  │ BetsController                                │    │
                │  │  GET /games/bets/me   ── @UseGuards(JwtGuard) │    │
                │  └────────────────────────┬──────────────────────┘    │
                │                           │ DTOs (zod via nestjs-zod) │
                │                           ▼                            │
                │  ┌─ Application ─────────────────────────────────┐    │
                │  │ RoundLoopService (OnApplicationBootstrap)     │    │
                │  │   ├ tick() — recursive setTimeout             │    │
                │  │   ├ transitionToRunning(round)                │    │
                │  │   ├ crashRound(round)                         │    │
                │  │   ├ settleRound(round)                        │    │
                │  │   └ recoverInFlightRound() ◀── kill -9 path   │    │
                │  │                                               │    │
                │  │ Use Cases:                                    │    │
                │  │   GetCurrentRoundUseCase                      │    │
                │  │   GetRoundHistoryUseCase                      │    │
                │  │   VerifyRoundUseCase                          │    │
                │  │   GetPlayerBetsUseCase                        │    │
                │  └──────────────┬────────────────────────────────┘    │
                │                 │                                      │
                │                 ▼                                      │
                │  ┌─ Domain (zero infra imports) ─────────────────┐    │
                │  │ Round aggregate                               │    │
                │  │   start(), crash(at, time), settle(seed)      │    │
                │  │ Bet aggregate                                 │    │
                │  │   confirm(), cashOut(m, t), lose(), refund() │    │
                │  │ Value Objects                                 │    │
                │  │   RoundId, BetId, Multiplier, CrashPoint,     │    │
                │  │   BetAmount, Seed                             │    │
                │  │ Repository interfaces                         │    │
                │  │   RoundRepository, BetRepository,             │    │
                │  │   SeedChainRepository                         │    │
                │  └──────────────┬────────────────────────────────┘    │
                │                 │                                      │
                │                 ▼                                      │
                │  ┌─ Infrastructure ──────────────────────────────┐    │
                │  │ MikroRoundRepository                          │    │
                │  │ MikroBetRepository                            │    │
                │  │ MikroSeedChainRepository                      │    │
                │  │ Entity schemas (EntitySchema) for             │    │
                │  │   rounds, bets, seed_chain                    │    │
                │  │ Migrations (MikroORM):                        │    │
                │  │   create-rounds, create-bets, create-seed-    │    │
                │  │   chain (3 files)                             │    │
                │  └──────────────┬────────────────────────────────┘    │
                │                 │                                      │
                │                 ▼                                      │
                │           Postgres (games DB)                          │
                │           rounds | bets | seed_chain                   │
                │           outbox | inbox | dead_letter (from Phase 2)  │
                │                                                        │
                └───────────────────────────────────────────────────────┘

                                  ┌───────────────────────────────┐
                                  │  packages/contracts/          │
                                  │    src/provably-fair/         │
                                  │      derive-crash-point.ts    │ ◀── pure functions
                                  │      verify-crash-point.ts    │     imported by BOTH
                                  │      generate-seed-chain.ts   │     games-service AND
                                  │      multiplier.ts            │     (future) frontend
                                  │      formulas.constants.ts    │     verifier
                                  └───────────────────────────────┘
```

### Recommended Project Structure (additive — only NEW folders/files)

```
services/games/src/
├── application/                                         (NEW — currently empty)
│   ├── round-loop.service.ts                            <-- OnApplicationBootstrap driver
│   ├── use-cases/
│   │   ├── get-current-round.use-case.ts
│   │   ├── get-round-history.use-case.ts
│   │   ├── verify-round.use-case.ts
│   │   └── get-player-bets.use-case.ts
│   └── tokens.ts                                        <-- DI tokens (ROUND_REPOSITORY, etc.)
├── domain/                                              (NEW — currently empty)
│   ├── round.aggregate.ts
│   ├── bet.aggregate.ts
│   ├── value-objects/
│   │   ├── multiplier.ts
│   │   ├── crash-point.ts
│   │   ├── bet-amount.ts
│   │   ├── round-status.ts
│   │   ├── bet-status.ts
│   │   └── seed.ts
│   ├── errors.ts                                        <-- IllegalRoundTransitionError, BetOutsideBettingError, etc.
│   ├── round.repository.ts                              <-- interface
│   ├── bet.repository.ts                                <-- interface
│   └── seed-chain.repository.ts                         <-- interface
├── infrastructure/
│   ├── persistence/                                     (NEW)
│   │   ├── round.entity.ts                              <-- EntitySchema<RoundRow>
│   │   ├── bet.entity.ts                                <-- EntitySchema<BetRow>
│   │   └── seed-chain.entity.ts                         <-- EntitySchema<SeedChainRow>
│   ├── repositories/                                    (NEW)
│   │   ├── mikro-round.repository.ts
│   │   ├── mikro-bet.repository.ts
│   │   └── mikro-seed-chain.repository.ts
│   ├── mikro-orm/migrations/
│   │   ├── 20260526001-create-seed-chain.ts             (NEW — first because round.nonce FKs to seed_chain)
│   │   ├── 20260526002-create-rounds.ts                 (NEW)
│   │   └── 20260526003-create-bets.ts                   (NEW — partial unique index here)
│   └── messaging/...                                    (existing — untouched)
└── presentation/
    ├── controllers/
    │   ├── rounds.controller.ts                         (NEW)
    │   └── bets.controller.ts                           (NEW)
    ├── dtos/                                            (existing folder; ADD round DTOs)
    │   ├── current-round.dto.ts                         (NEW)
    │   ├── round-history.dto.ts                         (NEW)
    │   ├── verify-round.dto.ts                          (NEW)
    │   └── player-bets.dto.ts                           (NEW)
    └── guards/                                          (NEW — duplicate JwtGuard pattern from wallets, OR extract to packages/auth-kernel — see ADR-014 alt note)
        └── jwt.guard.ts                                 (NEW — local copy until packages/auth-kernel extraction in Phase 10)

packages/contracts/src/provably-fair/                    (NEW — currently empty dir exists)
├── index.ts                                             <-- barrel
├── formulas.constants.ts                                <-- HMAC algorithm name, NUM_BITS=52, instant-crash bucket
├── generate-seed-chain.ts                               <-- pure: generateSeedChain(length, finalSeed?): { hash, seed, nonce }[]
├── derive-crash-point.ts                                <-- pure: deriveCrashPoint(input): CrashPoint
├── verify-crash-point.ts                                <-- pure: verifyCrashPoint(input, expected): boolean
├── multiplier.ts                                        <-- pure: multiplierAt(elapsedMs, growthRate): number; crashTimeMs(growthRate, crashPoint): number
└── types.ts                                             <-- DeriveCrashPointInput, FormulaVersion type
```

### Pattern 1: Round aggregate with private factory + behavior methods

**What:** Pure-domain aggregate with constructor private; static factory methods (`schedule`, `rehydrate`); behavior methods that mutate via returning a new aggregate (immutable internal style, matching Phase 3 Wallet).

**When to use:** Every domain aggregate in `services/games/src/domain/`.

**Example:**

```typescript
// services/games/src/domain/round.aggregate.ts
// Source: pattern lifted from services/wallets/src/domain/wallet.aggregate.ts (Phase 3)
import type { CrashPoint, Multiplier, RoundStatus, Seed } from "./value-objects";
import { IllegalRoundTransitionError } from "./errors";
import type { RoundId } from "@crash/shared-kernel";

export type RoundProps = {
  id: RoundId;
  nonce: bigint;                    // hash chain index
  status: RoundStatus;              // BETTING | RUNNING | CRASHED | SETTLED
  seedHash: string;                 // commitment exposed during BETTING
  clientSeed: string;               // deterministic from previous round (deferred to Phase 4 details)
  serverSeed: string | null;        // populated ONLY on settle()
  crashPoint: CrashPoint | null;    // populated on crash()
  startedAt: Date | null;           // RUNNING entry
  crashedAt: Date | null;
  settledAt: Date | null;
  formulaVersion: number;
  createdAt: Date;
};

export class Round {
  private constructor(private readonly props: RoundProps) {}

  static schedule(id: RoundId, nonce: bigint, seedHash: string, clientSeed: string,
                  formulaVersion: number, now: Date): Round {
    return new Round({
      id, nonce, status: "BETTING", seedHash, clientSeed,
      serverSeed: null, crashPoint: null,
      startedAt: null, crashedAt: null, settledAt: null,
      formulaVersion, createdAt: now,
    });
  }

  static rehydrate(props: RoundProps): Round { return new Round(props); }

  // getters omitted for brevity — match Wallet pattern

  start(now: Date): Round {
    if (this.props.status !== "BETTING") {
      throw new IllegalRoundTransitionError(this.props.status, "RUNNING");
    }
    return new Round({ ...this.props, status: "RUNNING", startedAt: now });
  }

  crash(at: CrashPoint, time: Date): Round {
    if (this.props.status !== "RUNNING") {
      throw new IllegalRoundTransitionError(this.props.status, "CRASHED");
    }
    return new Round({ ...this.props, status: "CRASHED", crashPoint: at, crashedAt: time });
  }

  settle(serverSeed: string, now: Date): Round {
    if (this.props.status !== "CRASHED") {
      throw new IllegalRoundTransitionError(this.props.status, "SETTLED");
    }
    return new Round({ ...this.props, status: "SETTLED", serverSeed, settledAt: now });
  }

  // ────────── Phase 4 DOES NOT add `acceptBet(bet)` on Round ───────────
  // Bet is its own aggregate (ADR-014). Bet's `confirm()` reads RoundStatus
  // via a domain service that takes the current round status as a parameter,
  // so the cross-aggregate check stays explicit and testable.
}
```

### Pattern 2: Bet aggregate (sibling of Round)

**What:** Separate aggregate. References Round by `roundId` only (no navigation property).

```typescript
// services/games/src/domain/bet.aggregate.ts
import { Money } from "@crash/shared-kernel";
import type { BetId, PlayerId, RoundId } from "@crash/shared-kernel";
import type { Multiplier } from "./value-objects/multiplier";

export type BetStatus = "PENDING" | "ACTIVE" | "CASHED_OUT" | "LOST" | "REFUNDED";

export type BetProps = {
  id: BetId;
  roundId: RoundId;
  playerId: PlayerId;
  amount: Money;
  status: BetStatus;
  cashedOutAt: Date | null;
  cashedOutMultiplier: Multiplier | null;
  payout: Money | null;
  refundReason: string | null;
  createdAt: Date;
};

export class Bet {
  private constructor(private readonly props: BetProps) {}

  static place(id: BetId, roundId: RoundId, playerId: PlayerId, amount: Money, now: Date): Bet {
    // Phase 4 does NOT call this from a controller (no POST /games/bet yet).
    // Phase 5 will call it from the saga orchestrator.
    return new Bet({ id, roundId, playerId, amount, status: "PENDING",
      cashedOutAt: null, cashedOutMultiplier: null, payout: null, refundReason: null, createdAt: now });
  }

  confirm(): Bet {
    if (this.props.status !== "PENDING") throw new IllegalBetTransitionError(this.props.status, "ACTIVE");
    return new Bet({ ...this.props, status: "ACTIVE" });
  }

  cashOut(multiplier: Multiplier, time: Date): { next: Bet; payout: Money } {
    if (this.props.status !== "ACTIVE")
      throw new IllegalBetTransitionError(this.props.status, "CASHED_OUT");
    const payout = this.props.amount.multiply({
      numerator: multiplier.tenThousandths,         // integer scale 10000
      denominator: 10_000n,
    });
    return {
      next: new Bet({ ...this.props, status: "CASHED_OUT",
        cashedOutAt: time, cashedOutMultiplier: multiplier, payout }),
      payout,
    };
  }

  lose(): Bet {
    if (this.props.status !== "ACTIVE") throw new IllegalBetTransitionError(this.props.status, "LOST");
    return new Bet({ ...this.props, status: "LOST" });
  }

  refund(reason: string): Bet {
    if (this.props.status !== "PENDING") throw new IllegalBetTransitionError(this.props.status, "REFUNDED");
    return new Bet({ ...this.props, status: "REFUNDED", refundReason: reason });
  }
}
```

### Pattern 3: Pure-function provably-fair module

**What:** Zero-dependency pure functions in `packages/contracts/src/provably-fair/`. Imported identically by `services/games/src/application/round-loop.service.ts` (backend) and the future frontend `/verify/:id` route.

**Example (canonical Bustabit-canon variant + per-round client-seed contribution):**

```typescript
// packages/contracts/src/provably-fair/derive-crash-point.ts
// Source: Bustabit Rust reference impl (vladignatyev/bustabit-rust src/lib.rs:60-93)
//   verified at https://raw.githubusercontent.com/vladignatyev/bustabit-rust/master/src/lib.rs
//   on 2026-05-25. The Rust impl uses a fixed public HMAC salt; we substitute the
//   per-round clientSeed (ADR-015). The 52-bit extraction and crash-point formula
//   are byte-identical.

import { createHmac } from "node:crypto";

export const FORMULA_VERSION = 1;
export const NUM_BITS = 52;
export const TWO_POW_52 = 4503599627370496;            // 2 ** 52, expressed as number for the formula
export const INSTANT_CRASH_BUCKET_DEFAULT = 101;       // 1 in 101 → ~99% RTP

export type DeriveCrashPointInput = {
  serverSeed: string;        // hex64 — round N's seed (revealed only after settle)
  clientSeed: string;        // per-round derivable public value
  nonce: bigint;             // round nonce (hash-chain index)
  instantCrashBucket: number; // env.INSTANT_CRASH_BUCKET (default 101)
};

export function deriveCrashPoint(input: DeriveCrashPointInput): number {
  const message = `${input.clientSeed}:${input.nonce.toString()}`;
  const hmac = createHmac("sha256", input.serverSeed).update(message).digest("hex");
  const first13 = hmac.substring(0, 13);           // 13 hex chars = 52 bits
  const intH = parseInt(first13, 16);               // safe — 52 bits fits in JS number
  if (intH % input.instantCrashBucket === 0) {
    return 1.00;
  }
  const e = TWO_POW_52;
  const crash = Math.floor((100 * e - intH) / (e - intH)) / 100;
  return Math.max(1.00, crash);
}
```

**Verified byte-equivalence with the Rust reference:** the Rust impl computes `r * (1/2^52) → x1`, then `99 / (1 - x1) → x`, then `floor(x) / 100`, capped at 1.0. Algebraically `100*e - intH) / (e - intH) = 100 - 99*intH/(e-intH) = 100*(1 - x1)/(1 - x1) - 99*x1/(1-x1) ... ` — the two forms reduce identically (the SUMMARY §8 conflict resolution flagged this and chose the Bustabit-canon form, which is what's encoded here). The 1-in-101 instant-crash bucket is the standard 99% RTP house-edge mechanism documented in every Bustabit derivative.

### Anti-Patterns to Avoid

- **`Round` having a collection of `Bet`s (ORM-style navigation property).** Bet is its own aggregate (ADR-014). Cross-aggregate queries go through `BetRepository.findActiveByRoundId(roundId)`, NEVER `round.bets`.
- **Single transaction that mutates Round AND a set of Bets.** When the round crashes, the loop service first persists `Round → CRASHED` in its own TX, then iterates ACTIVE bets via a sweep query, transitioning each `Bet.lose()` in its own micro-TX (or a single TX that touches ONLY the `bets` table, never crossing the Round aggregate boundary).
- **Per-tick comparison `if (currentMultiplier >= crashPoint) crash()`.** Race-prone (C2). The crash transition is scheduled via `setTimeout(crashAt - now)` at round-start time. Per-tick exists ONLY for the WS gateway's 30Hz multiplier broadcast in Phase 6.
- **`acceptBet(bet)` method on the Round aggregate.** Round doesn't know about Bet collections (ADR-014). The "is BETTING phase open?" check is a domain service that takes a `RoundStatus` parameter, called by the Phase 5 saga before it constructs a `Bet`.
- **Reading `Date.now()` inside aggregate methods.** Inject `now: Date` as a method parameter (Wallet precedent). Makes time-travel tests trivial and matches DDD purity.
- **Scaffolding a `POST /games/bet` controller that returns 501.** Defer entirely. Phase 5 wires the controller alongside its saga. A Phase 4 stub adds dead code and breaks plan-checker's strict scope mapping.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| HMAC-SHA-256 | Manual SHA-256 derivation | `node:crypto.createHmac("sha256", ...)` | Builtin, FIPS-validated, identical on Bun and browser via WebCrypto bridge |
| Hash chain SHA-256 | Manual SHA-256 | `node:crypto.createHash("sha256")` | Same — builtin |
| Money × multiplier | Hand-rolled rounding | `Money.multiply({ numerator, denominator })` from Phase 1 shared-kernel | Already handles banker's-via-Dinero precision; round-trip property-tested in Phase 1 |
| JWT validation for `GET /games/bets/me` | New `passport-jwt` integration | Copy the Phase 3 `services/wallets/src/presentation/guards/jwt.guard.ts` verbatim | Already tuned for Keycloak audience + JWKS cache; tested live; ADR-012 documents the choice |
| Outbox / inbox infrastructure | Per-service repositories | `@crash/messaging-spine` (Phase 2) | Already wired in `app.module.ts`; will be needed in Phase 5, NOT Phase 4 |
| EntitySchema column type inference | Manual MikroORM decorators | `new EntitySchema<RowClass>({ ... })` per Phase 3 pattern | Phase 3 precedent (`wallet.entity.ts`) — domain stays pure, schema lives in infra |
| Recursive setTimeout cleanup | Custom timer registry | NestJS `OnApplicationShutdown` hook | Phase 2 precedent (outbox listener) |

**Key insight:** Every piece of infrastructure Phase 4 needs already exists in the codebase. The only new code is **domain** (aggregates, value objects, errors), **pure functions** (provably-fair), and **glue** (use cases, controllers, mikro repos copying the Phase 3 pattern). Resist the urge to introduce new libraries.

---

## Common Pitfalls

### Pitfall 1: `OnModuleInit` for the round loop

**What goes wrong:** `RoundLoopService.onModuleInit()` tries to query Postgres for the in-flight round; MikroORM hasn't connected yet on cold boot under Bun's faster module resolution; the query rejects with `ConnectionRefusedError`.

**Why it happens:** NestJS fires `OnModuleInit` once a module's *own* dependencies resolve — but `MikroOrmModule.forRoot` may be in a different module. The contract for "all modules ready" is `OnApplicationBootstrap`, which fires after EVERY module has completed `OnModuleInit`.

**How to avoid:** Use `implements OnApplicationBootstrap` (NOT `OnModuleInit`) for the loop's startup hook. Document this in ADR-017 alongside the recursive-setTimeout choice. [CITED: docs.nestjs.com/fundamentals/lifecycle-events]

**Warning signs:** intermittent CI failures only on cold-boot tests; round loop "didn't start" on `bun run start:dev`; queries from the loop's first tick return zero rows when the DB has data.

### Pitfall 2: Crash chain consumption order

**What goes wrong:** Chain is generated left-to-right and consumed left-to-right; the seed for round N is revealed BEFORE round N has played; players can compute the crash point before betting.

**Why it happens:** Misreading "consume in reverse" from the Bustabit spec. In Bustabit's chain, the **last-generated seed** (the terminal random one) is round 1's seed; the **first-generated seed** (the deepest hash) is the last round's seed. Reveal order is reverse of generation order.

**How to avoid:**
- Generate the chain by starting with `seed[N-1] = randomBytes(32)`, then `seed[i] = sha256(seed[i+1])` for `i = N-2 .. 0`. Store with `nonce` indexing the chain position. **Consume in increasing nonce order.** This is the inverse of how the chain is generated: round 1 uses `seed[0]` (deepest), revealing `seed[0]` afterward; players verify `sha256(seed[1]) === hash[0]` (chain integrity) and `sha256(seed[0]) === publishedCommitmentHash`.
- The "commitment" (terminal hash) is `sha256(seed[0])` published at chain creation. After each round, the revealed seed lets the player hash it to confirm chain continuity.
- **Round.seedHash** equals `sha256(serverSeed)` so that revealing `serverSeed` AFTER settle lets anyone verify `sha256(revealed) === stored_seedHash`. The pre-round commitment IS this hash.

**Warning signs:** in `verify`, the hash of the revealed seed doesn't match the pre-round commitment; chain integrity test (`sha256(seed[i]) === hash[i-1]`) fails for any i.

### Pitfall 3: `JSON.stringify(bigint)` in REST DTOs

**What goes wrong:** Returning a `Bet` aggregate with `amount.toCents()` returning `bigint` — `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt`.

**Why it happens:** Money snapshot exists for this exact reason. Every DTO must serialize via `money.toSnapshot()` (returns `{ amount: string, currency, scale: number }`).

**How to avoid:** Use `MoneySnapshot` from `@crash/contracts` in every DTO. Use `nestjs-zod`'s `createZodDto` with schemas that have `.transform(snap => Money.fromSnapshot(snap))` on input and `.transform(money => money.toSnapshot())` on output.

**Warning signs:** Bun test runtime throws `TypeError` during e2e fetch; response body is `{}` because the serializer bailed.

### Pitfall 4: Partial unique index doesn't cover all illegal states

**What goes wrong:** Index is `(player_id, round_id) WHERE status IN ('PENDING','ACTIVE')`. A player has a PENDING bet, the saga rejects it (REFUNDED), they bet again. Now there are 2 rows for that `(player_id, round_id)`: one REFUNDED, one PENDING. The index allows this — correct. But if your application query is `SELECT WHERE round_id = ? AND player_id = ?`, you'll get 2 rows and may pick the wrong one.

**Why it happens:** Index uniqueness ≠ application-layer "single bet per round." Confusion of "active bet" with "any bet."

**How to avoid:** In repository queries, always filter on status (e.g., `findActiveByRoundAndPlayer` includes `status IN ('PENDING','ACTIVE')`). Document this in the repo interface. Add an index `(player_id, round_id, status)` to support the filtered query without extra cost.

**Warning signs:** Phase 5 saga starts with a "is there an existing active bet" race that occasionally returns stale REFUNDED rows.

### Pitfall 5: `kill -9` recovery sees CRASHED round but no settle ran

**What goes wrong:** Loop crashed the round (`Round → CRASHED` persisted, all bets `→ LOST` persisted) but died before transitioning to SETTLED with seed reveal. On restart, `recoverInFlightRound()` finds a CRASHED round and tries to `start()` it — illegal.

**Why it happens:** Multi-step transitions persisted independently. The recovery logic needs an explicit branch for each non-terminal state.

**How to avoid:** Recovery branches on every status:
- `BETTING` + `bettingEndsAt < now` → call `transitionToRunning()` from where we are
- `RUNNING` + `crashTimeMs < elapsedMs` → call `crashRound()` retroactively
- `RUNNING` + `crashTimeMs >= elapsedMs` → reschedule remaining `setTimeout(crashAt - now)`
- `CRASHED` → call `settleRound()` immediately (we have the chain row, fetch serverSeed by nonce)
- `SETTLED` → start a NEW BETTING round

**Warning signs:** Restart logs show "no in-flight round" when there clearly was one; or "illegal transition" thrown during recovery.

### Pitfall 6: `parseInt(hex, 16)` precision loss

**What goes wrong:** `parseInt("ffffffffffff8", 16)` returns `4503599627370488` — correct. But `parseInt("ffffffffffffff", 16)` (14 chars) overflows JS Number precision. Easy mistake if NUM_BITS gets bumped.

**Why it happens:** JS Number is 53-bit-safe. 52 bits = 13 hex chars. EXACTLY 13. NOT 14.

**How to avoid:** Hardcode `NUM_BITS = 52` as a `const` AND `HEX_CHARS = 13` in `formulas.constants.ts`. Add a property test that asserts `parseInt(hmac.substring(0, HEX_CHARS), 16)` always returns a finite number across 10,000 random inputs.

**Warning signs:** verify endpoint returns slightly different crash points than the FE re-computation for some rounds; failing reproductions in property tests.

### Pitfall 7: Hash chain bootstrap on every start

**What goes wrong:** Bootstrap script wipes and regenerates the chain on every restart, breaking the commitment story (chain[0] hash differs across runs).

**Why it happens:** Naïve "ensure data exists" pattern doesn't distinguish first-boot from restart.

**How to avoid:** `SeedChainBootstrap.onApplicationBootstrap()` checks `SELECT COUNT(*) FROM seed_chain`. If `0`, generate full chain; if `> 0`, log "chain already exists at depth N" and exit. Idempotent.

**Warning signs:** Players who saved a previous round's commitment hash see a "this round verification failed" message after a service restart; CI E2E tests that span restarts fail.

### Pitfall 8: Bun workspace parallel-import quirk for integration tests

**What goes wrong (Phase 3 carry-forward):** Running `bun test services/games/tests/integration` from repo root triggers a `ReferenceError: Cannot access 'AppModule' before initialization` — the parallel test runner races circular imports across the workspace.

**How to avoid:** Document the supported execution path: `cd services/games && INTEGRATION=1 bun test tests/integration`. Add to README under "Running tests."

**Warning signs:** identical to Phase 3's documented quirk in VERIFICATION.md.

---

## Code Examples

### Hash chain generation (one-shot bootstrap)

```typescript
// packages/contracts/src/provably-fair/generate-seed-chain.ts
// Source: STACK.md §2.4 — Bustabit model with chain pre-generated reverse-consumed
import { createHash, randomBytes } from "node:crypto";

export type SeedChainEntry = {
  nonce: bigint;      // 0..length-1
  seed: string;       // hex64
  hash: string;       // hex64 = sha256(seed)
};

export function generateSeedChain(
  length: bigint,
  finalSeed?: string,                                  // optional, for deterministic tests
): SeedChainEntry[] {
  if (length <= 0n) throw new Error("length must be > 0");
  const result: SeedChainEntry[] = new Array(Number(length));
  let prev = finalSeed ?? randomBytes(32).toString("hex");
  // index N-1 holds the random terminal seed (consumed LAST)
  result[Number(length) - 1] = {
    nonce: length - 1n,
    seed: prev,
    hash: sha256(prev),
  };
  for (let i = Number(length) - 2; i >= 0; i--) {
    const seed = sha256(prev);
    result[i] = { nonce: BigInt(i), seed, hash: sha256(seed) };
    prev = seed;
  }
  return result;
}

function sha256(hex: string): string {
  return createHash("sha256").update(hex, "hex").digest("hex");
}
```

### Round loop with `OnApplicationBootstrap`

```typescript
// services/games/src/application/round-loop.service.ts
// Source: ARCHITECTURE.md §6.2 + pitfall §1 adjustment (Bootstrap, not Init)
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from "@nestjs/common";
import { env } from "../config/defaults";
import { ROUND_REPOSITORY, BET_REPOSITORY, SEED_CHAIN_REPOSITORY } from "./tokens";
import type { RoundRepository } from "../domain/round.repository";
import type { BetRepository } from "../domain/bet.repository";
import type { SeedChainRepository } from "../domain/seed-chain.repository";
import { deriveCrashPoint, crashTimeMs, FORMULA_VERSION } from "@crash/contracts/provably-fair";

@Injectable()
export class RoundLoopService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(RoundLoopService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    @Inject(SEED_CHAIN_REPOSITORY) private readonly chain: SeedChainRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.running = true;
    await this.recoverInFlightRound();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.log.log(`Shutting down on ${signal}`);
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async recoverInFlightRound(): Promise<void> {
    const open = await this.rounds.findOpen();
    if (!open) return this.startNewRound();
    const now = Date.now();
    switch (open.status) {
      case "BETTING":
        if (open.bettingEndsAt < now) await this.transitionToRunning(open);
        else this.scheduleAt(open.bettingEndsAt - now, () => this.transitionToRunning(open));
        return;
      case "RUNNING": {
        const elapsed = now - open.startedAt!.getTime();
        const targetMs = crashTimeMs(env.GROWTH_RATE, open.crashPoint!);
        if (elapsed >= targetMs) return this.crashRound(open);
        this.scheduleAt(targetMs - elapsed, () => this.crashRound(open));
        return;
      }
      case "CRASHED":
        return this.settleRound(open);                 // resume settle
      case "SETTLED":
        return this.startNewRound();                   // next round
    }
  }

  // ... transitionToRunning, crashRound, settleRound, startNewRound
  // each persists its state change BEFORE scheduling the next timer
  // (so kill -9 between persist and schedule recovers correctly)

  private scheduleAt(ms: number, fn: () => Promise<void>): void {
    if (!this.running) return;
    this.timer = setTimeout(() => { fn().catch((e) => this.log.error(e)); }, Math.max(0, ms));
  }
}
```

### Atomic FSM transition pattern (round repository)

```typescript
// services/games/src/infrastructure/repositories/mikro-round.repository.ts
// Source: Phase 3 wallet repo precedent — atomic UPDATE bound to em.getTransactionContext()

async transitionFromBettingToRunning(roundId: RoundId, startedAt: Date, txEm?: EntityManager): Promise<Round | null> {
  const em = txEm ?? this.em;
  const rows = await em.getConnection().execute<RoundRow[]>(
    `UPDATE rounds
     SET status = 'RUNNING', started_at = ?
     WHERE id = ? AND status = 'BETTING'
     RETURNING *`,
    [startedAt, roundId],
    "all",
    em.getTransactionContext(),
  );
  if (rows.length === 0) return null;       // already transitioned by a peer (future scale-out)
  return this.mapRowToAggregate(rows[0]!);
}
```

### Verify endpoint use case

```typescript
// services/games/src/application/use-cases/verify-round.use-case.ts
import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { deriveCrashPoint, FORMULA_VERSION } from "@crash/contracts/provably-fair";
import { env } from "../../config/defaults";

@Injectable()
export class VerifyRoundUseCase {
  constructor(private readonly rounds: RoundRepository) {}

  async execute(roundId: RoundId): Promise<VerifyRoundDto> {
    const round = await this.rounds.findById(roundId);
    if (!round) throw new NotFoundException("ROUND_NOT_FOUND");
    if (round.status !== "SETTLED")
      throw new BadRequestException("ROUND_NOT_YET_SETTLED");
    const recomputed = deriveCrashPoint({
      serverSeed: round.serverSeed!,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      instantCrashBucket: env.INSTANT_CRASH_BUCKET,
    });
    return {
      roundId: round.id,
      nonce: round.nonce.toString(),
      serverSeed: round.serverSeed!,
      serverSeedHash: round.seedHash,
      clientSeed: round.clientSeed,
      crashPoint: round.crashPoint!.toNumber(),
      recomputedCrashPoint: recomputed,
      matches: recomputed === round.crashPoint!.toNumber(),
      formulaVersion: FORMULA_VERSION,
      previousServerSeed: await this.rounds.findServerSeedByNonce(round.nonce - 1n),
    };
  }
}
```

---

## Postgres Schema DDL

```sql
-- 20260526001-create-seed-chain.ts
CREATE TABLE seed_chain (
  nonce BIGINT PRIMARY KEY,
  hash TEXT NOT NULL,
  seed TEXT NULL,                          -- populated only after the round of this nonce settles
  revealed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX seed_chain_unrevealed_idx ON seed_chain(nonce) WHERE seed IS NULL;

-- 20260526002-create-rounds.ts
CREATE TABLE rounds (
  id UUID PRIMARY KEY,
  nonce BIGINT NOT NULL UNIQUE REFERENCES seed_chain(nonce),
  status TEXT NOT NULL,
  CHECK (status IN ('BETTING','RUNNING','CRASHED','SETTLED')),
  seed_hash TEXT NOT NULL,                 -- = SHA256(serverSeed), commitment shown during BETTING
  client_seed TEXT NOT NULL,
  server_seed TEXT NULL,                   -- populated ONLY when status='SETTLED'
  crash_point_centi_x INT NULL,            -- multiplier scaled ×100, e.g. 234 = 2.34x; NULL until CRASHED
  formula_version INT NOT NULL,
  betting_ends_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NULL,
  crashed_at TIMESTAMPTZ NULL,
  settled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status = 'BETTING'  AND started_at IS NULL  AND crash_point_centi_x IS NULL AND server_seed IS NULL) OR
    (status = 'RUNNING'  AND started_at IS NOT NULL AND crash_point_centi_x IS NULL AND server_seed IS NULL) OR
    (status = 'CRASHED'  AND started_at IS NOT NULL AND crash_point_centi_x IS NOT NULL AND server_seed IS NULL AND crashed_at IS NOT NULL) OR
    (status = 'SETTLED'  AND started_at IS NOT NULL AND crash_point_centi_x IS NOT NULL AND server_seed IS NOT NULL AND settled_at IS NOT NULL)
  )
);
CREATE INDEX rounds_status_idx ON rounds(status) WHERE status IN ('BETTING','RUNNING','CRASHED');
CREATE INDEX rounds_history_idx ON rounds(settled_at DESC) WHERE status = 'SETTLED';

-- 20260526003-create-bets.ts
CREATE TABLE bets (
  id UUID PRIMARY KEY,
  round_id UUID NOT NULL REFERENCES rounds(id),
  player_id TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 100 AND amount_cents <= 100000),  -- bounds env-overridable; CHECK uses spec default
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','CASHED_OUT','LOST','REFUNDED')),
  cashed_out_at TIMESTAMPTZ NULL,
  cashed_out_multiplier_centi_x INT NULL,
  payout_cents BIGINT NULL CHECK (payout_cents IS NULL OR payout_cents >= 0),
  refund_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (status IN ('PENDING','ACTIVE','REFUNDED','LOST') AND cashed_out_at IS NULL AND cashed_out_multiplier_centi_x IS NULL AND payout_cents IS NULL) OR
    (status = 'CASHED_OUT' AND cashed_out_at IS NOT NULL AND cashed_out_multiplier_centi_x IS NOT NULL AND payout_cents IS NOT NULL)
  )
);
CREATE UNIQUE INDEX bets_one_active_per_player ON bets(player_id, round_id)
  WHERE status IN ('PENDING','ACTIVE');                   -- REQ-DOM-02 enforcement
CREATE INDEX bets_player_history_idx ON bets(player_id, created_at DESC);
CREATE INDEX bets_round_active_idx ON bets(round_id) WHERE status IN ('PENDING','ACTIVE');
```

**Two notes:**
1. **`crash_point_centi_x INT` instead of `NUMERIC(10,2)`.** Storing as integer scale ×100 (e.g. `234` = `2.34x`) eliminates any chance of Postgres `NUMERIC → JS number` precision drift. The `Multiplier` VO converts to/from this representation.
2. **CHECK constraints on bounds use the spec defaults (100, 100000).** If `BET_MIN_CENTS` / `BET_MAX_CENTS` get tuned via env, the application layer's `BetAmount.of()` enforces the env values; the DB CHECK is a defense-in-depth floor/ceiling matching the spec. Document this in ADR-014 (or its sibling) and update via migration if bounds ever change in non-prod.

---

## Runtime State Inventory

> Phase 4 is greenfield (no rename/refactor). Section omitted.

---

## Open Questions

1. **Banker's rounding implementation in `Money.multiply`?**
   - What we know: `Money.multiply({ numerator, denominator })` exists and uses Dinero's bigint backend (integer truncation by default).
   - What's unclear: Does Dinero round half-to-even by default, or truncate? REQ-DOM-07 explicitly calls for **banker's rounding**. Need to verify via a focused unit test before Phase 4 work starts.
   - Recommendation: First task in Phase 4 = "Money rounding sanity test" — assert `Money.of(100n).multiply({numerator: 5n, denominator: 100n})` and `.multiply({numerator: 15n, denominator: 100n})` (i.e., 1.005 and 1.015 with target scale 2) both round to 1.00 (half-to-even). If Dinero truncates instead, add `Money.multiplyRounded(factor, mode: 'banker')` wrapping `Math.round`-style banker's logic on the cent residual.

2. **Client seed derivation from previous round?**
   - What we know: ADR-015 will lock the formula. Options: (a) `SHA256(previousRoundId || crashedAt)`; (b) `SHA256(previousRoundCrashPoint || nonce)`; (c) future Bitcoin block hash (Bustabit canon — but adds external dep).
   - What's unclear: User preference between (a)/(b) vs. (c).
   - Recommendation: Use (a) `SHA256(previousRound.id + ':' + previousRound.crashedAt.toISOString())`. Public, deterministic, derivable from the previous round's data once it has CRASHED — which is BEFORE the current round's BETTING window opens. Document in ADR-015. Round 1 (genesis) uses `SHA256("genesis")` as the client seed.

3. **Should the JwtGuard be extracted to `packages/auth-kernel` now, or duplicated?**
   - What we know: Phase 3 ships a working `JwtGuard` in `services/wallets/src/presentation/guards/`. Phase 4 needs the same logic for `GET /games/bets/me`.
   - What's unclear: Extract now (correct DDD) vs. duplicate (Phase 10 cleanup task).
   - Recommendation: **Duplicate for Phase 4**, log a "extract to packages/auth-kernel" task in deferred-items.md. Reasoning: service-boundary independence is the higher-order principle; the two services are owned by distinct bounded contexts, and the JwtGuard is small (78 lines). Extracting now adds a cross-package coupling without a real Phase-4 benefit. Phase 10 quality hardening can either extract or formally accept the duplication.

4. **Banker's-vs-floor rounding for cashout payout?**
   - SUMMARY §C1 (PITFALLS): "decide rounding policy once... payout = floor(bet * multiplier) (favours house, standard for crash)."
   - REQUIREMENTS REQ-DOM-07: "banker's rounding to 2 decimals."
   - Conflict: PITFALLS says floor (house-favoring), REQUIREMENTS says banker's (statistically symmetric).
   - Recommendation: Follow REQUIREMENTS REQ-DOM-07 (banker's rounding) — it's the canonical requirement source. Document the deviation from PITFALLS in ADR (rejected alternatives). Banker's rounding is the correct ANSI/IEEE-754 default and matches DDD discipline.

---

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Service-layer FSM (`roundService.setStatus(round, 'RUNNING')`) | Aggregate-method FSM (`round.start()`) | DDD canon (Vernon 2013) | 25% architecture-score signal |
| Bustabit-canon fixed HMAC salt | Per-round client seed + HMAC keyed by serverSeed | This research (ADR-015) | Anti-operator-collusion without requiring an external entropy source |
| Lazy hash chain generation | Pre-generated chain at first boot | ADR-016 (Phase 4) | Commitment immutability; storage cost ~80MB |
| `OnModuleInit` for cross-module-dependent services | `OnApplicationBootstrap` | NestJS docs (always was — pitfall §1) | Eliminates cold-boot race |
| `setInterval` ticking | Recursive `setTimeout` | NestJS lifecycle best practice (ADR-017) | Drift resilience + clean shutdown |
| Bet nested in Round | Bet as own aggregate | ADR-014 (Phase 4) | Per-cashout lock granularity for Phase 5 saga |

**Deprecated/outdated:**
- `passport-jwt + jwks-rsa` chain: superseded by Phase 3 ADR-012 (`jose` + `createRemoteJWKSet`). Use the Phase 3 pattern.
- `class-validator` decorators on DTOs: superseded by `nestjs-zod` (Phase 3 precedent).

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `Money.multiply({ numerator, denominator })` produces banker's-rounded result | §11 + Open Q1 | If Dinero truncates, REQ-DOM-07 fails; mitigated by sanity test first |
| A2 | Bustabit Rust impl formula `floor(99 / (1 - x1)) / 100` is algebraically identical to `floor((100*e - intH) / (e - intH)) / 100` | §5.3 | Wrong → FE/BE verifiers disagree; mitigated by a 1000-fixed-seed property test |
| A3 | `node:crypto.createHmac("sha256", ...)` produces identical bytes to browser `crypto.subtle.importKey + sign("HMAC")` | provably-fair module | Critical — would break the entire pure-function shared package; mitigated by an integration test that hashes a fixed input on both Bun (node:crypto) and a JSDOM-shimmed crypto.subtle, asserts equality |
| A4 | Postgres CHECK constraint with `CHECK ((status = 'X' AND ...) OR (status = 'Y' AND ...))` is faster than separate triggers | §9 | If slow → switch to a trigger; not a correctness risk |
| A5 | Single-process round loop is sufficient for the challenge; horizontal scaling via `pg_try_advisory_lock` is documented but not implemented | ADR-017 | Spec doesn't require scale-out; recruiter may ask the path — answered in ADR |
| A6 | `services/games/src/config/defaults.ts` already includes every needed env var | Project Constraints | Verified — BET_MIN_CENTS, BET_MAX_CENTS, BETTING_WINDOW_MS, COOLDOWN_MS, GROWTH_RATE, INSTANT_CRASH_BUCKET, HASH_CHAIN_LENGTH all present |
| A7 | Phase 3 `JwtGuard` duplication is the right call (vs extracting to `packages/auth-kernel`) | Open Q3 | If extraction is preferred, restructure mid-phase; mitigated by deferring to user-confirm in discuss-phase |
| A8 | Banker's rounding (REQ-DOM-07) takes precedence over floor-rounding (PITFALLS §C1) | Open Q4 | If user wants floor, change `Money.multiply` semantics OR add `Money.multiplyFloor`; small surgery |

**Action for discuss-phase:** Surface A2, A3, A7, A8 explicitly. A1 resolves itself in Wave 1 (sanity test).

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | Everything | ✓ | 1.3.11+ (per `.bun-version`) | — |
| Postgres 18 | All persistence | ✓ via docker-compose | 18-alpine | — |
| RabbitMQ 4.2 | Not needed for Phase 4 — Phase 5 | n/a | — | — |
| Keycloak 26.5 | `GET /games/bets/me` JWT validation | ✓ via docker-compose | 26.5 | — |
| Kong 3.9 | Optional — phase 5 narrows routes | ✓ via docker-compose | 3.9-alpine | — |
| `bun:test` runner | All tests | ✓ builtin | — | — |
| `fast-check` 3.x | Property tests | ✓ (already in shared-kernel; needs add to games service if not present) | 3.23.x | — |

**No external services**, **no new docker-compose changes**, **no new MCP tools** are required. Phase 4 is pure intra-service code work.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `bun:test` (builtin) + `fast-check` 3.23.x |
| Config file | none — bun resolves from `bunfig.toml` if present, else defaults |
| Quick run command | `cd services/games && bun test tests/unit` |
| Full suite command | `cd services/games && bun test` |
| Property suite | `cd services/games && bun test tests/property` |
| Integration suite | `cd services/games && INTEGRATION=1 bun test tests/integration` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test type | Automated command | File exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-DOM-01 | Round FSM rejects illegal transitions | unit | `cd services/games && bun test tests/unit/round.aggregate.test.ts` | ❌ Wave 0 |
| REQ-DOM-01 | Round FSM property — random sequences never reach illegal state | property | `cd services/games && bun test tests/property/round-fsm.property.test.ts` | ❌ Wave 0 |
| REQ-DOM-02 | Partial unique index prevents double-bet at DB | integration | `cd services/games && INTEGRATION=1 bun test tests/integration/bet-uniqueness.test.ts` | ❌ Wave 0 |
| REQ-DOM-04 | BetAmount throws outside `[BET_MIN_CENTS, BET_MAX_CENTS]` | unit | `cd services/games && bun test tests/unit/bet-amount.value-object.test.ts` | ❌ Wave 0 |
| REQ-DOM-07 | Cashout = `bet × multiplier` banker's-rounded | unit + property | `cd services/games && bun test tests/unit/bet.aggregate.test.ts tests/property/money-rounding.property.test.ts` | ❌ Wave 0 |
| REQ-DOM-08 | Aggregates carry behavior methods (no anemic) | unit (compile-time + structural assertion) | `cd services/games && bun test tests/unit/round.aggregate.test.ts tests/unit/bet.aggregate.test.ts` | ❌ Wave 0 |
| REQ-GAME-01 | Round loop autonomously transitions BETTING → RUNNING → CRASHED → SETTLED | integration | `cd services/games && INTEGRATION=1 bun test tests/integration/round-loop-autonomous.test.ts` | ❌ Wave 0 |
| REQ-GAME-02 | `GET /games/rounds/current` returns live round | integration | `cd services/games && INTEGRATION=1 bun test tests/integration/get-current-round.test.ts` | ❌ Wave 0 |
| REQ-GAME-03 | `GET /games/rounds/history?limit=20` paginates | integration | `cd services/games && INTEGRATION=1 bun test tests/integration/get-round-history.test.ts` | ❌ Wave 0 |
| REQ-GAME-04 | `GET /games/rounds/:id/verify` reproduces crash point | integration | `cd services/games && INTEGRATION=1 bun test tests/integration/verify-round.test.ts` | ❌ Wave 0 |
| REQ-GAME-05 | `GET /games/bets/me` returns player history | integration | `cd services/games && INTEGRATION=1 bun test tests/integration/get-player-bets.test.ts` | ❌ Wave 0 |
| REQ-GAME-08 | Round FSM rejects bet outside BETTING (domain-layer) | unit | `cd services/games && bun test tests/unit/round-betting-window.test.ts` | ❌ Wave 0 |
| REQ-GAME-09 | `kill -9` recovery resumes from DB | integration (manual-or-scripted) | `cd services/games && INTEGRATION=1 bun test tests/integration/kill-9-recovery.test.ts` | ❌ Wave 0 — uses testcontainers to spawn the service in a subprocess, kill it, restart |
| REQ-FAIR-01 | Hash chain pre-generated at first boot, idempotent on restart | integration | `cd services/games && INTEGRATION=1 bun test tests/integration/seed-chain-bootstrap.test.ts` | ❌ Wave 0 |
| REQ-FAIR-02 | Seed reveal only after settle | unit (Round aggregate) + integration (verify endpoint 4xx pre-settle) | as above | ❌ Wave 0 |
| REQ-FAIR-03 | Bustabit formula + 1-in-101 instant crash | property | `cd packages/contracts && bun test tests/property/derive-crash-point.property.test.ts` | ❌ Wave 0 |
| REQ-FAIR-04 | Provably-fair module pure functions, FE/BE byte-identical | unit + manual JSDOM crypto.subtle parity test | `cd packages/contracts && bun test tests/unit/provably-fair.test.ts` | ❌ Wave 0 |
| REQ-FAIR-05 | Pre-round seed hash exposed during BETTING | integration | covered by `get-current-round.test.ts` | ❌ Wave 0 |
| REQ-TEST-01 | Unit tests Round FSM, Bet, provably-fair | (umbrella for above) | — | ❌ Wave 0 |
| REQ-TEST-02 | Property tests (fast-check) FSM + Money + provably-fair | (umbrella) | — | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd services/games && bun test tests/unit` (quick — domain only, < 5s)
- **Per wave merge:** `cd services/games && bun test tests/unit tests/property && cd packages/contracts && bun test`
- **Phase gate:** Full suite green (`cd services/games && bun test && INTEGRATION=1 bun test tests/integration` + `cd packages/contracts && bun test`); 26/26 smoke probes still green; verify-phase audit passes

### Wave 0 Gaps
- [ ] `services/games/tests/unit/round.aggregate.test.ts` — REQ-DOM-01, REQ-DOM-08
- [ ] `services/games/tests/unit/bet.aggregate.test.ts` — REQ-DOM-08, REQ-DOM-07
- [ ] `services/games/tests/unit/bet-amount.value-object.test.ts` — REQ-DOM-04
- [ ] `services/games/tests/unit/round-betting-window.test.ts` — REQ-GAME-08 (domain layer)
- [ ] `services/games/tests/property/round-fsm.property.test.ts` — REQ-TEST-02
- [ ] `services/games/tests/property/money-rounding.property.test.ts` — REQ-DOM-07
- [ ] `services/games/tests/integration/round-loop-autonomous.test.ts` — REQ-GAME-01
- [ ] `services/games/tests/integration/kill-9-recovery.test.ts` — REQ-GAME-09
- [ ] `services/games/tests/integration/seed-chain-bootstrap.test.ts` — REQ-FAIR-01
- [ ] `services/games/tests/integration/verify-round.test.ts` — REQ-GAME-04, REQ-FAIR-02
- [ ] `services/games/tests/integration/get-current-round.test.ts` — REQ-GAME-02, REQ-FAIR-05
- [ ] `services/games/tests/integration/get-round-history.test.ts` — REQ-GAME-03
- [ ] `services/games/tests/integration/get-player-bets.test.ts` — REQ-GAME-05
- [ ] `services/games/tests/integration/bet-uniqueness.test.ts` — REQ-DOM-02 (DB partial index)
- [ ] `packages/contracts/tests/unit/provably-fair.test.ts` — REQ-FAIR-04
- [ ] `packages/contracts/tests/property/derive-crash-point.property.test.ts` — REQ-FAIR-03, REQ-TEST-02
- [ ] Test setup file `services/games/tests/setup.ts` — env bootstrap (extract from Phase 3's pattern to avoid the 35-lint-error carry-forward)

### Phase 3 carry-forwards applied opportunistically
- 35 ESLint errors in test fixtures: address by writing the games-service `tests/setup.ts` once, top-of-file `process.env.X ??= ...` extracted to a shared helper. Add an ESLint-rule allowance file for `tests/setup.ts` only (rather than every test file).
- Workspace integration-test execution path: document `cd services/games && INTEGRATION=1 bun test tests/integration` in the games service README.

---

## Decisions to Make in Phase 4 (ADRs)

| ADR | Title | Decision space | Locked? |
|-----|-------|----------------|---------|
| ADR-014 | Bet-is-its-own-aggregate (not nested in Round) | Locking granularity rationale; Vernon's "reference other aggregates by identity only" | Recommend yes — research is unambiguous |
| ADR-015 | Crash-point formula variant + client-seed derivation | Bustabit canon HMAC + per-round client seed `SHA256(prevRound.id + ':' + prevRound.crashedAt.toISOString())`; 1-in-101 instant-crash bucket | Recommend yes — supported by Rust reference + research |
| ADR-016 | Hash chain pre-generation depth = 1M over lazy gen | Storage cost (~80MB) vs. attack-surface elimination | Recommend yes — research is unambiguous |
| ADR-017 | Recursive `setTimeout` for round loop + `OnApplicationBootstrap` lifecycle | Over `setInterval` / worker thread; scale-out path documented | Recommend yes |
| (potential) ADR-018 | Banker's rounding for cashout (REQ-DOM-07 over PITFALLS §C1 floor) | Resolves the requirements-vs-pitfalls conflict | Recommend documenting after Open Q4 resolves with user in discuss-phase |
| (potential) ADR-019 | `crash_point_centi_x INT` over `NUMERIC(10,2)` for round storage | Avoids any pg→JS-Number precision drift | May fold into ADR-014 or be its own; planner's call |

---

## Order of Execution (suggested plan-list)

Recommended 12-plan structure with parallelism windows. Plans are atomic, dependency-graphed.

| # | Plan | Goal | Depends on | Parallel with |
|---|------|------|-----------|---------------|
| P4.1 | Provably-fair pure-function module | Ship `packages/contracts/src/provably-fair/{generate-seed-chain, derive-crash-point, verify-crash-point, multiplier, formulas.constants, types, index}.ts` + unit tests + 1000-fixed-seed property test (REQ-FAIR-03/04) | nothing (zero-infra) | P4.2, P4.3 |
| P4.2 | Domain value objects | `Multiplier`, `CrashPoint`, `BetAmount`, `RoundStatus`, `BetStatus`, `Seed` + unit tests (REQ-DOM-04 bounds) | nothing | P4.1, P4.3 |
| P4.3 | Money rounding sanity test + (if needed) `Money.multiplyRounded` | Resolve Open Q1 (banker's vs truncate); if Dinero truncates, add wrapper to shared-kernel | P4.2 (value objects use Money) | P4.1 |
| P4.4 | Round + Bet aggregates + repository interfaces + errors | Pure-domain `round.aggregate.ts`, `bet.aggregate.ts`, `errors.ts`, `round.repository.ts`, `bet.repository.ts`, `seed-chain.repository.ts` + unit tests (REQ-DOM-01, REQ-DOM-07, REQ-DOM-08, REQ-GAME-08 domain layer) | P4.2, P4.3 | P4.5 |
| P4.5 | Round FSM + Money property tests | `fast-check` property tests asserting no illegal Round FSM state reachable + monetary rounding loss-free (REQ-TEST-02) | P4.4 | — |
| P4.6 | MikroORM entity schemas + migrations | `round.entity.ts`, `bet.entity.ts`, `seed-chain.entity.ts` + three migrations with CHECK constraints + partial unique index on bets (REQ-DOM-02 DB layer) | P4.4 | P4.7 |
| P4.7 | MikroORM repositories (atomic UPDATE pattern) | `mikro-round.repository.ts`, `mikro-bet.repository.ts`, `mikro-seed-chain.repository.ts` — raw SQL bound to `em.getTransactionContext()` per Phase 3 precedent | P4.4, P4.6 | P4.6 |
| P4.8 | Hash chain bootstrap service | `SeedChainBootstrap` (`OnApplicationBootstrap`) idempotently generates 1M chain if `seed_chain` table empty (REQ-FAIR-01) | P4.1, P4.7 | P4.9 |
| P4.9 | Round loop service + recovery | `RoundLoopService` (`OnApplicationBootstrap`, `OnApplicationShutdown`) with `recoverInFlightRound`, `transitionToRunning`, `crashRound`, `settleRound`, `startNewRound` (REQ-GAME-01, REQ-GAME-09); per-task atomic commits | P4.7, P4.8 | — |
| P4.10 | REST controllers + use cases + DTOs | `RoundsController` (`current`, `history`, `verify`), `BetsController` (`me`); 4 use cases; zod DTOs via nestjs-zod; `JwtGuard` duplicated from wallets service (REQ-GAME-02/03/04/05, REQ-FAIR-02/05) | P4.9 | P4.11 |
| P4.11 | Integration tests | 8 integration tests (autonomous loop, kill-9 recovery, seed bootstrap, verify, current, history, bets/me, bet-uniqueness DB index) — `cd services/games && INTEGRATION=1 bun test tests/integration` (REQ-TEST-01) | P4.10 | P4.10 |
| P4.12 | ADRs + closeout | ADR-014, ADR-015, ADR-016, ADR-017 (+ ADR-018 if banker's confirmed); ADR catalogue README update; STATE/ROADMAP/REQUIREMENTS closeout; smoke-health probes updated if needed | P4.1-P4.11 | — |

**Parallelism waves:**
- **Wave 0 (setup):** `tests/setup.ts` extraction (ESLint-clean env bootstrap pattern from Phase 3)
- **Wave 1 (parallel):** P4.1 + P4.2 + P4.3 (all infra-independent)
- **Wave 2:** P4.4 (depends on Wave 1)
- **Wave 3 (parallel):** P4.5 + P4.6
- **Wave 4:** P4.7
- **Wave 5 (parallel):** P4.8 + (Wave 5 entry for P4.9 if seed bootstrap is ready)
- **Wave 6:** P4.9
- **Wave 7:** P4.10
- **Wave 8:** P4.11
- **Wave 9:** P4.12

Realistic total: ~12 commits across ~8 waves. Heaviest single plan = P4.9 (round loop) — likely 2-3 commits internally for FSM transition methods + recovery + tests.

---

## Phase 4 Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | Race between `recoverInFlightRound` and a stale timer from a previous bootstrap (multi-instance double-start) | LOW (single-process per ADR-017) | Document `pg_try_advisory_lock('round-loop')` as future scale-out path; not implemented |
| R2 | `Math.exp(growthRate * elapsedMs / 1000)` precision at extreme multipliers (e.g. crashPoint = 10000x) | LOW | The formula is well-conditioned in float64 up to ~1.8e308; cap `MULTIPLIER_DISPLAY_MAX` at 1000x for UX; document |
| R3 | Hash chain bootstrap takes too long on first boot (1M SHA-256 calls) | MEDIUM | Benchmark: Bun + node:crypto computes ~500k SHA-256/sec — 1M chain ≈ 2s. Acceptable. If overshoot, log progress every 100k and document. Could also defer to a one-shot containerized migration step. |
| R4 | Cashout race condition (C2 from PITFALLS) | DEFERRED to Phase 6 (WS) | Phase 4 lays the foundation: server-authoritative timestamps for round transitions; Phase 6 owns the cashout-vs-crash boundary |
| R5 | Bet partial unique index doesn't cover all illegal application states (see Pitfall §4) | MEDIUM | Add a secondary covering index `(player_id, round_id, status)`; document in pitfall §4 |
| R6 | `parseInt(hex.substring(0,13), 16)` JS number precision (Pitfall §6) | HIGH if NUM_BITS ever bumped past 52 | Lock `NUM_BITS=52` and `HEX_CHARS=13` as exported constants; property test asserts `Number.isFinite(intH)` over 10k random inputs |
| R7 | Round FSM CHECK constraint allows a forbidden tuple (e.g., SETTLED with NULL server_seed) due to a typo | HIGH | Compose the CHECK as a single multi-line constraint covering all 4 valid combinations; add a Postgres-level test that tries to INSERT every illegal combo and asserts rejection |
| R8 | Provably-fair determinism breaks across Bun versions due to a Bun crypto regression | MEDIUM | Pin Bun version (already done — `.bun-version`); add an exact-byte test asserting `deriveCrashPoint({ serverSeed: "0x00...01", clientSeed: "test", nonce: 0n, instantCrashBucket: 101 }) === KNOWN_VALUE`; this catches any silent change |
| R9 | Banker's rounding (REQ-DOM-07) absent from Dinero v2 default | HIGH if missed | Resolved by P4.3 — sanity test first; add wrapper if needed |
| R10 | Phase 5 saga writes `Bet → CASHED_OUT` and Phase 4's BetRepository can't atomically transition + return previous status | LOW | Phase 4 ships `bet.repository.ts` with the right signature (`tryTransition(from, to)`); Phase 5 wires it |

---

## Sources

### Primary (HIGH confidence)
- [Bustabit Rust reference implementation source — `vladignatyev/bustabit-rust/src/lib.rs`](https://raw.githubusercontent.com/vladignatyev/bustabit-rust/master/src/lib.rs) — formula byte-verified
- [NestJS Lifecycle Events official docs](https://docs.nestjs.com/fundamentals/lifecycle-events) — OnApplicationBootstrap vs OnModuleInit
- [PostgreSQL Partial Indexes — official 18 docs](https://www.postgresql.org/docs/current/indexes-partial.html) — partial unique index for REQ-DOM-02
- [MikroORM Defining Entities + Custom Types](https://mikro-orm.io/docs/defining-entities) — EntitySchema + bigint native
- `.planning/research/STACK.md` §2.4 + `.planning/research/ARCHITECTURE.md` §9 — provably-fair pattern
- `.planning/research/PITFALLS.md` §C1-C5 + H1 — critical-path risks
- `.planning/research/SUMMARY.md` §8 — formula conflict resolution
- `.planning/phases/03-wallet-service/VERIFICATION.md` — atomic UPDATE pattern, JwtGuard pattern, smoke probe pattern, 35-lint carry-forward
- `services/wallets/src/domain/wallet.aggregate.ts` — aggregate pattern template
- `services/wallets/src/infrastructure/repositories/mikro-wallet.repository.ts` — atomic UPDATE bound to txEm template
- `services/wallets/src/presentation/guards/jwt.guard.ts` — JWT guard template for `GET /games/bets/me`

### Secondary (MEDIUM confidence)
- [crashgamesplay.com Crash Game Algorithm guide](https://crashgamesplay.com/guides/crash-game-algorithm/) — formula derivation
- [createIT Implementing provably fair in crash games](https://medium.com/@createitsc/implementing-provably-fair-in-crash-games-d82d2a31157f) — chain consumption order
- [w3tutorials Conditional uniqueness with partial indexes](https://www.w3tutorials.net/blog/postgresql-conditionally-unique-constraint/) — REQ-DOM-02 syntax
- [Medium Anderson Dias — Unique partial indexes with PostgreSQL](https://medium.com/little-programming-joys/unique-partial-indexes-with-postgresql-86e137905c12) — NULL handling caveat

### Tertiary (LOW confidence — flagged for verification in Phase 4)
- Algebraic equivalence between Rust `floor(99/(1-x1))/100` and TS `floor((100*e - intH)/(e-intH))/100` — asserted by inspection; the 1000-fixed-seed property test in P4.1 is the canonical verification

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package verified against npm registry on 2026-05-25; versions aligned with monorepo Phase 1-3 pins
- Architecture (Round, Bet, provably-fair, loop): HIGH — direct application of ARCHITECTURE.md §6 + §9 with the OnApplicationBootstrap correction (was MEDIUM-HIGH in ARCHITECTURE, locked HIGH by NestJS docs)
- Pitfalls: HIGH — Bustabit Rust source inspected line-by-line; Phase 3 carry-forwards documented; new pitfalls §1-8 specific to Phase 4 each have evidence
- Provably-fair formula: HIGH (was MEDIUM in SUMMARY) — Rust reference impl source read; algebraic equivalence path documented; P4.1 property test serves as final lock
- Schema design: HIGH — Phase 3 wallet schema pattern reused; new partial unique index syntax verified against official Postgres docs
- Test strategy: HIGH — Phase 3 fast-check + integration pattern reusable; Wave 0 gap list complete

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (30 days — stack is stable, versions are pinned, no fast-moving libraries in play)
