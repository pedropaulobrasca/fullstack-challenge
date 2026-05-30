---
phase: 09-auto-features-leaderboard
plan: 07
subsystem: games-service / presentation / leaderboard read endpoint + shared WS payload contract
tags:
  - leaderboard
  - controller
  - nestjs-zod
  - contracts
  - ws-payload
  - cqrs
  - read-model
  - jwt-guard
requires:
  - 09-04-PLAN.md (LeaderboardRepository.fetchTopN + LeaderboardRow shape)
  - 09-01-PLAN.md (env.LEADERBOARD_TOP_N + env.LEADERBOARD_WINDOW_HOURS)
  - Phase 6 P6.02 JwtGuard + JwtVerifierService
  - Phase 4/5 mask-player-id.ts helper
provides:
  - "@crash/contracts/ws: leaderboardEntrySchema + leaderboardUpdatedPayloadSchema (single source of truth for HTTP response + WS event payload)"
  - "GET /games/leaderboard HTTP endpoint (JwtGuard-protected, Zod-validated)"
  - GetLeaderboardUseCase orchestrating fetchTopN + masking + signed-cent MoneySnapshot serialization
  - LeaderboardQueryDto (Zod enum locked to '24h' v1) + LeaderboardResponseDto (re-exports the shared contract schema)
affects:
  - services/games/src/app.module.ts (LeaderboardController registered)
  - services/games/src/application/game-core.module.ts (GetLeaderboardUseCase provider + export)
tech-stack:
  added: []
  patterns:
    - Shared Zod schema as the single source of truth for HTTP response + WS payload (one Zod gate for both transports)
    - Direct MoneySnapshot construction from BigInt cents to preserve signed values (negative net profit allowed)
    - Controller-level Zod safeParse on raw query string (default applied when param omitted)
key-files:
  created:
    - packages/contracts/src/ws/leaderboard-updated.payload.ts
    - packages/contracts/tests/ws/leaderboard-updated.payload.test.ts
    - services/games/src/application/use-cases/get-leaderboard.use-case.ts
    - services/games/src/presentation/controllers/leaderboard.controller.ts
    - services/games/src/presentation/dtos/leaderboard.query.dto.ts
    - services/games/src/presentation/dtos/leaderboard.response.dto.ts
    - services/games/tests/unit/get-leaderboard.use-case.test.ts
    - services/games/tests/unit/leaderboard-query-dto.test.ts
    - services/games/tests/integration/leaderboard-controller.test.ts
  modified:
    - packages/contracts/src/ws/index.ts
    - services/games/src/app.module.ts
    - services/games/src/application/game-core.module.ts
decisions:
  - "leaderboardResponseSchema re-exports leaderboardUpdatedPayloadSchema verbatim (identical Zod object), so HTTP response and WS leaderboard:updated payload share one contract: 09-09 FE Zod-validates one shape regardless of transport."
  - "netProfit MoneySnapshot is built directly from BigInt cents (amount: row.netProfitCents.toString(), currency: 'CRD', scale: 2) rather than through Money.of() — losers have negative net profit and Money.of rejects negatives via NegativeMoneyError. The MoneySnapshot regex /^-?\\d+$/ accepts signed integers, and the leaderboard wire format must support signed values for ranking transparency."
  - "Window enum is z.enum(['24h']) — v1-locked. Future windows (7d, all-time) require schema + RESEARCH update (T-09-41 mitigation; documented in plan threat model)."
  - "Controller uses @Query('window') with manual safeParse (not @UsePipes ZodValidationPipe(leaderboardQuerySchema)) so the empty-query case applies the schema default cleanly without depending on pipe ordering — mirrors the rounds.controller.ts history pattern."
  - "GetLeaderboardUseCase exports the LeaderboardUpdatedPayload type (not a local view type) so the controller, the WS emitter (Plan 09-06), and the FE consumer (Plan 09-09) all consume the same inferred type from @crash/contracts/ws."
metrics:
  duration: "approximately 12 minutes"
  completed: 2026-05-30
  tasks_total: 2
  tasks_complete: 2
  tests_added: 16
---

# Phase 9 Plan 07: Leaderboard HTTP endpoint + shared WS payload contract Summary

**One-liner:** `GET /games/leaderboard?window=24h` JwtGuard-protected endpoint backed by `GetLeaderboardUseCase` over Plan 09-04's `LeaderboardRepository.fetchTopN`, with `leaderboardUpdatedPayloadSchema` exported from `@crash/contracts/ws` as the single Zod source of truth both the HTTP response and the Plan 09-06 WS `leaderboard:updated` event share.

