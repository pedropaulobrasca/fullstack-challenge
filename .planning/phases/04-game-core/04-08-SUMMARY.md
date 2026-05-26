---
phase: 04-game-core
plan: 08
subsystem: games-presentation
tags: [rest, dto, zod, nestjs-zod, jwt-guard, provably-fair, read-side]
dependency-graph:
  requires:
    - Plan 04-04 (RoundRepository / BetRepository / SeedChainRepository implementations)
    - Plan 04-05 (GameCoreModule + repository DI tokens registered)
    - Plan 04-07 (JwtGuard + AuthenticatedRequest in services/games/src/presentation/guards/)
    - "@crash/contracts: deriveCrashPoint, FORMULA_VERSION, multiplierAt, moneySnapshotSchema"
  provides:
    - services/games/src/application/use-cases/get-current-round.use-case.ts
    - services/games/src/application/use-cases/get-round-history.use-case.ts
    - services/games/src/application/use-cases/verify-round.use-case.ts
    - services/games/src/application/use-cases/get-player-bets.use-case.ts
    - services/games/src/presentation/controllers/rounds.controller.ts (GET /games/rounds/current, /history, /:roundId/verify — public)
    - services/games/src/presentation/controllers/bets.controller.ts (GET /games/bets/me — JwtGuard-protected)
    - services/games/src/presentation/dtos/current-round.dto.ts
    - services/games/src/presentation/dtos/round-history.dto.ts
    - services/games/src/presentation/dtos/verify-round.dto.ts
    - services/games/src/presentation/dtos/player-bets.dto.ts
    - BetRepository.countByRoundId(roundId): Promise<number> + MikroBetRepository implementation via em.count
  affects:
    - services/games/src/application/game-core.module.ts (four use cases registered + exported alongside repos and SeedChainBootstrap from 04-05)
    - services/games/src/app.module.ts (RoundsController + BetsController + JwtGuard + ZodValidationPipe wired)
    - services/games/package.json (nestjs-zod@5.4.0 added — matches wallets baseline)
tech-stack:
  added:
    - "nestjs-zod 5.4.0 (services/games — DTO + global ZodValidationPipe)"
  patterns:
    - "createZodDto(schema) for response DTOs (Phase 3 wallets precedent)"
    - "Limit/offset query parsing via z.coerce.number().int().min().max().default() inside the handler before delegating to use case (defense-in-depth: use case also clamps)"
    - "REQ-FAIR-02 layered gate: aggregate setter (settle is the only writer of serverSeed) + use-case guard (status !== SETTLED throws BadRequest) + use-case nullification (current endpoint zeroes serverSeed pre-SETTLED)"
    - "Player ID masking via sha256(playerId).substring(0,8) for non-self bets in GET /current"
key-files:
  created:
    - services/games/src/application/use-cases/get-current-round.use-case.ts
    - services/games/src/application/use-cases/get-round-history.use-case.ts
    - services/games/src/application/use-cases/verify-round.use-case.ts
    - services/games/src/application/use-cases/get-player-bets.use-case.ts
    - services/games/src/presentation/controllers/rounds.controller.ts
    - services/games/src/presentation/controllers/bets.controller.ts
    - services/games/src/presentation/dtos/current-round.dto.ts
    - services/games/src/presentation/dtos/round-history.dto.ts
    - services/games/src/presentation/dtos/verify-round.dto.ts
    - services/games/src/presentation/dtos/player-bets.dto.ts
    - services/games/tests/unit/get-current-round.use-case.test.ts
    - services/games/tests/unit/get-round-history.use-case.test.ts
    - services/games/tests/unit/verify-round.use-case.test.ts
    - services/games/tests/unit/get-player-bets.use-case.test.ts
  modified:
    - services/games/src/domain/bet.repository.ts (added countByRoundId)
    - services/games/src/infrastructure/repositories/mikro-bet.repository.ts (countByRoundId via em.count)
    - services/games/src/application/game-core.module.ts (registers + exports the four use cases)
    - services/games/src/app.module.ts (RoundsController + BetsController + JwtGuard + APP_PIPE ZodValidationPipe)
    - services/games/package.json (nestjs-zod 5.4.0)
decisions:
  - "REQ-FAIR-02 gated at two layers: (1) Round aggregate's settle() is the only writer of serverSeed and (2) the verify use case rejects with 400 ROUND_NOT_YET_SETTLED when status !== SETTLED. GetCurrentRoundUseCase also nullifies serverSeed in the response pre-SETTLED — defense in depth against an aggregate regression."
  - "Limit clamping lives at the use-case layer (not just the controller). Other consumers (future WebSocket history feeds, internal admin commands) reuse the protection without reimplementing it."
  - "Player ID masking sha256(playerId).substring(0,8) keeps the helper private to the GetCurrentRoundUseCase file — it is intentionally NOT a shared util because masking semantics may diverge per endpoint (e.g., GET /games/bets/me should NOT mask; the player owns those rows)."
  - "POST /games/bet and POST /games/bet/cashout are deliberately absent — research §Architectural Responsibility Map and §Anti-Patterns mandate Phase 5 owns them alongside the saga. The empty GamesController shell from Plan 04-04 is left in place; Phase 5 will populate or remove it."
  - "Kept the existing pattern of returning view types as `unknown as Dto` at the controller boundary instead of importing nestjs-zod's runtime parsing wrapper — keeps the use case decoupled from nestjs-zod and matches the wallets controller pattern."
