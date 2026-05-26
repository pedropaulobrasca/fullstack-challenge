---
phase: 04-game-core
plan: 05
subsystem: games-application
tags: [bootstrap, idempotency, hash-chain, di-wiring, on-application-bootstrap]
dependency-graph:
  requires:
    - Plan 04-01 (@crash/contracts generateSeedChain)
    - Plan 04-04 (SeedChainRepository, MikroSeedChainRepository, EntitySchemas)
  provides:
    - services/games/src/application/seed-chain-bootstrap.service.ts (SeedChainBootstrap @Injectable, implements OnApplicationBootstrap)
    - services/games/src/application/game-core.module.ts (GameCoreModule with MikroOrmModule.forFeature + 3 repo bindings + bootstrap provider)
    - services/games/src/app.module.ts (extended imports with GameCoreModule)
  affects:
    - Plan 04-06 round loop service consumes the populated seed chain
    - Plan 04-08 verify endpoint reads (seed, hash) pairs by nonce
tech-stack:
  added: []
  patterns:
    - "@nestjs/common OnApplicationBootstrap lifecycle (NOT OnModuleInit per research Pitfall 1)"
    - "MikroOrmModule.forFeature for module-scoped EntitySchema availability alongside global forRoot registration"
    - "Protected resolveChainLength() seam for in-memory unit testing without invoking env parsing"
key-files:
  created:
    - services/games/src/application/seed-chain-bootstrap.service.ts
    - services/games/src/application/game-core.module.ts
    - services/games/tests/unit/seed-chain-bootstrap.service.test.ts
  modified:
    - services/games/src/app.module.ts
    - services/games/src/domain/seed-chain.repository.ts
    - services/games/src/infrastructure/repositories/mikro-seed-chain.repository.ts
    - services/games/tests/setup.ts
decisions:
  - "Idempotency guard checks SeedChainRepository.countEntries() > 0n before invoking generateSeedChain — the chain commitment story (REQ-FAIR-01) requires that hash[0] be immutable across restarts (Pitfall 7)."
  - "OnApplicationBootstrap chosen over OnModuleInit so MikroORM is guaranteed connected before the count query fires (research Pitfall 1)."
  - "insertChain signature extended to carry seed alongside hash and nonce; the seed_chain.seed column is populated at bootstrap but the reveal gate stays at the aggregate boundary (Round.settle is the only path that publishes serverSeed; verify use case must check round.status === SETTLED before exposing the column)."
  - "Test infrastructure: extended tests/setup.ts to default KEYCLOAK_* env values and added a protected resolveChainLength() seam so the bootstrap is unit-testable with a 32-entry in-memory repository without spinning up Postgres."
metrics:
  duration_seconds: 374
  task_count: 1
  files_created: 3
  files_modified: 4
  completed_at: 2026-05-26T21:18:13Z
---

# Phase 04 Plan 05: Seed Chain Bootstrap and GameCoreModule Wiring Summary

Single-task plan ships the SeedChainBootstrap service plus the GameCoreModule that wires the three games-service repositories into DI. The bootstrap fires once per cold boot under the NestJS OnApplicationBootstrap lifecycle hook, generates the full HASH_CHAIN_LENGTH-entry hash chain via the pure `@crash/contracts` `generateSeedChain` function, and persists `(nonce, hash, seed)` triples in 1k-row batches. On every subsequent boot the `countEntries() > 0n` guard short-circuits with a structured log line — the chain commitment from first-boot stays immutable, defeating the pre-knowledge attack described in research Pitfall 7.

## What Landed

- **`services/games/src/application/seed-chain-bootstrap.service.ts`** — `SeedChainBootstrap @Injectable implements OnApplicationBootstrap`. Constructor injects `SEED_CHAIN_REPOSITORY` via `@Inject`. The hook:
  1. Calls `chain.countEntries()`; if `> 0n` logs `"seed chain already initialized at depth ${count}"` and returns.
  2. Otherwise calls `generateSeedChain(length)` from `@crash/contracts`, measuring wall-clock time with `performance.now()`.
  3. Inserts entries in 1000-row batches via `chain.insertChain(slice)` with `"seed chain insert progress: X/Y"` logs every 100k rows.
  4. Logs `"seed chain bootstrapped: ${length} entries, gen=${genMs}ms, insert=${insertMs}ms"` on completion.
  Protected `resolveChainLength(): bigint` returns `BigInt(env.HASH_CHAIN_LENGTH)` — overridable by tests.
