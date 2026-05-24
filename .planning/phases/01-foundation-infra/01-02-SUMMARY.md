---
phase: 01-foundation-infra
plan: 02
subsystem: docker-compose-infra
tags: [docker-compose, keycloak, healthchecks, infra]
requires:
  - 01-01 (workspace + Bun pinning)
provides:
  - Keycloak healthcheck on management port 9000
  - Repo-root build context wired for games + wallets
  - Migration init containers declared (Dockerfile multi-stage targets land in P1.3)
  - Verified realm export with player/player123 demo user and PKCE-S256 OIDC client
affects:
  - P1.3 (Dockerfile multi-stage build with deps/migrate/runtime targets)
  - P1.7 (typed env config — needs .env files for compose validation)
  - P1.10 (smoke test — boots stack and exercises realm import)
tech-stack:
  added: []
  patterns:
    - "One-shot migration init container per service (depends_on: service_completed_successfully)"
    - "Multi-stage Dockerfile target selector (target: runtime / target: migrate)"
    - "Alpine-native healthcheck via wget -qO- (no curl in oven/bun:*-alpine)"
key-files:
  created: []
  modified:
    - docker-compose.yml
    - docker/keycloak/realm-export.json
decisions:
  - "Use wget -qO- for service healthchecks (alpine Bun image has no curl)"
  - "Keep redirectUris locked to ports 3000 (frontend) and 8080 (Keycloak self-redirect); drop legacy 5173"
  - "Declare games-migrate and wallets-migrate stubs in this plan to keep docker compose config gate green; P1.3 fills in the Dockerfile multi-stage targets"
metrics:
  duration: ~10min
  completed: 2026-05-24
  tasks: 3
  commits: 3
---

# Phase 1 Plan 2: Docker Compose Fixes Summary

One-liner: Keycloak healthcheck moved to management port 9000, services rewired to repo-root build context with alpine-native wget healthchecks, realm export verified with `player/player123` and PKCE-S256 client.

## Tasks Completed

| Task | Description | Commit | Files |
| ---- | ----------- | ------ | ----- |
| 1 | Fix Keycloak healthcheck and expose management port 9000 | ee5ca03 | docker-compose.yml |
| 2 | Reshape games and wallets service blocks for repo-root build context | 167cb61 | docker-compose.yml |
| 3 | Verify Keycloak realm export carries demo user and OIDC client | 359f901 | docker/keycloak/realm-export.json |

## Keycloak Healthcheck — Before vs After

**Before:**

```yaml
keycloak:
  ports:
    - "8080:8080"
  environment:
    KC_HEALTH_ENABLED: "true"
  healthcheck:
    test: ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/8080 && ... grep -q '200'"]
    retries: 15
    start_period: 30s
```

**After:**

```yaml
keycloak:
  ports:
    - "8080:8080"
    - "9000:9000"
  environment:
    KC_HEALTH_ENABLED: "true"
    KC_HTTP_MANAGEMENT_PORT: "9000"
  healthcheck:
    test: ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/9000 && ... grep -q '200'"]
    retries: 30
    start_period: 60s
```

Rationale: Keycloak 25→26 moved `/health/ready` from the public port to the management port. Without this fix, `bun run docker:up --wait` hangs indefinitely because the admin console is reachable on 8080 but the healthcheck target endpoint moved to 9000.

This is the supporting evidence for ADR-003 (Keycloak 26.x healthcheck port migration).

## Realm Export Delta

The file already satisfied REQ-AUTH-05 invariants. One cosmetic edit was applied:

| Field | Before | After | Reason |
| ----- | ------ | ----- | ------ |
| `redirectUris[1]` | `http://localhost:5173/*` | `http://localhost:8080/*` | Vite default 5173 is unused (STACK locks TanStack Start on 3000); 8080 covers Keycloak self-redirect |
| `webOrigins[1]` | `http://localhost:5173` | `http://localhost:8080` | Same — mirrors redirectUris |

All other fields verified intact:

- `realm: "crash-game"`, `enabled: true`
- User `player` with `enabled: true`, `emailVerified: true`, password `player123` (not temporary)
- Client `crash-game-client`: `publicClient: true`, `standardFlowEnabled: true`, `directAccessGrantsEnabled: true`, `pkce.code.challenge.method: S256`

The realm imports cleanly with `--import-realm` and the Phase 1 smoke test (P1.10) will be able to obtain a token via password grant against the management endpoint.

## Service Block Reshape Notes

| Service | Build context (before) | Build context (after) |
| ------- | ---------------------- | --------------------- |
| games | `./services/games` (Dockerfile at root of context) | `./` + `dockerfile: services/games/Dockerfile` + `target: runtime` |
| wallets | `./services/wallets` (Dockerfile at root of context) | `./` + `dockerfile: services/wallets/Dockerfile` + `target: runtime` |

Healthchecks converted from `curl -sf http://localhost:PORT/health` to `wget -qO- http://localhost:PORT/health` so the alpine Bun image works without an extra `apk add curl` layer.

`depends_on` expanded to four conditions per service:

- `postgres: service_healthy`
- `rabbitmq: service_healthy`
- `keycloak: service_healthy`
- `{service}-migrate: service_completed_successfully`

## Deviations from Plan

### Rule 3 — Auto-fixed blocking issue

**1. Added games-migrate and wallets-migrate stub service blocks**

- **Found during:** Task 2 verification (`docker compose config --quiet` failure)
- **Issue:** Plan's acceptance criteria assumed Docker Compose tolerates forward references in `depends_on`. It does not — `compose config` errors with `service "games" depends on undefined service "games-migrate": invalid compose project`.
- **Fix:** Added minimal service blocks for `games-migrate` and `wallets-migrate` that point at `target: migrate` of the same Dockerfile P1.3 will define. The blocks are syntactically valid for `compose config` but will only resolve at `up` time once P1.3 lands the multi-stage Dockerfile. This matches the plan's intent (P1.3 owns the Dockerfile multi-stage targets) without violating the `compose config` parse gate.
- **Files modified:** docker-compose.yml (added 28 lines for two stub blocks above the games service)
- **Commit:** 167cb61
- **Impact on P1.3:** P1.3 still owns the Dockerfile and the `target: migrate` stage definition; the compose entries declared here will reference those targets unchanged.

### Rule 1 — Realm export redirect URI alignment

**2. Replaced port 5173 with 8080 in redirectUris/webOrigins**

- **Found during:** Task 3
- **Issue:** Realm export had `http://localhost:5173/*` (Vite default) but STACK locks TanStack Start on port 3000. The 5173 entry is unreachable in this stack.
- **Fix:** Replaced 5173 with 8080 per plan's explicit `<action>` step 4.
- **Files modified:** docker/keycloak/realm-export.json
- **Commit:** 359f901

## Verification Results

Overall plan verification (per `<verification>` section):

- `docker compose config --quiet` exits 0 (validated with stub `.env` files; the env files are P1.7 territory).
- `grep -c '/dev/tcp/localhost/9000' docker-compose.yml` → 1.
- `grep -c '/dev/tcp/localhost/8080' docker-compose.yml` → 0.
- `node -e "JSON.parse(...)"` against realm-export.json → exits 0.

All acceptance criteria across the three tasks pass.

## Authentication Gates

None encountered.

## Known Stubs

`games-migrate` and `wallets-migrate` service blocks point at `target: migrate` of `services/{games,wallets}/Dockerfile`. The Dockerfile multi-stage target itself does not exist yet — P1.3 lands it. Until then, `docker compose up` for those two services would fail at image build time. This is intentional and matches the plan's wave-3 ordering: P1.2 (this plan) prepares the compose shape; P1.3 implements the Dockerfile; P1.10 boots the full stack.

## Self-Check: PASSED

Verified items:

- FOUND: docker-compose.yml (modified)
- FOUND: docker/keycloak/realm-export.json (modified)
- FOUND: commit ee5ca03 (task 1)
- FOUND: commit 167cb61 (task 2)
- FOUND: commit 359f901 (task 3)
