---
phase: 01-foundation-infra
plan: 10
subsystem: healthcheck-smoke-test
tags: [smoke, healthcheck, bootstrap-verification, integration]
requires:
  - "01-02 (docker compose shape + Keycloak health on 9000)"
  - "01-03 (multi-stage Dockerfiles + mikro-orm.config.ts scaffolds)"
  - "01-06 (eslint money guard + no-restricted-properties)"
  - "01-07 (typed env layer with env.PORT)"
  - "01-09 (README documenting bun run docker:up surface)"
provides:
  - "Dedicated HealthController per service exposing GET /health on direct service port"
  - "scripts/smoke-health.sh covering all seven Phase 1 probes"
  - "Env-driven NestJS bootstrap reading PORT from typed config layer"
  - "Verified bun run docker:up bootstraps every container to healthy state on a fresh clone"
affects:
  - "Phase 2 inherits the green stack as the seed for outbox publisher / consumer wiring"
  - "Phase 10 wires scripts/smoke-health.sh into the GitHub Actions CI gate"
tech-stack:
  added: []
  patterns:
    - "Dedicated HealthController per service (presentation layer, no I/O)"
    - "type-only import for response DTO interface (Bun runtime requirement)"
    - "127.0.0.1 in container healthcheck URLs to bypass alpine IPv6 first-lookup refusal"
    - "Postgres 18 single-mount layout at /var/lib/postgresql (parent of versioned data dir)"
    - "mikro-orm discovery.warnWhenNoEntities=false for empty Phase 1 baseline"
key-files:
  created:
    - scripts/smoke-health.sh
    - services/games/src/presentation/controllers/health.controller.ts
    - services/wallets/src/presentation/controllers/health.controller.ts
    - .planning/phases/01-foundation-infra/01-10-SUMMARY.md
  modified:
    - services/games/src/main.ts
    - services/wallets/src/main.ts
    - services/games/src/app.module.ts
    - services/wallets/src/app.module.ts
    - services/games/src/presentation/controllers/games.controller.ts
    - services/wallets/src/presentation/controllers/wallets.controller.ts
    - services/games/src/presentation/dtos/health-check-response.dto.ts
    - services/wallets/src/presentation/dtos/health-check-response.dto.ts
    - services/games/mikro-orm.config.ts
    - services/wallets/mikro-orm.config.ts
    - docker-compose.yml
decisions:
  - "HealthCheckResponseDto modelled as TypeScript interface (not class) — strict-property-init compliant under exactOptionalPropertyTypes and consumed by HealthController via `import type`"
  - "Postgres 18 volume mounted at /var/lib/postgresql (single mount) — the 18.x official image rejects the legacy /var/lib/postgresql/data mount with an upgrade warning"
  - "Service healthchecks pinned to 127.0.0.1 (not localhost) because oven/bun:alpine resolves localhost via IPv6 first and the NestJS Express server only binds the IPv4 stack from `app.listen(env.PORT, '0.0.0.0')`"
  - "mikro-orm.config.ts opts out of warnWhenNoEntities so Phase 1's empty entity baseline still loads the CLI; Phase 2/3/4 will populate entities[] and remove the override"
metrics:
  duration_minutes: 10
  completed: 2026-05-24T19:17:24Z
  tasks_completed: 3
  files_created: 4
  files_modified: 10
---

# Phase 1 Plan 10: Healthcheck Smoke Test Summary

End-to-end Phase 1 verification: every container reaches healthy state under `bun run docker:up`, both services expose a `GET /health` endpoint sourced from the typed env layer, and `scripts/smoke-health.sh` confirms all seven probes green on both cold and warm bootstraps.

## Tasks Completed

