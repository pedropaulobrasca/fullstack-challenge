---
phase: 02-outbox-inbox-spine
plan: 01
subsystem: messaging-spine workspace bootstrap
tags: [workspace, package, install, supply-chain, bun]
requires:
  - Phase 1 monorepo (bun workspaces, services/games, services/wallets, packages/shared-kernel)
  - bun@1.3.11
provides:
  - "@crash/messaging-spine workspace package skeleton"
  - "Phase 2 dependency graph (amqplib, @golevelup/nestjs-rabbitmq, nestjs-cls, pg, uuid + types + testcontainers)"
  - "Workspace links from services/games and services/wallets into @crash/messaging-spine"
affects:
  - services/games (now depends on @crash/messaging-spine)
  - services/wallets (now depends on @crash/messaging-spine)
tech-stack:
  added:
    - amqplib@0.10.9
    - "@golevelup/nestjs-rabbitmq@9.0.2"
    - nestjs-cls@6.2.0
    - pg@8.21.0
    - uuid@14.0.0
    - "@types/amqplib@0.10.8"
    - "@types/pg@8.20.0"
    - "@types/uuid@11.0.0"
    - testcontainers@12.0.0
    - "@testcontainers/postgresql@12.0.0"
    - "@testcontainers/rabbitmq@12.0.0"
  patterns:
    - Workspace package with peerDependencies declaring host expectations
    - Single-major-amqplib resolution (pinned to match @golevelup transitive)
key-files:
  created:
    - packages/messaging-spine/package.json
    - packages/messaging-spine/tsconfig.json
    - packages/messaging-spine/src/index.ts
    - packages/messaging-spine/src/{outbox,inbox,dead-letter,envelope,topology,context,migrations/shared}/.gitkeep
    - packages/messaging-spine/tests/{unit,integration/_helpers}/.gitkeep
    - .planning/phases/02-outbox-inbox-spine/02-01-SUMMARY.md
  modified:
    - packages/messaging-spine/package.json (added dependencies and devDependencies)
    - services/games/package.json (added @crash/messaging-spine + amqplib + @golevelup + nestjs-cls)
    - services/wallets/package.json (added @crash/messaging-spine + amqplib + @golevelup + nestjs-cls)
    - bun.lock (337 lines added)
decisions:
  - "Pin amqplib to ^0.10.9 to match the version @golevelup/nestjs-rabbitmq@^9.0.2 resolves — avoids two amqplib majors in the install tree (and confusing dual-channel behavior at runtime)."
  - "Use uuid@^14 with @types/uuid@^11 — uuid v14 ships ESM-only with bundled types but services on Bun still benefit from explicit @types fallback during TS resolution."
  - "@golevelup/nestjs-rabbitmq selected over @nestjs/microservices' built-in RMQ transport — the audit confirmed @golevelup has first-class quorum-queue support and works alongside HTTP servers (which the @nestjs/microservices transport does not)."
  - "testcontainers + per-service modules pinned to latest (12.x) — used for integration test infrastructure in plans 02-05+; not in runtime path."
metrics:
  duration_minutes: 4
  tasks_completed: 3
  files_created: 14
  files_modified: 4
  commits: 2
completed: 2026-05-24
---

# Phase 2 Plan 1: Messaging Spine Workspace Bootstrap Summary

Created the `@crash/messaging-spine` workspace package, installed and pinned every Phase 2 third-party runtime dependency, and declared the package as a `workspace:*` dependency in both NestJS services so subsequent waves can target a stable workspace symlink.

## Tasks

### Task 1 — Workspace package skeleton (commit `b7b204c`)

- Created `packages/messaging-spine/` with `package.json` (name `@crash/messaging-spine`, version `0.1.0`, `type: module`, scripts for `build`/`typecheck`/`test`/`test:integration`).
- Peer dependencies declared so the package is hosted by Nest 11.1.21 + MikroORM 7.1.1 + `@crash/shared-kernel` (workspace).
- `tsconfig.json` extends the project base with `experimentalDecorators=true`, `emitDecoratorMetadata=true`, `strict=true`, `moduleResolution=Bundler`, `outDir=dist`.
- `src/index.ts` — placeholder barrel.
- `.gitkeep` files in every Phase 2 subdirectory: `src/{outbox,inbox,dead-letter,envelope,topology,context,migrations/shared}` and `tests/{unit,integration/_helpers}`.

