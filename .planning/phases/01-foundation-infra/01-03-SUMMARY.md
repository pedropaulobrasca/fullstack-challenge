---
phase: 01-foundation-infra
plan: 03
subsystem: workspace-dockerfile-refactor
tags: [docker, dockerfile, workspace, mikro-orm, migrations, nestjs]
requires:
  - "01-01 (workspace + Bun pinning)"
  - "01-02 (docker-compose context wired to repo root, migrate stubs declared)"
  - "01-04 (@crash/shared-kernel package)"
  - "01-07 (typed env layer wiring)"
provides:
  - "Multi-stage workspace-aware Dockerfiles (deps -> migrate -> runtime) for games and wallets"
  - "Service manifests expanded with MikroORM 7.1, NestJS 11.1.21, @nestjs/config, @mikro-orm/cli, @crash/contracts"
  - "mikro-orm.config.ts stubs ready for Phase 2/3/4 entity registration"
  - "Empty migrations directories (.gitkeep) so bunx mikro-orm migration:up is a successful no-op"
  - "Root .dockerignore preventing node_modules from polluting the image context"
affects:
  - "Phase 1.10 smoke test will use these images to bring the full stack up"
  - "Phase 2 messaging will land OutboxMessage/InboxMessage entities and the first migration"
  - "Phase 3 wallet schema lands the CHECK (balance_cents >= 0) migration"
  - "Phase 4 round/bet schema migration lands here"
tech-stack:
  added:
    - "@nestjs/config@4.0.4"
    - "@mikro-orm/core@7.1.1"
    - "@mikro-orm/postgresql@7.1.1"
    - "@mikro-orm/nestjs@7.0.2"
    - "@mikro-orm/migrations@7.1.1"
    - "@mikro-orm/cli@7.1.1"
    - "@crash/contracts (workspace dep added to both services)"
  patterns:
    - "Multi-stage Dockerfile deps -> migrate -> runtime sharing a single bun install layer"
    - "Workspace-aware container install: COPY packages/ + frontend/package.json + ALL services/*/package.json before bun install --frozen-lockfile"
    - "defineConfig from @mikro-orm/postgresql for v7.1 config typing"
    - "Migrator extension registered in extensions[] (MikroORM 7 plugin pattern)"
    - "Explicit decorator metadata flags per ADR-003 (no inheritance reliance)"
    - "tsconfig moduleResolution=Bundler for dinero.js/bigint subpath support under tsc"
key-files:
  created:
    - services/games/mikro-orm.config.ts
    - services/wallets/mikro-orm.config.ts
    - services/games/src/infrastructure/mikro-orm/migrations/.gitkeep
    - services/wallets/src/infrastructure/mikro-orm/migrations/.gitkeep
    - .dockerignore
  modified:
    - services/games/Dockerfile
    - services/wallets/Dockerfile
    - services/games/package.json
    - services/wallets/package.json
    - services/games/tsconfig.json
    - services/wallets/tsconfig.json
    - bun.lock
decisions:
  - "Used defineConfig from @mikro-orm/postgresql (re-exported as definePostgreSqlConfig) — confirmed exported in v7.1.1 index.d.ts"
  - "Dockerfile copies BOTH services/games/package.json AND services/wallets/package.json in deps stage — Bun workspace resolution needs every member during install, even when only one service is the build target"
  - "Added root .dockerignore (not on Touch ONLY list) — Rule 3 blocking fix: without it, packages/*/node_modules leaks into the build context and confuses --frozen-lockfile"
  - "tsconfig moduleResolution switched from commonjs to Bundler — needed for dinero.js/bigint subpath export (deferred from P1.7) and for @crash/shared-kernel/* subpath imports"
metrics:
  duration_minutes: 12
  completed: 2026-05-24T19:05:00Z
  tasks_completed: 2
  files_created: 5
  files_modified: 7
---

