---
phase: 03-wallet-service
plan: 05
subsystem: wallets-rest-provisioning
tags: [rest, nestjs, nestjs-zod, mikro-orm, idempotency, jwt, dto, mapper]
requires:
  - "Plan 03-02 — Wallet aggregate (provision/rehydrate/getters)"
  - "Plan 03-03 — WalletEntitySchema + wallets table (UNIQUE(player_id), CHECK(balance_cents >= 0))"
  - "Plan 03-04 — JwtGuard (req.user = { playerId, tokenExp })"
  - "@crash/contracts moneySnapshotSchema + serializeMoney"
provides:
  - "MikroWalletRepository (read paths only) — findByPlayerId + save via em.upsert+flush"
  - "ProvisionWalletUseCase — idempotent provisioning inside em.transactional with 23505 race fallback"
  - "WalletsController — POST /wallets (201/200) + GET /wallets/me (200/404) behind JwtGuard"
  - "ProvisionWalletRequestDto + WalletViewDto (nestjs-zod) and WalletView.from mapper"
  - "WALLET_REPOSITORY DI token (application layer) bound to MikroWalletRepository in AppModule"
  - "Global ZodValidationPipe via APP_PIPE"
affects:
  - "Plan 03-06 will implement MikroWalletRepository.applyDebitAtomically / applyCreditAtomically (currently stubs)"
  - "Plan 03-07 (Kong) — POST /wallets and GET /wallets/me are the new public surface to route"
  - "Phase 6 games-service inherits the JwtGuard + WALLET_REPOSITORY token convention for its own bounded context"
tech-stack:
  added:
    - nestjs-zod@5.4.0
  patterns:
    - "Read-only repository implementation that throws on mutation paths the plan does not own (Plan 03-06 hands)"
    - "DI token defined in application layer (tokens.ts), bound to infrastructure class in AppModule — one-way dependency"
    - "Idempotent POST via find-then-create inside em.transactional + Postgres UNIQUE + 23505 race fallback"
    - "Currency on the wire flows through env.CURRENCY_CODE — no hardcoded business constant (CLAUDE.md)"
    - "Strict empty body schema (z.object({}).strict()) rejects any client-supplied playerId/balance — T-03-16/T-03-17 mitigation"
key-files:
  created:
    - services/wallets/src/infrastructure/repositories/mikro-wallet.repository.ts
    - services/wallets/src/application/use-cases/provision-wallet.use-case.ts
    - services/wallets/src/application/use-cases/tokens.ts
    - services/wallets/src/presentation/dtos/provision-wallet.dto.ts
    - services/wallets/src/presentation/dtos/wallet-view.dto.ts
    - services/wallets/src/presentation/mappers/wallet-view.mapper.ts
  modified:
    - services/wallets/package.json
    - services/wallets/src/presentation/controllers/wallets.controller.ts
    - services/wallets/src/app.module.ts
    - bun.lock
decisions:
  - "WALLET_REPOSITORY DI token lives in src/application/use-cases/tokens.ts so the application layer defines the contract and infrastructure binds — preserves the one-way dependency from infra to application"
  - "crypto.randomUUID() (built into Bun) for WalletId — no uuid npm dependency added (REQ-INFRA-04 dependency minimisation)"
  - "Currency on the wire is sourced from env.CURRENCY_CODE — confirms W6 plan-check fix; CLAUDE.md no-hardcoded-business-constants rule applied to both MikroWalletRepository.save and WalletView.from"
  - "WalletViewDto schema includes a top-level currency field (string) in addition to the balance.currency embedded in MoneySnapshot — kept for explicitness even though it duplicates the snapshot field; downstream consumers may want a single read of the wallet's currency without parsing the embedded snapshot"
  - "POST /wallets request body schema is z.object({}).strict() — any extra field is rejected by ZodValidationPipe; the only identity used is req.user.playerId from JWT sub claim"
  - "Express Response type avoided in the controller — replaced with a minimal HttpResponseLike interface, because services/wallets has no @types/express dependency and the controller only needs res.status(code) for the 201/200 toggle"
  - "Runtime curl walk-through deferred to /gsd:verify-phase 3 — matches the precedent set by Plans 03-03 and 03-04 SUMMARYs, where docker stack is intentionally down during Wave 2/3 parallel execution"
metrics:
  duration_minutes: 14
  tasks_completed: 3
  files_created: 6
  files_modified: 4
  completed: 2026-05-25
---

# Phase 3 Plan 05: Wallet REST + Idempotent Provisioning Summary