- **`services/games/src/application/game-core.module.ts`** — `MikroOrmModule.forFeature([SeedChainEntitySchema, RoundEntitySchema, BetEntitySchema])` plus the three `useClass` repository bindings (`SEED_CHAIN_REPOSITORY → MikroSeedChainRepository`, `ROUND_REPOSITORY → MikroRoundRepository`, `BET_REPOSITORY → MikroBetRepository`) plus the `SeedChainBootstrap` provider. (Wave 04-08 added four use-case providers to this same module on top of the wiring shipped here.)
- **`services/games/src/app.module.ts`** — imports array extended with `GameCoreModule` after `MikroOrmModule.forRoot` and `MessagingSpineModule.forRootAsync` so the global ORM is initialized before any feature-scoped EntitySchema is registered.
- **`services/games/src/domain/seed-chain.repository.ts`** — `SeedChainEntry` now carries `seed: string` alongside `nonce` and `hash` so the bootstrap can persist the full triple in one DB round trip per batch.
- **`services/games/src/infrastructure/repositories/mikro-seed-chain.repository.ts`** — `insertChain` placeholder list updated to `(?, ?, ?)` and the params loop pushes the seed value in addition to nonce+hash; INSERT target columns now `(nonce, hash, seed)`.
- **`services/games/tests/setup.ts`** — `applyDefaults()` runs at module load (top-level invocation kept) and now also seeds `KEYCLOAK_ISSUER` / `KEYCLOAK_JWKS_URI` / `KEYCLOAK_AUDIENCE` defaults so any unit test that imports `src/application/*` (which transitively loads `config/defaults`) can parse env without a live Keycloak realm. Function still exported for explicit re-invocation from existing tests.

## Verification

| Check | Outcome |
|---|---|
| `bunx tsc --noEmit` from services/games | clean, exit 0 |
| `grep "OnApplicationBootstrap" services/games/src/application/seed-chain-bootstrap.service.ts` | matches in import line and `implements` clause |
| `grep -c "OnModuleInit" services/games/src/application/seed-chain-bootstrap.service.ts` | 0 |
| `grep "HASH_CHAIN_LENGTH" services/games/src/application/seed-chain-bootstrap.service.ts` | `return BigInt(env.HASH_CHAIN_LENGTH);` |
| `grep "countEntries" services/games/src/application/seed-chain-bootstrap.service.ts` | guard present in `onApplicationBootstrap` |
| `grep "GameCoreModule" services/games/src/app.module.ts` | import + entry in imports array |
| `bun test tests/unit` from services/games | 111 pass / 0 fail / 293 expect() calls (12 files) |
| `bun test tests/unit/seed-chain-bootstrap.service.test.ts` | 3 pass / 0 fail / 73 expect() calls |

## Bootstrap timing (unit-test scale, 32-entry chain on a M-series Mac)

```
seed chain bootstrapped: 32 entries, gen=0ms, insert=0ms
seed chain already initialized at depth 32
```

The 1M-entry production timing is deferred to live boot; the research §Risk R3 budget of ~2s gen + bounded insert wall-clock will be measured during Phase 4 verify (or live Phase 10 boot).

## Idempotency log line (verbatim)

```
seed chain already initialized at depth ${count}
```

Verified by the second `bun test` run of `idempotency guard checks the count before generating`, which pre-seeds one row and asserts `insertCalls === 0` after a fresh `onApplicationBootstrap()` call.

## GameCoreModule providers list (as of this plan; wave 04-08 will append use cases)

| Token / Class | Binding |
|---|---|
| `SEED_CHAIN_REPOSITORY` | `useClass: MikroSeedChainRepository` |
| `ROUND_REPOSITORY` | `useClass: MikroRoundRepository` |
| `BET_REPOSITORY` | `useClass: MikroBetRepository` |
| `SeedChainBootstrap` | direct class provider |

Exports: the three repository tokens (the bootstrap stays internal — only the OnApplicationBootstrap hook needs to wake it).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Test infrastructure missing Keycloak env defaults**