# Phase 1 Plan 3: Workspace Dockerfile Refactor Summary

Multi-stage workspace-aware Dockerfiles for games and wallets; both services now carry the full Phase 1 dependency surface (MikroORM 7.1 + NestJS 11.1.21 + @nestjs/config + zod + workspace contracts), a MikroORM CLI configuration, and an empty migrations directory ready for Phase 2/3/4 schema work.

## Tasks Completed

| Task | Description | Commit | Files |
| ---- | ----------- | ------ | ----- |
| 1 | Expand service manifests + tsconfigs + mikro-orm configs + migrations dirs | 1249399 | services/games/package.json, services/wallets/package.json, services/games/tsconfig.json, services/wallets/tsconfig.json, services/games/mikro-orm.config.ts, services/wallets/mikro-orm.config.ts, services/games/src/infrastructure/mikro-orm/migrations/.gitkeep, services/wallets/src/infrastructure/mikro-orm/migrations/.gitkeep, bun.lock |
| 2 | Rewrite Dockerfiles as multi-stage workspace-aware builds (deps -> migrate -> runtime) | e1b7260 | services/games/Dockerfile, services/wallets/Dockerfile, .dockerignore |
| 3 | Add games-migrate / wallets-migrate compose blocks | (no-op — P1.2 landed these stubs with the correct shape; Task 2 made them functional by adding the Dockerfile multi-stage target) | docker-compose.yml (no diff) |

## Dependency Matrix

| Package | Declared range | Resolved (bun.lock) |
| ------- | -------------- | ------------------- |
| @nestjs/common | ^11.1.21 | 11.1.23 |
| @nestjs/core | ^11.1.21 | 11.1.23 |
| @nestjs/platform-express | ^11.1.21 | 11.1.23 |
| @nestjs/config | ^4.0.0 | 4.0.4 |
| @mikro-orm/core | ^7.1.0 | 7.1.1 |
| @mikro-orm/postgresql | ^7.1.0 | 7.1.1 |
| @mikro-orm/nestjs | ^7.0.0 | 7.0.2 |
| @mikro-orm/migrations | ^7.1.0 | 7.1.1 |
| @mikro-orm/cli | ^7.1.0 | 7.1.1 |
| reflect-metadata | ^0.2.2 | 0.2.2 |
| rxjs | ^7.8.2 | 7.8.2 |
| zod | ^3.23.0 | 3.25.76 |
| @crash/shared-kernel | workspace:* | symlink -> packages/shared-kernel |
| @crash/contracts | workspace:* | symlink -> packages/contracts |

## Dockerfile Structure

Both Dockerfiles are byte-equivalent modulo `services/games` <-> `services/wallets` and `EXPOSE 4001` <-> `EXPOSE 4002`. Three named stages share a single workspace install:

```
FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY frontend/package.json ./frontend/
COPY services/games/package.json ./services/games/
COPY services/wallets/package.json ./services/wallets/
RUN bun install --frozen-lockfile

FROM deps AS migrate
WORKDIR /app/services/games
COPY services/games ./
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
CMD ["bunx", "mikro-orm", "migration:up"]

FROM deps AS runtime
WORKDIR /app/services/games
COPY services/games ./
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV NODE_ENV=production
EXPOSE 4001
CMD ["bun", "run", "src/main.ts"]
```

The build context is the repo root (set in P1.2). All COPY paths are repo-relative.

## Image Build Results

All four images built clean on the first attempt after the workspace-copy fix:

| Image | Tag | Image ID (sha256 prefix) |
| ----- | --- | ------------------------ |
| games-runtime | crash-games-runtime:test | bee8c5c78 |
| games-migrate | crash-games-migrate:test | 872003190 |
| wallets-runtime | crash-wallets-runtime:test | e9dd311fc |
| wallets-migrate | crash-wallets-migrate:test | f06970c10 |

Compose build via `docker compose build games-migrate wallets-migrate` also succeeds:

```
Image fullstack-challenge-games-migrate Built
Image fullstack-challenge-wallets-migrate Built
```

Smoke checks inside the built images:

- `docker run --rm crash-games-migrate:test bunx mikro-orm --version` -> `7.1.1`
- `docker run --rm crash-games-runtime:test ls -la mikro-orm.config.ts` -> file present, 649 bytes

## Migration No-op Confirmation

The migrations directories (`services/games/src/infrastructure/mikro-orm/migrations/`, `services/wallets/src/infrastructure/mikro-orm/migrations/`) contain only `.gitkeep`. Running `bunx mikro-orm migration:up` against a live Postgres (deferred to P1.10) will report "no pending migrations" and exit 0. The MikroORM CLI inside the migrate image loads the config successfully and reports v7.1.1.

## defineConfig Export Confirmation

`@mikro-orm/postgresql@7.1.1/index.d.ts` exports:

```
export { PostgreSqlMikroORM as MikroORM, type PostgreSqlOptions as Options, definePostgreSqlConfig as defineConfig, } from './PostgreSqlMikroORM.js';
```

`defineConfig` is the re-exported alias of `definePostgreSqlConfig`. Phase 3/4 can rely on this named export.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Copy ALL `services/*/package.json` in deps stage, not only the target service's manifest**

- **Found during:** Task 2 first build attempt
- **Issue:** Plan's Pattern 2 instructed `COPY services/games/package.json ./services/games/` only. Bun's workspace resolver scans every workspace member at install time; with `services/wallets/` missing, `bun install --frozen-lockfile` reported `lockfile had changes, but lockfile is frozen` because the resolved tree no longer matched the lockfile's full workspace view.
- **Fix:** Added `COPY services/wallets/package.json ./services/wallets/` (and the games manifest in the wallets Dockerfile) in the deps stage. Source code is still only copied for the target service in later stages, so layer reuse is preserved.
- **Files modified:** services/games/Dockerfile, services/wallets/Dockerfile
- **Commit:** e1b7260

**2. [Rule 3 - Blocking] COPY `frontend/package.json` in deps stage**

- **Found during:** Task 2 first build attempt
- **Issue:** Root `package.json` declares `frontend` as a workspace member. Bun install failed with `Workspace not found "frontend"` because the frontend directory was not in the image context.
- **Fix:** Added `COPY frontend/package.json ./frontend/` to both Dockerfiles' deps stages.
- **Files modified:** services/games/Dockerfile, services/wallets/Dockerfile
- **Commit:** e1b7260

**3. [Rule 3 - Blocking] Add root `.dockerignore`**

- **Found during:** Task 2 second build attempt
- **Issue:** Bun's workspace install hoists transitive deps into `packages/*/node_modules/`. The `COPY packages ./packages` command was dragging host symlinks into the image, breaking `--frozen-lockfile`. With the build context now at the repo root (P1.2), the per-service `.dockerignore` files no longer apply.
- **Fix:** Created `/Users/pedro/Projetos/fullstack-challenge/.dockerignore` excluding `node_modules`, `**/node_modules`, `.env*`, `dist`, `tests`, `.planning`, `.claude`, `docker/`. Root `.dockerignore` is required by the new build-context layout and is the natural extension of the per-service files described in the plan's threat model T-01.3-05.
- **Files created:** .dockerignore
- **Commit:** e1b7260

**4. [Rule 3 - Inherited from P1.2] Task 3 no-op**

- **Found during:** Task 3 verification
- **Issue:** Plan's Task 3 said "Insert two new service blocks into docker-compose.yml". P1.2 already added these blocks as stubs with the exact shape Task 3 specified (build.target=migrate, restart="no", env_file, command, depends_on.postgres). With Task 2 landing the Dockerfile multi-stage targets, the stubs became functional with zero compose edits required.
- **Fix:** No file change. Verified the existing blocks against every Task 3 acceptance criterion — all pass. `docker compose config --quiet` exits 0; `docker compose build games-migrate wallets-migrate` succeeds.
- **Commit:** none (Task 3 produced no diff)