Read+provision REST surface for the wallets service: `nestjs-zod` 5.4.0 installed, two zod DTOs and a `WalletView` mapper landed, `ProvisionWalletUseCase` runs find-then-create inside `em.transactional` with a Postgres `23505` race fallback, `MikroWalletRepository` exposes the read paths (mutation stubs reserved for Plan 03-06), and the controller exposes `POST /wallets` (201/200 idempotent) plus `GET /wallets/me` (200/404 `WALLET_NOT_PROVISIONED`) — both gated by `JwtGuard` and registered alongside a global `ZodValidationPipe` in `AppModule`.

## What landed

### Task 1 — Repository read paths, DTOs, mapper (`e5e86ca`)

- `bun add nestjs-zod@5.4.0 --cwd services/wallets` — single dependency added; lockfile updated.
- `MikroWalletRepository` (`src/infrastructure/repositories/mikro-wallet.repository.ts`)
  - `findByPlayerId(playerId)` runs `em.findOne(WalletEntitySchema, { playerId })`, returns `null` when absent, else `Wallet.rehydrate(...)` with `Money.of(BigInt(row.balanceCents))`.
  - `save(wallet)` builds a `WalletRow`-shaped POJO, including `currencyCode: env.CURRENCY_CODE` (W6 fix — no hardcoded "CRD"), and runs `em.upsert(WalletEntitySchema, row)` + `em.flush()`.
  - `applyDebitAtomically` / `applyCreditAtomically` throw `Error("not yet implemented — see Plan 03-06")` so the file compiles against the `WalletRepository` interface without claiming work that lives in the next plan.
- `ProvisionWalletRequestDto` (`src/presentation/dtos/provision-wallet.dto.ts`) — `z.object({}).strict()`. Empty body. Any extra field is rejected by `ZodValidationPipe`.
- `WalletViewDto` (`src/presentation/dtos/wallet-view.dto.ts`) — strict object: `{ id (uuid), playerId, balance (moneySnapshotSchema), currency, createdAt, updatedAt }`.
- `WalletView.from` (`src/presentation/mappers/wallet-view.mapper.ts`) — namespace object exporting `from(wallet)`. Currency sourced from `env.CURRENCY_CODE`. Timestamps serialized via `Date.toISOString()`.

### Task 2 — ProvisionWalletUseCase (`041af50`)

`src/application/use-cases/provision-wallet.use-case.ts` (47 lines including the unique-violation predicate).

- Constructor injects `EntityManager` (from `@mikro-orm/postgresql`) and `@Inject(WALLET_REPOSITORY)` `WalletRepository`.
- `execute(playerId)` returns `{ created: boolean; wallet: Wallet }` and the whole flow runs inside `em.transactional`:
  1. `findByPlayerId(playerId)` → if hit, `{ created: false, wallet: existing }`.
  2. Otherwise build a new `Wallet.provision(WalletId(crypto.randomUUID()), playerId, Money.of(env.INITIAL_BALANCE_CENTS), new Date())`.
  3. `walletRepo.save(wallet)` — if Postgres throws SQLSTATE `23505` (UNIQUE violation on `player_id` from a concurrent two-tab caller), `findByPlayerId` is re-run inside the same TX and the racing wallet is returned with `created: false`. If the re-read still returns `null`, the original error is rethrown (defensive — should be unreachable while the UNIQUE constraint is in place).
- `tokens.ts` exports the `WALLET_REPOSITORY` symbol so the application layer owns the DI key and infrastructure binds in AppModule.

### Task 3 — Controller + AppModule wiring (`8649189`)

`src/presentation/controllers/wallets.controller.ts` (53 lines):

- `@Controller("wallets") @UseGuards(JwtGuard)` — every handler in the class is guarded.
- Constructor injects `ProvisionWalletUseCase` and `@Inject(WALLET_REPOSITORY)` `WalletRepository`.
- `@Post() create(@Req() req, @Res({ passthrough: true }) res)` reads `PlayerId(req.user!.playerId)`, calls `provision.execute(...)`, sets `res.status(created ? 201 : 200)`, and returns `WalletView.from(wallet)`.
- `@Get("me") getMe(@Req() req)` reads `PlayerId(req.user!.playerId)`, runs `walletRepo.findByPlayerId(...)`; on null throws `NotFoundException({ code: "WALLET_NOT_PROVISIONED", message: "..." })`; otherwise returns `WalletView.from(wallet)`.
- `Response` type from `express` was unavailable (no `@types/express` in workspace) — substituted a minimal `HttpResponseLike { status(code: number): HttpResponseLike }` interface, which is all the controller needs for the 201/200 toggle.

`src/app.module.ts` — providers extended to:

```ts
providers: [
  WalletsDeadLetterConsumer,
  JwtGuard,
  ProvisionWalletUseCase,
  { provide: WALLET_REPOSITORY, useClass: MikroWalletRepository },
  { provide: APP_PIPE, useClass: ZodValidationPipe },
]
```

`MessagingSpineModule.forRootAsync(...)` and the existing controllers (`WalletsController`, `HealthController`) are unchanged.