| Task | Description | Commit | Files |
| ---- | ----------- | ------ | ----- |
| 1 | Add HealthController per service and wire env-driven bootstrap | 3c0bad2 | services/games/src/main.ts, services/games/src/app.module.ts, services/games/src/presentation/controllers/health.controller.ts, services/games/src/presentation/controllers/games.controller.ts, services/games/src/presentation/dtos/health-check-response.dto.ts, services/wallets/src/main.ts, services/wallets/src/app.module.ts, services/wallets/src/presentation/controllers/health.controller.ts, services/wallets/src/presentation/controllers/wallets.controller.ts, services/wallets/src/presentation/dtos/health-check-response.dto.ts, services/games/mikro-orm.config.ts, services/wallets/mikro-orm.config.ts |
| 2 | Create scripts/smoke-health.sh covering all seven probes | b5d37ec | scripts/smoke-health.sh |
| 3 | Full-stack smoke run (deviation fixes folded into a single commit) | 438c7df | docker-compose.yml, services/games/mikro-orm.config.ts, services/wallets/mikro-orm.config.ts, services/games/src/presentation/controllers/health.controller.ts, services/wallets/src/presentation/controllers/health.controller.ts |

## Smoke Run Output (Final, Warm Cache)

```
$ bun run smoke:health
$ bash scripts/smoke-health.sh
Running Phase 1 smoke probes against local stack...

[PASS] postgres pg_isready
[PASS] rabbitmq management api
[PASS] keycloak /health/ready (port 9000)
[PASS] keycloak password grant (player/player123)
[PASS] kong admin /status (port 8001)
[PASS] games /health (port 4001)
[PASS] wallets /health (port 4002)

Smoke summary: 7/7 probes passed
```

Both cold (post-`docker:prune`) and warm (`docker:down` -> `docker:up`) runs produce identical output. The Keycloak token probe returns a JWT, proving the realm import + demo user seeding survived the boot cycle.

## Bootstrap Timing Observed

| Run | Cache state | Stack ready (`docker:up --wait` returned) |
| --- | ----------- | ----------------------------------------- |
| 1 | Cold (post `docker:prune`, full image build) | ~90s |
| 2 | Warm (containers re-created, images cached, volumes preserved) | ~20s |

Postgres `init-databases.sh` runs only on the cold path (fresh volume); warm-path migration containers see existing `games` / `wallets` DBs and exit 0 immediately because the migrations directories carry only `.gitkeep`.

## Container Lifecycle at Steady State