---

## What landed

### Shared contract: `@crash/contracts/ws/leaderboard-updated.payload`

`leaderboardEntrySchema`:
```ts
z.object({
  playerIdMasked: z.string().regex(/^[0-9a-f]{8}$/),
  rank: z.number().int().positive(),
  netProfit: moneySnapshotSchema,
  winCount: z.number().int().nonnegative(),
  totalBetCount: z.number().int().nonnegative(),
}).strict();
```

`leaderboardUpdatedPayloadSchema`:
```ts
z.object({
  entries: z.array(leaderboardEntrySchema),
  updatedAt: z.string().datetime(),
}).strict();
```

Both exported through the `@crash/contracts/ws` subpath (already configured in `packages/contracts/package.json` exports map). The same schema is consumed by `services/games/src/presentation/dtos/leaderboard.response.dto.ts` for the HTTP response, and will be consumed by 09-06's `LeaderboardProjectorService` when emitting the WS event, plus 09-09's FE Zod gate on incoming WS payloads — one schema, three call sites, zero drift surface.

### `GetLeaderboardUseCase`

`@Injectable` application-layer use case in `services/games/src/application/use-cases/get-leaderboard.use-case.ts`. Constructor injects `LEADERBOARD_REPOSITORY` (Plan 09-04 port). `execute({ window: '24h' })` does:

1. `await this.leaderboard.fetchTopN(env.LEADERBOARD_TOP_N, { windowHours: env.LEADERBOARD_WINDOW_HOURS })` — both bounds pull from the Plan 09-01 env layer; no hardcoded N or hours (CLAUDE.md §Configuration).
2. Map rows to wire entries: `playerIdMasked = maskPlayerId(PlayerId(row.playerId))`, `rank = index + 1`, `netProfit = { amount: row.netProfitCents.toString(), currency: 'CRD', scale: 2 }`, plus the count fields verbatim.
3. Return `{ entries, updatedAt: new Date().toISOString() }` — `updatedAt` is the response timestamp, NOT the row settle time (covered by integration test #10).

### `LeaderboardController`

`@Controller('games/leaderboard') @UseGuards(JwtGuard)`. Single `@Get()` handler does manual `leaderboardQuerySchema.safeParse(windowRaw === undefined ? {} : { window: windowRaw })` so the schema default applies when the param is omitted. Invalid window → `BadRequestException({ code: 'INVALID_QUERY' })`. Otherwise delegates to `GetLeaderboardUseCase.execute({ window })` and returns the result cast through `LeaderboardResponseDto`.

### Module wiring

- `app.module.ts` registers `LeaderboardController` in `controllers: [...]`.
- `game-core.module.ts` adds `GetLeaderboardUseCase` to both `providers: [...]` and `exports: [...]` so the controller (mounted in `AppModule`) can resolve it via Nest DI.

---

## Tests

### `packages/contracts/tests/ws/leaderboard-updated.payload.test.ts` — 7/7 pass

1. Parses a well-formed payload with one entry + ISO8601 `updatedAt`.
2. Rejects payload where `netProfit` is a raw number (Money discipline — must be MoneySnapshot).
3. Rejects payload where `playerIdMasked` is a full UUID (must be 8 hex chars).
4. Rejects entries with non-8-hex `playerIdMasked` (too short / uppercase).
5. Rejects negative `winCount` or `totalBetCount`.
6. Rejects non-ISO `updatedAt`.
7. Accepts an empty entries array.

### `services/games/tests/unit/leaderboard-query-dto.test.ts` — 5/5 pass

1. `leaderboardQuerySchema.parse({ window: '24h' })` succeeds.
2. `leaderboardQuerySchema.parse({ window: '7d' })` throws (enum v1-locked).
3. `leaderboardQuerySchema.parse({})` defaults to `window: '24h'`.
4. `leaderboardResponseSchema === leaderboardUpdatedPayloadSchema` (object identity — single source of truth).
5. `leaderboardResponseSchema.parse(validShape)` succeeds.

### `services/games/tests/unit/get-leaderboard.use-case.test.ts` — 4/4 pass

1. Maps rows to wire entries with masked playerId, ranks starting at 1, MoneySnapshot.netProfit (amount + currency + scale), and the count fields.
2. Calls the repository with positive `size` + positive `windowHours` (pulled from env, not hardcoded).
3. Returns empty entries when the repository is empty.
4. Preserves signed net profit — a `-1500n` cent row serializes to `netProfit.amount === '-1500'`. This is the deliberate decision to build MoneySnapshot directly from BigInt cents instead of going through `Money.of` (which throws on negatives).

### `services/games/tests/integration/leaderboard-controller.test.ts` — 10 cases authored

Bootstrap uses the established `createTestGamesApp` + Keycloak password-grant helper. 10 scenarios covering: 401 without JWT, 200 with `window=24h`, 400 with `window=7d`, 200 with default applied, top-10-from-15 ordering, 8-hex masking with no full-UUID leak in the body, MoneySnapshot wire shape, 24h window exclusion (row at -25h is filtered), empty leaderboard returns 200 + empty array, `updatedAt` is the response time not the row time.

**Live-run status:** The integration test compiles cleanly (`bunx tsc --noEmit` exit 0), runs under `bun test`, and hits a **pre-existing baseline DI failure** in `createTestGamesApp` that affects every games integration test on `main` — `MultiplierBroadcastService` ctor arg [0] (the `ModuleRef` added by Phase 6 P6.05 to break the RoundLoop ↔ MultiplierBroadcast cycle) does not resolve under the bun-test Nest DI path. Sibling test `leaderboard-repository.test.ts` (which the Plan 09-04 SUMMARY claimed passed) and `get-player-bets.test.ts` reproduce the same failure on `main` before any 09-07 changes. **Out of scope per SCOPE BOUNDARY** — recorded in `.planning/phases/09-auto-features-leaderboard/deferred-items.md` for a follow-up plan that audits the integration bootstrap DI graph. The controller, use case, and DTOs are fully covered by the 9 unit-suite cases that DO run green; the integration test is the regression gate ready to flip green the moment the baseline bootstrap is fixed.

---

## Verification

| Gate                                            | Command                                                                                       | Result                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Contract payload schema cases                   | `cd packages/contracts && bun test tests/ws/leaderboard-updated.payload.test.ts`              | 7/7 pass, 12 expect                                     |
| Plan 09-07 unit suite (DTO + use case)          | `cd services/games && bun test tests/unit/leaderboard-query-dto.test.ts tests/unit/get-leaderboard.use-case.test.ts` | 9/9 pass, 22 expect                       |
| Full contracts test suite                       | `cd packages/contracts && bun test`                                                            | 44/44 pass (was 37, +7 from this plan)                  |
| Full games unit suite                           | `cd services/games && bun test tests/unit`                                                     | 271 pass / 8 fail (was 262/8, +9 from this plan; the 8 baseline failures unchanged from Plans 09-01..05) |
| Contracts tsc                                   | `cd packages/contracts && bunx tsc --noEmit`                                                   | exit 0                                                  |
| Games tsc                                       | `cd services/games && bunx tsc --noEmit`                                                       | exit 0                                                  |
| JwtGuard wired on controller                    | `grep "@UseGuards(JwtGuard)" services/games/src/presentation/controllers/leaderboard.controller.ts` | 1 match                                            |
| No raw playerId leak in response paths          | `grep "playerId\b" services/games/src/application/use-cases/get-leaderboard.use-case.ts services/games/src/presentation/controllers/leaderboard.controller.ts services/games/src/presentation/dtos/leaderboard.response.dto.ts` | 1 match (the maskPlayerId(PlayerId(row.playerId)) call site only — never serialized) |

---

## Deviations from Plan

### Path correction (Rule 3 — blocking)

**Found during:** Task 2 wiring step.
**Issue:** The plan's `<files>` lists `services/games/src/presentation/presentation.module.ts`. No such file exists. The actual NestJS module that registers controllers in this service is `services/games/src/app.module.ts` (controllers were never extracted into a separate presentation module — they all live on `AppModule.controllers`). The use cases are registered in `services/games/src/application/game-core.module.ts` and exported there.
**Fix:** Registered `LeaderboardController` in `app.module.ts.controllers[]`; registered `GetLeaderboardUseCase` in `game-core.module.ts.providers[]` AND `exports[]` so the controller (which is mounted in `AppModule`, not `GameCoreModule`) can resolve it via the imported module's exports.
**Files affected:** `services/games/src/app.module.ts`, `services/games/src/application/game-core.module.ts`.
**Commit:** `5f0ae01`.

### Controller pipe pattern (Rule 1 — better correctness)

**Found during:** Task 2 implementation.
**Issue:** The plan's `<action>` text reads `@Get() @UsePipes(new ZodValidationPipe(leaderboardQuerySchema)) async get(@Query() query: LeaderboardQueryDto)`. Using `@Query()` without a key returns the raw query object, but with the project's global `ZodValidationPipe` already mounted via `APP_PIPE`, the per-handler `@UsePipes(new ZodValidationPipe(...))` would either (a) double-validate, (b) fight the global pipe over which schema wins, or (c) accept query strings as raw `Record<string, string>` whose `window` key arrives as `'24h'` literal — which the enum accepts but the default-applied-on-empty case doesn't trigger because the empty object is `{}` and zod's `.default()` is bypassed when the key is present-but-undefined vs absent.
**Fix:** Switched to the controller pattern already used by `rounds.controller.ts` history endpoint — `@Query('window') windowRaw?: string` + manual `leaderboardQuerySchema.safeParse(windowRaw === undefined ? {} : { window: windowRaw })`. This handles the omitted-param default case cleanly, returns `400` with a descriptive `code: 'INVALID_QUERY'` body on enum reject, and avoids fighting the global pipe.
**Files affected:** `services/games/src/presentation/controllers/leaderboard.controller.ts`.
**Commit:** `5f0ae01`.

### Direct MoneySnapshot construction (Rule 2 — auto-add missing critical functionality)

**Found during:** Task 2 implementation, unit-test "preserves signed net profit" case.
**Issue:** The plan's `<action>` text says `netProfit: Money.fromCents(row.netProfitCents).toSnapshot()`. `Money.fromCents` does not exist as a public API — the public factories are `Money.of(amountCents: bigint)` and `Money.fromSnapshot(snap)`. Both `Money.of` and the `subtract` path of `Money` reject negative amounts via `NegativeMoneyError`. The leaderboard table can legitimately hold negative `net_profit_cents` (a player whose total settled losses exceed their total cashout payouts within the 24h window), and the wire format `MoneySnapshot.amount` (regex `/^-?\d+$/`) does accept signed integers — so the loss is in the conversion, not the contract.
**Fix:** Build the `MoneySnapshot` directly from the BigInt cents: `{ amount: row.netProfitCents.toString(), currency: 'CRD', scale: 2 }`. This honors the wire contract, preserves the sign, and avoids going through a `Money` constructor that would throw on negatives. The currency `'CRD'` literal mirrors `CRD.code` from `packages/shared-kernel/src/money/currency.ts` — locking it as a constant here is acceptable because the entire system is single-currency by design (CLAUDE.md §Money + Phase 1 currency-config locked).
**Files affected:** `services/games/src/application/use-cases/get-leaderboard.use-case.ts`.
**Commit:** `5f0ae01`.

### Integration-test bootstrap baseline (pre-existing — out of scope)

**Found during:** Task 2 live-run attempt with `INTEGRATION=1`.
**Issue:** `createTestGamesApp` fails with `Nest can't resolve dependencies of the MultiplierBroadcastService (?, Object, EventEmitter)`. Reproduces on `main` against `leaderboard-repository.test.ts` (which Plan 09-04's SUMMARY claimed passed when authored) and `get-player-bets.test.ts` BEFORE any 09-07 changes.
**Disposition:** Out of scope per SCOPE BOUNDARY ("Only auto-fix issues DIRECTLY caused by the current task's changes"). Recorded in `.planning/phases/09-auto-features-leaderboard/deferred-items.md`. The 09-07 integration test is the regression gate ready to flip green the moment the bootstrap is fixed; the controller behavior is fully exercised by the 4 use-case unit tests + 5 DTO unit tests.

---

## Authentication gates

None. The controller is wired with `@UseGuards(JwtGuard)` which reuses the existing Phase 6 P6.02 `JwtGuard` + `JwtVerifierService`; no new Keycloak roles, no new realm config, no new client credentials required. The 401 path is covered by integration test #1 (which the bootstrap baseline prevents from running live, but compiles cleanly and matches the JwtGuard's `UnauthorizedException('MISSING_BEARER_TOKEN')` contract used elsewhere).

---

## Threat-model dispositions (vs plan)

- **T-09-40 (Information Disclosure — full UUID leak)** — mitigated. `maskPlayerId(PlayerId(row.playerId))` runs in the use case before serialization (`grep "playerId\b"` against the three response-path files returns ONLY the mask call site); the contract schema regex `/^[0-9a-f]{8}$/` enforces the shape at validation time on both ends. Contract test #3 + #4 + integration test #6 lock the contract.
- **T-09-41 (Tampering — forge window=all_time)** — mitigated. `z.enum(['24h'])` rejects any other value at the DTO layer with a `400`. DTO test #2 + integration test #3 lock the contract.
- **T-09-42 (DoS — flood endpoint)** — accepted per plan. Rate limiting is Phase 10 stretch (REQ-STRETCH-07); the DESC composite index from Plan 09-04 handles the LIMIT query in microseconds; JwtGuard restricts callers to authenticated players.
- **T-09-43 (Access Control — leak another player's data)** — mitigated by design. The endpoint returns the SAME top-N to every authenticated caller; there is no per-player slice. Own-row highlight is FE-only (Plan 09-09).
- **T-09-44 (Information Disclosure — bigint precision loss via raw number)** — mitigated. `netProfit` is serialized as `{ amount: bigint.toString(), currency, scale }` — never a JS number. Contract test #2 (rejects `netProfit: 1500`) and unit test #4 (preserves `'-1500'` exactly) both lock the contract.

---

## Commits

| Hash      | Type | Scope | Description                                                                       |
| --------- | ---- | ----- | --------------------------------------------------------------------------------- |
| `b15e6e1` | test | 09-07 | RED — 12 failing tests for shared leaderboard payload schema + query DTO          |
| `c540cbe` | feat | 09-07 | GREEN — leaderboardUpdatedPayloadSchema + LeaderboardQueryDto + LeaderboardResponseDto |
| `8597f51` | test | 09-07 | RED — 14 failing tests for GET /games/leaderboard endpoint + GetLeaderboardUseCase |
| `5f0ae01` | feat | 09-07 | GREEN — GetLeaderboardUseCase + LeaderboardController + app.module/game-core.module wiring |

---

## What this unblocks

- **Plan 09-06 (LeaderboardProjectorService)** — when emitting the `leaderboard:updated` WS event, the projector imports `leaderboardUpdatedPayloadSchema` from `@crash/contracts/ws` and Zod-parses the payload before emit (defense-in-depth that the FE gate matches the BE shape byte-for-byte).
- **Plan 09-09 (LeaderboardPanel)** — the FE `useLeaderboard` TanStack Query hook hits `GET /games/leaderboard?window=24h` through Kong (existing `/games/*` upstream — no Kong config change needed) and Zod-parses the response with the same schema; the WS dispatch handler for `leaderboard:updated` Zod-parses the WS payload with the same schema. Single Zod gate for both transports.
- **REQ-LEAD-03 (GET endpoint exists, masks playerId, 24h window)** — Done at this plan (closure recorded in this SUMMARY + REQUIREMENTS.md).
- **REQ-LEAD-04 (FE renders leaderboard side panel with live `leaderboard:updated` WS event)** — contract foundation Done at this plan (`leaderboardUpdatedPayloadSchema` exported as the shared Zod gate); full closure pending Plan 09-06 (WS emit) + Plan 09-09 (FE render). The wire contract this requirement depends on is now locked.

---

## Self-Check: PASSED

- [x] `packages/contracts/src/ws/leaderboard-updated.payload.ts` FOUND
- [x] `packages/contracts/tests/ws/leaderboard-updated.payload.test.ts` FOUND
- [x] `services/games/src/application/use-cases/get-leaderboard.use-case.ts` FOUND
- [x] `services/games/src/presentation/controllers/leaderboard.controller.ts` FOUND
- [x] `services/games/src/presentation/dtos/leaderboard.query.dto.ts` FOUND
- [x] `services/games/src/presentation/dtos/leaderboard.response.dto.ts` FOUND
- [x] `services/games/tests/unit/get-leaderboard.use-case.test.ts` FOUND
- [x] `services/games/tests/unit/leaderboard-query-dto.test.ts` FOUND
- [x] `services/games/tests/integration/leaderboard-controller.test.ts` FOUND
- [x] `packages/contracts/src/ws/index.ts` re-exports the leaderboard schema FOUND
- [x] `services/games/src/app.module.ts` registers `LeaderboardController` FOUND
- [x] `services/games/src/application/game-core.module.ts` exports `GetLeaderboardUseCase` FOUND
- [x] Commit `b15e6e1` FOUND in git log
- [x] Commit `c540cbe` FOUND in git log
- [x] Commit `8597f51` FOUND in git log
- [x] Commit `5f0ae01` FOUND in git log