- **Found during:** First run of the new unit test — `bun test tests/unit/seed-chain-bootstrap.service.test.ts` failed with a ZodError because `config/defaults.ts` requires `KEYCLOAK_ISSUER` and `KEYCLOAK_JWKS_URI`.
- **Issue:** Existing unit tests for domain aggregates (`round.aggregate.test.ts`, `bet.aggregate.test.ts`, etc.) never imported `src/application/*` or `src/config/defaults.ts`, so the gap was invisible. The new bootstrap test does, transitively, and the strict Zod env parse rejected the missing variables.
- **Fix:** Added three `??=` defaults to `tests/setup.ts` (`KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URI`, `KEYCLOAK_AUDIENCE`) and lifted `applyDefaults()` to a module-level call so the assignments happen on `import` rather than only via the exported function.
- **Files modified:** `services/games/tests/setup.ts`
- **Commit:** `7abf606`

**2. [Rule 3 — Blocking] env.HASH_CHAIN_LENGTH not test-overridable due to ESM import hoisting**

- **Found during:** Attempting to write the idempotency unit test against `process.env.HASH_CHAIN_LENGTH = "32"`.
- **Issue:** Bun's ESM module loader hoists import statements above the test file's top-level statements; `tests/setup.ts` runs `applyDefaults()` at import time which uses `??=` against the default `1_000_000`. Setting `process.env.HASH_CHAIN_LENGTH` from the test body (after the import) was too late — by then `config/defaults.ts` had already frozen the parsed env. First test run generated 1M entries instead of 32.
- **Fix:** Added a `protected resolveChainLength(): bigint` seam on `SeedChainBootstrap` that returns `BigInt(env.HASH_CHAIN_LENGTH)` by default; the test subclasses with `TestableBootstrap` and overrides the seam to return `32n`. Production behavior is unchanged (the protected method has the same body as the previous inline reference).
- **Files modified:** `services/games/src/application/seed-chain-bootstrap.service.ts`
- **Commit:** `7abf606`

No Rule 1 / Rule 2 / Rule 4 deviations.

## Threat Model Compliance

| Threat ID | Disposition | Mitigation in this plan |
|---|---|---|
| T-04-05-01 (Chain regeneration on restart) | mitigate | `countEntries() > 0n` short-circuit + structured log line; reproduced in unit test "re-running on a populated repository short-circuits". |
| T-04-05-02 (Operator pre-knowledge of seeds) | mitigate | `generateSeedChain` uses `randomBytes(32)` for the terminal seed (Plan 04-01); bootstrap publishes the commitment at first boot only. |
| T-04-05-03 (Seed leak before reveal) | mitigate | `seed_chain.seed` column populated at bootstrap; reveal gate is at the Round aggregate boundary — verify use case (Plan 04-08) must check `round.status === SETTLED`. |
| T-04-05-04 (1M chain OOM) | accept | Research §Risk R3 — ~80MB heap; 1k-row insert batches keep the SQL parameter count well under Postgres' ~65k ceiling; documented in PLAN. |

## Threat Flags

None — no new trust boundaries beyond what was already modeled in the plan's threat register.

## Known Stubs

None.

## Requirements Closed

- **REQ-FAIR-01** — Hash chain pre-generated at first boot, idempotent on subsequent boots. The protected unit test pins the count-guard behavior; the production behavior is wired into AppModule and will fire on the next live boot.

## Commits

| Task | Description | Hash |
|---|---|---|
| 1 | SeedChainBootstrap @Injectable + GameCoreModule + AppModule wiring | `7abf606` |

## Self-Check: PASSED

- `services/games/src/application/seed-chain-bootstrap.service.ts` — FOUND
- `services/games/src/application/game-core.module.ts` — FOUND
- `services/games/tests/unit/seed-chain-bootstrap.service.test.ts` — FOUND
- `services/games/src/app.module.ts` — `GameCoreModule` import and imports-array entry present
- `services/games/src/domain/seed-chain.repository.ts` — `SeedChainEntry.seed: string` field present
- `services/games/src/infrastructure/repositories/mikro-seed-chain.repository.ts` — `INSERT INTO seed_chain (nonce, hash, seed)` present
- `services/games/tests/setup.ts` — `KEYCLOAK_*` defaults present
- Commit `7abf606` — FOUND in git log
- `bunx tsc --noEmit` from services/games — clean
- 111/111 unit tests pass (including 3 new bootstrap tests)