### Task 2 — Legitimacy checkpoint (manual approval, no commit)

Eight `[ASSUMED]` packages from the Phase 2 research were inspected via `bun pm info` and cross-referenced against npmjs.com and the GitHub advisory database. Results:

| Package | Latest | Pin | Maintainer | Downloads/wk | Postinstall hook | Status |
|---|---|---|---|---|---|---|
| amqplib | 0.10.9 | ^0.10.9 | squaremo (RabbitMQ team) | 4.6M | none | OK |
| @types/amqplib | 0.10.8 | ^0.10.8 | DefinitelyTyped | 1.3M | none | OK |
| @golevelup/nestjs-rabbitmq | 9.0.2 | ^9.0.2 | golevelup | 90k | none | OK |
| nestjs-cls | 6.2.0 | ^6.2.0 | papooch | 280k | none | OK |
| pg | 8.21.0 | ^8.21.0 | brianc | 9.2M | none | OK |
| @types/pg | 8.20.0 | ^8.20.0 | DefinitelyTyped | 3.8M | none | OK |
| uuid | 14.0.0 | ^14.0.0 | broofa | 130M | none | OK |
| @types/uuid | 11.0.0 | ^11.0.0 | DefinitelyTyped | 30M | none | OK |

No `[SUS]` or `[SLOP]` packages were found. All eight passed. User explicitly approved the pinned version set (including the amqplib pin to `^0.10.9` to converge with the `@golevelup` transitive).

### Task 3 — Install and wire workspace links (commit `9a3f4e3`)

- Wrote final `packages/messaging-spine/package.json` with all eleven dependencies pinned per the approved list.
- Added `@crash/messaging-spine: workspace:*` plus `amqplib`, `@golevelup/nestjs-rabbitmq`, `nestjs-cls` to both `services/games/package.json` and `services/wallets/package.json`.
- Ran `bun install` from repo root — 264 packages installed, `bun.lock` regenerated.
- Verified `bun install --frozen-lockfile` is consistent (no drift).
- Verified `bun run typecheck` inside `packages/messaging-spine/` exits 0 against the empty barrel.
- Verified `bun run lint` from root exits 0 (no new violations).

## Deviations from Plan

None. The plan executed exactly as written with the user-approved version pins applied at Task 3.

## Threat Mitigations Applied

- **T-02-SC** (supply-chain tampering): Blocking-human checkpoint completed before any `bun add` ran. All eight `[ASSUMED]` packages individually approved.
- **T-02-01** (postinstall hooks): Confirmed `scripts.postinstall` is absent on all eight packages prior to install.
- **T-02-02** (bun.lock secret leak): Accepted — lockfile committed contains only package coordinates and integrity hashes.

## Verification (success criteria)

- [x] `@crash/messaging-spine` exists with manifest, tsconfig, barrel, and all subdirectories tracked via `.gitkeep`.
- [x] All eleven runtime/dev dependencies installed under the correct sections (runtime under `dependencies`, types/testcontainers under `devDependencies`).
- [x] Both services declare `@crash/messaging-spine: workspace:*` and the consumer-side deps (`amqplib`, `@golevelup/nestjs-rabbitmq`, `nestjs-cls`).
- [x] Legitimacy of every `[ASSUMED]` package approved via human-verify checkpoint BEFORE any `bun add` ran.
- [x] `bun install` from repo root succeeds; workspace symlinks resolve in both services.
- [x] `bun install --frozen-lockfile` confirms the lockfile is consistent.
- [x] `bun run typecheck` inside `packages/messaging-spine/` exits 0.
- [x] `bun run lint` from root exits 0.
- [x] ROADMAP.md / STATE.md untouched (deferred to the closing plan of Phase 2 per plan output spec).

## Self-Check: PASSED

- `packages/messaging-spine/package.json` — FOUND
- `packages/messaging-spine/tsconfig.json` — FOUND
- `packages/messaging-spine/src/index.ts` — FOUND
- services/games/package.json contains `@crash/messaging-spine` — FOUND
- services/wallets/package.json contains `@crash/messaging-spine` — FOUND
- commit `b7b204c` — FOUND (Task 1)
- commit `9a3f4e3` — FOUND (Task 3)
- `bun.lock` updated and frozen-lockfile clean — FOUND