metrics:
  duration_minutes: 30
  task_count: 2
  files_created: 14
  files_modified: 5
  tests_added: 13
  tests_passing: "111 / 111 (full games unit suite — 13 new + 98 pre-existing)"
  completed_at: "2026-05-26"
requirements:
  - REQ-GAME-02
  - REQ-GAME-03
  - REQ-GAME-04
  - REQ-GAME-05
  - REQ-FAIR-02
  - REQ-FAIR-05
---

# Phase 04 Plan 08: Games Read REST Surface Summary

Four REST READ endpoints — `GET /games/rounds/current`, `GET /games/rounds/history?limit=20`, `GET /games/rounds/:roundId/verify`, `GET /games/bets/me` — backed by four use cases under `services/games/src/application/use-cases/` and four `createZodDto` response DTOs. Three rounds/* endpoints are public (no auth); `/games/bets/me` is JwtGuard-protected. `POST /games/bet` and `/cashout` deliberately remain absent — Phase 5 owns them with the saga. REQ-FAIR-02 (seed reveal only post-SETTLED) is enforced at both the aggregate boundary and the use-case boundary; REQ-FAIR-05 (pre-round seedHash commitment) is exposed via `GET /rounds/current.seedHash` from the moment the round enters BETTING.

## Endpoint Inventory

| Method | Path | Auth | Use case | Response DTO | Spec |
|--------|------|------|----------|--------------|------|
| GET | /games/rounds/current | public | GetCurrentRoundUseCase | CurrentRoundDto | REQ-GAME-02, REQ-FAIR-05 |
| GET | /games/rounds/history | public | GetRoundHistoryUseCase | RoundHistoryDto | REQ-GAME-03 |
| GET | /games/rounds/:roundId/verify | public | VerifyRoundUseCase | VerifyRoundDto | REQ-GAME-04, REQ-FAIR-02 |
| GET | /games/bets/me | JwtGuard | GetPlayerBetsUseCase | PlayerBetsDto | REQ-GAME-05 |

## DTO Shape Summary

- **CurrentRoundDto** — roundId, status (BETTING|RUNNING|CRASHED|SETTLED), nonce (string for bigint), seedHash (REQ-FAIR-05), clientSeed, formulaVersion, four timestamps, crashPoint (number nullable), serverSeed (string nullable — populated ONLY when SETTLED), currentMultiplier (computed from `multiplierAt(now - startedAt, GROWTH_RATE)` only when RUNNING), bets[] each with `playerIdMasked` (8-char sha256 prefix) + amount/payout as MoneySnapshot.
- **RoundHistoryDto** — rounds[] {roundId, nonce, crashPoint, settledAt, totalBetCount} + clamped limit/offset.
- **VerifyRoundDto** — roundId, nonce, serverSeed, serverSeedHash, clientSeed, crashPoint (recorded), recomputedCrashPoint (from `deriveCrashPoint` with `env.INSTANT_CRASH_BUCKET`), matches, formulaVersion (from `@crash/contracts`), previousServerSeed (null for nonce 0).
- **PlayerBetsDto** — bets[] {betId, roundId, amount, status, cashedOutMultiplier, payout, createdAt} + clamped limit/offset. Money fields serialized via `serializeMoney` → `MoneySnapshot` so bigint never crosses the JSON boundary.

## REQ-FAIR-02 Gate Evidence

```text
$ grep -nE 'status !== "SETTLED"|ROUND_NOT_YET_SETTLED' services/games/src/application/use-cases/verify-round.use-case.ts
33:    if (round.status !== "SETTLED") {
34:      throw new BadRequestException({ code: "ROUND_NOT_YET_SETTLED" });
35:    }

$ grep -nE 'serverSeed' services/games/src/application/use-cases/get-current-round.use-case.ts | head -3
67:    const serverSeed = round.status === "SETTLED" ? round.serverSeed : null;
```

Defense-in-depth layered: Round.settle() is the only writer of serverSeed (Plan 04-02), the verify use case throws BadRequest pre-SETTLED, and GetCurrentRoundUseCase nullifies serverSeed in the response pre-SETTLED regardless of aggregate state.

## Absence Tests (Phase 4 scope boundary)

```text
$ grep -c "@UseGuards(JwtGuard)" services/games/src/presentation/controllers/bets.controller.ts
1
$ grep -c "@UseGuards" services/games/src/presentation/controllers/rounds.controller.ts
0
$ grep -c "@Get" services/games/src/presentation/controllers/rounds.controller.ts
3
$ grep -E "@Post|@Put|@Delete|@Patch" services/games/src/presentation/controllers/rounds.controller.ts services/games/src/presentation/controllers/bets.controller.ts
(no output)
```

POST /games/bet and POST /games/bet/cashout are NOT scaffolded.

## Verification

| Check | Outcome |
|-------|---------|
| `cd services/games && bunx tsc --noEmit` | clean, exit 0 |
| `bun test tests/unit/` (full games unit suite) | 111 / 111 green, 293 expect() |
| 13 new use-case unit tests (4 files) | 13 / 13 green |
| Controllers absence test (POST/PUT/DELETE/PATCH) | none |
| RoundsController @Get route count | 3 |
| BetsController @UseGuards(JwtGuard) | 1 (class-level) |
| RoundsController @UseGuards count | 0 (public) |

## Deviations from Plan

None requiring Rule 4. Rules 1-3 were not triggered — the plan executed exactly as written. Two minor adaptations that did NOT require Rule logging:

1. The plan listed `services/games/src/application/game-core.module.ts` in `files_modified` for both Task 1 and Task 2. Plan 04-05 (parallel wave 3) had already created the GameCoreModule with the seed chain bootstrap by the time Task 2 ran; I extended it in place with the four use case providers + exports. No conflict.
2. `nestjs-zod` was not yet a dependency of `services/games` (wallets had `5.4.0`). Added it to `services/games/package.json` and ran `bun install` to mirror the wallets baseline — needed for `createZodDto` + the global `ZodValidationPipe`.

## Threat Model Compliance

| Threat ID | Disposition | Mitigation in this plan |
|---|---|---|
| T-04-08-01 (Verify endpoint leaks seed pre-settle) | mitigate | VerifyRoundUseCase 400-throws when `round.status !== "SETTLED"`; GetCurrentRoundUseCase nullifies serverSeed in the response pre-SETTLED. Two-layer guard. |
| T-04-08-02 (Cross-player bet enumeration) | mitigate | BetsController extracts playerId from `req.user.playerId` (JWT sub claim, populated by JwtGuard); cannot be tampered after signature verification. |
| T-04-08-03 (Player ID enumeration via /current) | mitigate | `playerIdMasked = sha256(playerId).substring(0,8)` — non-reversible for non-self entries. |
| T-04-08-04 (SQL injection via limit/offset/roundId) | mitigate | All inputs run through zod schemas (`z.coerce.number().int().min().max()` + `z.string().uuid()`); repositories use parameterized queries from Plan 04-04. |
| T-04-08-05 (DoS via large history pagination) | mitigate | limit clamped to [1, 100] at the use-case layer regardless of caller input. |

## Threat Flags

None — no new trust boundaries or surfaces introduced beyond the threat register.

## Known Stubs

None. Every endpoint is fully implemented; DTOs match the use case view shapes 1:1.

## Requirements Closed

- REQ-GAME-02 — `GET /games/rounds/current` returns live round + masked bets + seedHash
- REQ-GAME-03 — `GET /games/rounds/history?limit=20` paginated
- REQ-GAME-04 — `GET /games/rounds/:roundId/verify` returns provably-fair data with `deriveCrashPoint` recomputation + match boolean
- REQ-GAME-05 — `GET /games/bets/me` JwtGuard-protected, paginated
- REQ-FAIR-02 — seed reveal gated on `status === "SETTLED"` at both aggregate and use-case layers
- REQ-FAIR-05 — `seedHash` exposed during BETTING via `GET /games/rounds/current`

## Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | Four READ use cases + BetRepository.countByRoundId + 13 unit tests | 4bc535b |
| 2 | RoundsController + BetsController + four zod DTOs + AppModule wiring | 44a3c8b |

## Self-Check: PASSED

- services/games/src/application/use-cases/get-current-round.use-case.ts — FOUND
- services/games/src/application/use-cases/get-round-history.use-case.ts — FOUND
- services/games/src/application/use-cases/verify-round.use-case.ts — FOUND
- services/games/src/application/use-cases/get-player-bets.use-case.ts — FOUND
- services/games/src/presentation/controllers/rounds.controller.ts — FOUND
- services/games/src/presentation/controllers/bets.controller.ts — FOUND
- services/games/src/presentation/dtos/current-round.dto.ts — FOUND
- services/games/src/presentation/dtos/round-history.dto.ts — FOUND
- services/games/src/presentation/dtos/verify-round.dto.ts — FOUND
- services/games/src/presentation/dtos/player-bets.dto.ts — FOUND
- services/games/tests/unit/get-current-round.use-case.test.ts — FOUND
- services/games/tests/unit/get-round-history.use-case.test.ts — FOUND
- services/games/tests/unit/verify-round.use-case.test.ts — FOUND
- services/games/tests/unit/get-player-bets.use-case.test.ts — FOUND
- Commit 4bc535b — FOUND in git log
- Commit 44a3c8b — FOUND in git log
- `bunx tsc --noEmit` from services/games — clean
- 111/111 games unit suite green, 293 expect() calls