## Auth Gates

None encountered.

## Known Stubs

The `entities: []` in both `mikro-orm.config.ts` is intentional per the plan's `<objective>`: Phase 1 baseline is empty; Phase 2 registers OutboxMessage/InboxMessage, Phase 3 registers Wallet/Transaction, Phase 4 registers Round/Bet. The empty migrations directories carry the same intent. These are tracked by the file-level comment in each `mikro-orm.config.ts` and are NOT bugs.

## Threat Surface

No new threat surface introduced. The plan's threat register is satisfied:

- T-01.3-01 (image pin tampering): mitigated — base image is `oven/bun:1.3.11-alpine`, exact pin matching `.bun-version`.
- T-01.3-02 (lockfile drift): mitigated — both image builds run `bun install --frozen-lockfile`; host re-install is idempotent.
- T-01.3-03 (migration restart loop): mitigated — `restart: "no"` on both migrate blocks (set in P1.2).
- T-01.3-04 (root user): accepted — `oven/bun:*-alpine` defaults to `bun` user; verified by inspection. Future hardening adds explicit `USER bun` in Phase 10.
- T-01.3-05 (source leak): mitigated — root `.dockerignore` excludes `.env*`, `dist`, `tests`, `node_modules`, `.planning`, `.claude`, `docker/`. Tests inside `services/*/.dockerignore` continue to apply for service-local artifacts.
- T-01.3-SC (supply chain): mitigated — new packages all installed via the existing lockfile; `bun install --frozen-lockfile` runs both on host and inside the image.

## Verification Results

Overall plan verification (per `<verification>` section):

- `docker compose config --quiet` -> exit 0
- `docker build -f services/games/Dockerfile --target runtime .` -> exit 0 (image bee8c5c78)
- `docker build -f services/games/Dockerfile --target migrate .` -> exit 0 (image 872003190)
- `docker build -f services/wallets/Dockerfile --target runtime .` -> exit 0 (image e9dd311fc)
- `docker build -f services/wallets/Dockerfile --target migrate .` -> exit 0 (image f06970c10)
- `bun install --frozen-lockfile` from repo root -> 0 changes (idempotent)
- `docker compose build games-migrate wallets-migrate` -> both built clean

## Self-Check: PASSED

Files verified:

- FOUND: services/games/Dockerfile
- FOUND: services/wallets/Dockerfile
- FOUND: services/games/package.json (mikro-orm CLI block + @mikro-orm/cli dep present)
- FOUND: services/wallets/package.json (mikro-orm CLI block + @mikro-orm/cli dep present)
- FOUND: services/games/tsconfig.json (module=ESNext, moduleResolution=Bundler, decorator flags explicit)
- FOUND: services/wallets/tsconfig.json (module=ESNext, moduleResolution=Bundler, decorator flags explicit)
- FOUND: services/games/mikro-orm.config.ts (PostgreSqlDriver via defineConfig, empty entities)
- FOUND: services/wallets/mikro-orm.config.ts (PostgreSqlDriver via defineConfig, empty entities)
- FOUND: services/games/src/infrastructure/mikro-orm/migrations/.gitkeep
- FOUND: services/wallets/src/infrastructure/mikro-orm/migrations/.gitkeep
- FOUND: .dockerignore

Commits verified:

- FOUND: 1249399 (Task 1 — feat(01-03): expand service manifests with MikroORM 7.1 and migration scaffolds)
- FOUND: e1b7260 (Task 2 — feat(01-03): rewrite service Dockerfiles as multi-stage workspace-aware builds)
- N/A: Task 3 (no diff required — P1.2 stubs already match Task 3 spec; Task 2 made them functional)