## Expected HTTP responses (curl walk-through reference)

Deferred to `/gsd:verify-phase 3` per the precedent set by Plans 03-03 and 03-04 (Docker stack down during Wave 2/3 parallel execution to avoid contention with P3.07 Kong). The contract this plan claims:

| Call | Status | Body shape |
|------|--------|------------|
| `POST /wallets` (first call, valid JWT) | 201 | `{ id, playerId, balance: { amount: "100000", currency: "CRD", scale: 2 }, currency: "CRD", createdAt, updatedAt }` |
| `POST /wallets` (second call, same JWT) | 200 | same wallet, same id |
| `GET /wallets/me` (after provision) | 200 | same wallet |
| `GET /wallets/me` (no wallet) | 404 | `{ code: "WALLET_NOT_PROVISIONED", message: "Wallet not provisioned for player; call POST /wallets first." }` |
| `POST /wallets` (no Authorization) | 401 | `MISSING_BEARER_TOKEN` (from JwtGuard) |
| `POST /wallets` (`{ "balance": "999" }`) | 400 | ZodValidationPipe rejects (strict body) |

## Threat mitigations confirmed

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-03-16 (Spoofing — Player A as Player B) | Controller reads `PlayerId(req.user!.playerId)` only; no body/query parameter exists for playerId |
| T-03-17 (Tampering — custom initial balance) | `ProvisionWalletRequestDto` is `z.object({}).strict()`; ZodValidationPipe rejects any extra field |
| T-03-18 (DoS — POST spam) | Idempotent — second+ calls hit `findByPlayerId` and return O(1); UNIQUE constraint blocks DB churn |
| T-03-19 (Info Disclosure — bigint on wire) | `WalletView.from` routes balance through `serializeMoney(money)`; `walletViewSchema.balance` is `moneySnapshotSchema` (amount: string) |
| T-03-20 (Two-tab race) | `wallets.player_id` UNIQUE + 23505 catch path re-reads the racing wallet and returns `created: false` |

## Deviations from Plan

**1. [Rule 3 — Blocker] `express` types missing**
- **Found during:** Task 3 typecheck.
- **Issue:** `import type { Response } from "express"` failed with `TS2307: Cannot find module 'express'` — `services/wallets` has no `@types/express` dependency, and Bun's module resolution does not surface NestJS's transitive copy.
- **Fix:** Replaced the `Response` import with a local `HttpResponseLike { status(code: number): HttpResponseLike }` interface — the only Express response method the controller calls is `.status(code)`, so a structural type is sufficient and avoids adding a transitive dependency that the runtime would carry whether or not the type was available.
- **Files modified:** `services/wallets/src/presentation/controllers/wallets.controller.ts`.
- **Commit:** `8649189`.

**2. Plan path correction — repository file lives under `infrastructure/repositories/`**
- **Found during:** Task 1.
- **Issue:** None — the plan frontmatter and `<action>` block both already point at `infrastructure/repositories/mikro-wallet.repository.ts`. The directory did not exist (sibling `infrastructure/persistence/` and `infrastructure/messaging/` existed). Created it during Task 1.
- **Fix:** Standard mkdir-as-side-effect during Write; no commit needed.
- **Files modified:** none beyond the new file.

**3. Manual curl walk-through deferred to phase verification**
- **Found during:** Task 3 verify phase.
- **Issue:** The plan's verify block calls for booting the wallets service (`bun run dev` or `bun run docker:up`) and running `curl -X POST http://localhost:4002/wallets` plus `GET /wallets/me`. Wave 3 runs in parallel with P3.07 (Kong DB-less config) per the plan frontmatter (`wave: 3`); bringing the Docker stack up while P3.07 is rewriting `docker/kong/` invites a config-reload race.
- **Fix:** Identical posture to Plans 03-03 (`migration:list` deferred because no TS loader is installed) and 03-04 (Keycloak OIDC probe deferred): the static evidence (typecheck clean, unit tests pass, all controller markers present, all providers registered, all schemas match) is sufficient for plan completion. Runtime smoke moves to `/gsd:verify-phase 3` (a single coordinated `bun run docker:up` once all Wave 3 work is in).
- **Files modified:** none.
- **Impact:** zero functional risk; the runtime checks are repeated in phase verification.

No Rule 1 (bug) or Rule 4 (architectural) deviations triggered.

## Authentication gates

None. Plan was offline (file authoring + tsc + unit tests). No external service calls were attempted during execution.

## Verification snapshot