```
NAME                             STATUS                    PORTS
fullstack-challenge-games-1      Up (healthy)              0.0.0.0:4001->4001/tcp
fullstack-challenge-wallets-1    Up (healthy)              0.0.0.0:4002->4002/tcp
fullstack-challenge-keycloak-1   Up (healthy)              0.0.0.0:8080->8080/tcp, 0.0.0.0:9000->9000/tcp
fullstack-challenge-kong-1       Up (healthy)              0.0.0.0:8000->8000/tcp, 0.0.0.0:8001->8001/tcp
fullstack-challenge-postgres-1   Up (healthy)              0.0.0.0:5432->5432/tcp
fullstack-challenge-rabbitmq-1   Up (healthy)              0.0.0.0:5672->5672/tcp, 0.0.0.0:15672->15672/tcp
fullstack-challenge-games-migrate-1     Exited (0)
fullstack-challenge-wallets-migrate-1   Exited (0)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] HealthCheckResponseDto strict-property-init violation**

- **Found during:** Task 1 `bunx tsc --noEmit` verification
- **Issue:** The scaffolded DTO declared `status: string; service: string` as class properties under `"strict": true`, `"strictPropertyInitialization": true`, and `"exactOptionalPropertyTypes": true`. tsc reported TS2564 ("Property has no initializer and is not definitely assigned in the constructor"). The error existed before P1.10 but was masked because the verify step is new to this plan; adding the required `version: string` field surfaced it.
- **Fix:** Converted the DTO to a TypeScript interface (no runtime construction needed for a response shape) and updated both HealthControllers to import it via `import type` so Bun's runtime does not attempt to resolve a value export.
- **Files modified:** services/{games,wallets}/src/presentation/dtos/health-check-response.dto.ts, services/{games,wallets}/src/presentation/controllers/health.controller.ts
- **Commits:** 3c0bad2 (initial conversion), 438c7df (`import type` follow-up after Bun runtime SyntaxError observed in container)

**2. [Rule 3 - Blocking] Pre-existing mikro-orm.config.ts exactOptionalPropertyTypes failure**

- **Found during:** Task 1 verification
- **Issue:** `clientUrl: process.env.DATABASE_URL` is typed `string | undefined`, which violates the `exactOptionalPropertyTypes` contract on `defineConfig`. The error pre-existed from P1.3 but blocked Task 1's required `! grep -E 'error TS'` gate.
- **Fix:** `clientUrl: process.env.DATABASE_URL ?? ""` in both services. The empty string is never observed at runtime because Phase 1 env files always populate `DATABASE_URL`.
- **Files modified:** services/{games,wallets}/mikro-orm.config.ts
- **Commit:** 3c0bad2

**3. [Rule 3 - Blocking] Postgres 18 mount layout incompatibility**

- **Found during:** Task 3 first `docker:up` attempt
- **Issue:** `postgres_data:/var/lib/postgresql/data` triggered the postgres 18 image's startup guard: "Counter to that, there appears to be PostgreSQL data in: /var/lib/postgresql/data (unused mount/volume)". Postgres 18 stores data in a major-version-specific subdirectory and expects a single mount one level higher (parent of the versioned dir).
- **Fix:** Changed the compose volume to `postgres_data:/var/lib/postgresql`. Phase 1 has no committed data so this is a zero-risk path change. Documented in the decisions log for future pg_upgrade workflows.
- **Files modified:** docker-compose.yml
- **Commit:** 438c7df

**4. [Rule 3 - Blocking] MikroORM CLI rejects empty entities array**

- **Found during:** Task 3 second `docker:up` attempt (migration containers exited 1)
- **Issue:** `bunx mikro-orm migration:up` aborted with "No entities found, please use `entities` option". MikroORM 7 enforces `discovery.warnWhenNoEntities` by default; Phase 1's deliberately-empty `entities: []` baseline tripped the check.
- **Fix:** Added `discovery: { warnWhenNoEntities: false }` to both mikro-orm.config.ts files. Phase 2 will populate `entities[]` (OutboxMessage, InboxMessage) and Phase 3 (Wallet, Transaction) / Phase 4 (Round, Bet) extend further — at that point this override can be removed.
- **Files modified:** services/{games,wallets}/mikro-orm.config.ts
- **Commit:** 438c7df

**5. [Rule 3 - Blocking] Alpine `localhost` resolves IPv6 first, NestJS binds IPv4 only**

- **Found during:** Task 3 third `docker:up` attempt (services started but reported unhealthy)
- **Issue:** `wget -qO- http://localhost:4001/health` from inside the container returned "Connection refused". The NestJS Express server binds `0.0.0.0:4001` (IPv4 wildcard) per `app.listen(env.PORT, "0.0.0.0")`, but Alpine's musl resolver returned `::1` first for `localhost`, and Express does not listen on `::1`. Confirmed by `wget -qO- http://127.0.0.1:4001/health` succeeding inside the same container while `http://[::1]:4001/health` failed.
- **Fix:** Service healthchecks in docker-compose.yml now use `http://127.0.0.1:PORT/health` instead of `http://localhost:PORT/health`. Smoke probes from the host already used `http://localhost:PORT/health` because the host resolver hits the published IPv4 port mapping first.
- **Files modified:** docker-compose.yml
- **Commit:** 438c7df

## Authentication Gates

None. Keycloak's password-grant probe is service-to-service automation, not an interactive auth gate.

## Decisions Made

1. **HealthCheckResponseDto is an interface, not a class.** Phase 1 response DTOs do not need runtime instantiation; an interface satisfies the static-shape requirement without forcing strict-property-init dance. NestJS controllers return plain object literals, which serialize identically.

2. **127.0.0.1 instead of `localhost` for in-container healthchecks.** This documents the IPv4-only NestJS binding decision (`app.listen(env.PORT, "0.0.0.0")`) and prevents future regressions if developers paste healthchecks from generic web tutorials.

3. **discovery.warnWhenNoEntities is the temporary opt-out, not a permanent disable.** Phase 2/3/4 will populate `entities[]` and the override gets deleted in whichever plan first registers a real entity (likely Phase 2 with OutboxMessage).

4. **Postgres 18 single-mount layout.** Aligns with the upstream image's recommended path for pg_upgrade workflows; cheaper to adopt now while the volume is empty than during Phase 3 wallet migrations.

## Phase 1 Closeout — REQ-ID Coverage

| Requirement | Status | Evidence |
| ----------- | ------ | -------- |
| REQ-INFRA-01 (zero-step bootstrap) | satisfied | Cold `bun run docker:prune` -> `bun run docker:up` brings every container healthy with no manual steps |
| REQ-INFRA-02 (healthcheck-gated startup) | satisfied | `service_healthy` on postgres / rabbitmq / keycloak + `service_completed_successfully` on games-migrate / wallets-migrate enforced by depends_on |
| REQ-INFRA-03 (clean down + prune) | satisfied | `bun run docker:down` removes containers in ~10s; `bun run docker:prune` reclaims all volumes |
| REQ-INFRA-04 (version pinning) | satisfied | `.bun-version`=1.3.11, `oven/bun:1.3.11-alpine` in Dockerfiles, `bun.lock` committed |
| REQ-INFRA-05 (no hardcoded constants) | satisfied | env.PORT from typed config layer; `process.env` banned outside `src/config/` by ESLint |
| REQ-DOM-05 (CHECK constraint groundwork) | satisfied | Migration framework runs no-op on empty directories; Phase 3 ships the wallet CHECK constraint |
| REQ-DOM-06 (Money VO) | satisfied (P1.4) | Verified by P1.4 plan |
| REQ-AUTH-05 (demo user seed) | satisfied | Smoke probe 4 (Keycloak password grant) returns a JWT for player/player123 |
| REQ-DOC-03 (demo user pre-configured wallet) | deferred to Phase 3 | First-login provisioning model per ADR-005 |

## Phase Handoff Note

Phase 1 (Foundation & Infra) is complete and shippable. Phase 2 (Outbox/Inbox Messaging Spine) is unblocked and inherits:

- A green local stack from `bun run docker:up`
- The MikroORM CLI loaded (CLI binary in image, config typed) ready to register OutboxMessage / InboxMessage entities
- The shared-kernel event envelope interface from `packages/shared-kernel`
- The contracts skeleton from `packages/contracts`
- A smoke script that Phase 10 will wire into CI

## Self-Check: PASSED

Verified items:

- FOUND: scripts/smoke-health.sh (executable, 128 lines)
- FOUND: services/games/src/presentation/controllers/health.controller.ts
- FOUND: services/wallets/src/presentation/controllers/health.controller.ts
- FOUND: services/games/src/main.ts (env.PORT, no process.env.PORT)
- FOUND: services/wallets/src/main.ts (env.PORT, no process.env.PORT)
- FOUND: commit 3c0bad2 (Task 1 — health controllers + env-driven bootstrap)
- FOUND: commit b5d37ec (Task 2 — smoke script with 7 probes)
- FOUND: commit 438c7df (Task 3 — bootstrap deviation fixes)
- VERIFIED: `bun run smoke:health` exits 0 with all 7 probes passing on both cold and warm runs
- VERIFIED: `docker compose ps` shows every container healthy after `bun run docker:up`