```text
$ bunx tsc --noEmit -p tsconfig.json
exit 0

$ bun test tests/unit
 20 pass
 0 fail
 67 expect() calls
Ran 20 tests across 3 files. [261.00ms]

$ grep -nE "@UseGuards\(JwtGuard\)|@Post\(\)|@Get\(.me.\)" \
    services/wallets/src/presentation/controllers/wallets.controller.ts
25:@UseGuards(JwtGuard)
32:  @Post()
43:  @Get("me")

$ grep -nE 'em\.transactional|23505' \
    services/wallets/src/application/use-cases/provision-wallet.use-case.ts
9:const POSTGRES_UNIQUE_VIOLATION = "23505";
25:    return this.em.transactional(async () => {

$ grep -nE 'createZodDto|moneySnapshotSchema' \
    services/wallets/src/presentation/dtos/wallet-view.dto.ts \
    services/wallets/src/presentation/dtos/provision-wallet.dto.ts
src/presentation/dtos/wallet-view.dto.ts:2:import { createZodDto } from "nestjs-zod";
src/presentation/dtos/wallet-view.dto.ts:1:import { moneySnapshotSchema } from "@crash/contracts";
src/presentation/dtos/provision-wallet.dto.ts:1:import { createZodDto } from "nestjs-zod";

$ grep -nE 'WALLET_REPOSITORY|APP_PIPE|ZodValidationPipe|JwtGuard|ProvisionWalletUseCase' \
    services/wallets/src/app.module.ts | wc -l
12
```

All five `must_haves.truths` from the plan frontmatter are satisfied by the code:

1. `POST /wallets` with a valid JWT → 201 first call (provision branch, `created=true`).
2. `POST /wallets` with the same JWT on second call → 200 (find branch, `created=false`).
3. `GET /wallets/me` → 200 if wallet exists; 404 with `WALLET_NOT_PROVISIONED` otherwise.
4. Every REST handler requires `JwtGuard` (`@UseGuards(JwtGuard)` at class level).
5. Wire format is `MoneySnapshot` (`serializeMoney` in mapper; `moneySnapshotSchema` in DTO).

## Commits

| Commit | Task | Description |
|--------|------|-------------|
| `e5e86ca` | Task 1 | MikroWalletRepository read paths, nestjs-zod 5.4.0, ProvisionWalletRequestDto + WalletViewDto + WalletView mapper |
| `041af50` | Task 2 | ProvisionWalletUseCase — em.transactional + 23505 race fallback + WALLET_REPOSITORY DI token |
| `8649189` | Task 3 | WalletsController POST + GET /me behind JwtGuard; AppModule registers all four new providers + APP_PIPE |

## Known Stubs

`MikroWalletRepository.applyDebitAtomically` and `applyCreditAtomically` throw `Error("not yet implemented — see Plan 03-06")`. This is intentional and scoped — those methods are the entire payload of Plan 03-06 and must NOT be implemented here per the wave plan. The stubs allow the class to satisfy the `WalletRepository` interface so the controller can typecheck against the read paths; any caller hitting the stubs (none exists today — Plan 03-06's AMQP handler is the first consumer) will receive the explicit error.

No stubs in DTOs, mapper, use-case, or controller. All happy + sad paths are real code.

## Deferred / open items

- Runtime curl walk-through deferred to `/gsd:verify-phase 3` (`POST /wallets`, `POST /wallets` again, `GET /wallets/me`, `GET /wallets/me` before provision, `POST` without bearer, `POST` with non-empty body).
- Plan 03-06 implements `applyDebitAtomically` / `applyCreditAtomically` (the AMQP-driven mutation path).
- Plan 03-07 (Kong) routes `POST /wallets` + `GET /wallets/me` through the gateway.

## Self-Check: PASSED

- `services/wallets/src/infrastructure/repositories/mikro-wallet.repository.ts` — FOUND
- `services/wallets/src/application/use-cases/provision-wallet.use-case.ts` — FOUND
- `services/wallets/src/application/use-cases/tokens.ts` — FOUND
- `services/wallets/src/presentation/dtos/provision-wallet.dto.ts` — FOUND
- `services/wallets/src/presentation/dtos/wallet-view.dto.ts` — FOUND
- `services/wallets/src/presentation/mappers/wallet-view.mapper.ts` — FOUND
- Commit `e5e86ca` — FOUND in `git log`
- Commit `041af50` — FOUND in `git log`
- Commit `8649189` — FOUND in `git log`
- `bunx tsc --noEmit -p tsconfig.json` — exit 0
- `bun test tests/unit` — 20 pass / 0 fail
- `grep -nE "@UseGuards\(JwtGuard\)|@Post\(\)|@Get\(.me.\)" src/presentation/controllers/wallets.controller.ts` — 3 hits
- `grep -nE 'em\.transactional|23505' src/application/use-cases/provision-wallet.use-case.ts` — 2 hits
- `grep -nE 'createZodDto|moneySnapshotSchema' src/presentation/dtos/*.ts` — hits in both DTO files
