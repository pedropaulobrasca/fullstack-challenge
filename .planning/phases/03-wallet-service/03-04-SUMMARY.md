---
phase: 03-wallet-service
plan: 04
subsystem: wallets-auth
tags: [auth, jwt, jose, keycloak, jwks, security]
requires:
  - "@crash/shared-kernel sharedEnvSchema"
  - "Keycloak realm crash-game running on http://localhost:8080"
provides:
  - "JwtGuard validating bearer via cached Keycloak JWKS at the wallets service"
  - "KEYCLOAK_ISSUER / KEYCLOAK_JWKS_URI / KEYCLOAK_AUDIENCE env trio in defaults.ts + both .env.example files"
  - "KC_HOSTNAME=localhost pinning so iss claim aligns across browser and in-network callers"
affects:
  - services/wallets/src/presentation/guards/jwt.guard.ts (new)
  - services/wallets/tests/unit/jwt.guard.test.ts (new)
  - services/wallets/src/config/defaults.ts
  - services/wallets/.env.example
  - .env.example
  - docker-compose.yml
  - services/wallets/package.json
  - bun.lock
tech-stack:
  added:
    - jose@6.2.3
  patterns:
    - "createRemoteJWKSet with cacheMaxAge=600000 and cooldownDuration=30000"
    - "jwtVerify with issuer + audience options; rejects alg:none, mismatched iss, mismatched aud, expired tokens"
    - "Lazy env lookup so unit tests can inject options without forcing the zod schema to parse process.env"
key-files:
  created:
    - services/wallets/src/presentation/guards/jwt.guard.ts
    - services/wallets/tests/unit/jwt.guard.test.ts
  modified:
    - services/wallets/src/config/defaults.ts
    - services/wallets/.env.example
    - .env.example
    - docker-compose.yml
    - services/wallets/package.json
decisions:
  - "Audience strategy: Option B accepted — KEYCLOAK_AUDIENCE=account (no realm mapper). Recorded for ADR-012 input."
  - "JwtGuard accepts an optional JwtGuardOptions for test injection; env access deferred via lazy require so the unit suite never has to populate the wallets zod schema."
  - "KC_HOSTNAME_STRICT=false alongside KC_HOSTNAME=localhost so in-Docker callers via the keycloak service name still authenticate while tokens still carry the localhost issuer."
metrics:
  duration: 24 min
  completed: 2026-05-25
---

# Phase 03 Plan 04: Auth — JWT validation via cached JWKS

JwtGuard at the wallets service validates every bearer token against Keycloak's JWKS using jose v6.2.3 with built-in cache + cooldown; iss + aud + expiry are checked, req.user is populated with playerId, and seven unit tests cover the happy path plus six rejection cases.

## What landed

**Task 1 — Install jose, extend env schema, write .env.example trio** — `0bfb0e8`
- `bun add jose@6.2.3` pinned in `services/wallets/package.json`.
- `walletsEnvSchema` in `services/wallets/src/config/defaults.ts` gained three required fields: `KEYCLOAK_ISSUER` (url), `KEYCLOAK_JWKS_URI` (url), `KEYCLOAK_AUDIENCE` (non-empty string).
- The same three keys land in `services/wallets/.env.example` and the root `.env.example` so a fresh clone running `bun run docker:up` reaches an authenticatable state.

**Task 2 — Align Keycloak iss claim** — `08fec70`
- `docker-compose.yml` keycloak.environment gets `KC_HOSTNAME: localhost` plus `KC_HOSTNAME_STRICT: "false"`.
- Net effect: tokens carry `iss: http://localhost:8080/realms/crash-game` regardless of the network path the caller used, while in-network callers (the wallets and games services) still resolve `keycloak:8080` for the JWKS fetch.
- Closes Pitfall 2 from 03-RESEARCH (cross-network iss mismatch).

**Task 3 — Audience strategy decision (Option B)** — no commit, decision recorded here
- The crash-game-client is a public PKCE client with no protocol mapper, so Keycloak emits `aud: "account"` by default.
- Chose Option B (`KEYCLOAK_AUDIENCE=account`) over Option A (add an audience mapper to the realm-export):
  - Zero realm changes → no import-time typo risk.
  - Works immediately with the existing `docker/keycloak/realm-export.json`.
  - The semantic concern (sharing Keycloak's management audience for game traffic) is acceptable for the challenge scope and can be revisited in Phase 6 when games-service inherits the guard pattern. Documented as ADR-012 input.

**Task 4 — JwtGuard with seven unit tests (RED → GREEN)** — `343b01a` + `7cd9a81`
- 76-line guard in `services/wallets/src/presentation/guards/jwt.guard.ts`.
- JWKS resolver constructed once per instance via `createRemoteJWKSet(new URL(jwksUri), { cacheMaxAge: 600_000, cooldownDuration: 30_000 })`.
- `canActivate` extracts `Authorization: Bearer <token>`, calls `jose.jwtVerify(token, JWKS, { issuer, audience })`, attaches `req.user = { playerId: payload.sub, tokenExp: payload.exp }`.
- Never logs the raw token; only the wrapped UnauthorizedException reaches the framework error filter.
- Constructor accepts `JwtGuardOptions` for test injection; production wiring (no options) lazily requires `config/defaults` so the unit suite never has to satisfy the full zod schema.
- Test fixture: an extractable RS256 key pair via `generateKeyPair` + `exportJWK`, served from an in-process `Bun.serve` listener on an ephemeral port; tokens signed with `SignJWT`; a second "foreign" key pair lets test 7 prove signature rejection.

## Test outcomes (seven scenarios)

| Test | Assertion summary |
| --- | --- |
| missing Authorization header | rejects with `UnauthorizedException("MISSING_BEARER_TOKEN")` |
| malformed bearer (no `Bearer ` prefix) | rejects with `UnauthorizedException("MISSING_BEARER_TOKEN")` |
| valid token | returns `true`, attaches `req.user = { playerId: "player-42", tokenExp: <future epoch s> }` |
| iss mismatch | rejects with `UnauthorizedException("INVALID_TOKEN")` |
| aud mismatch | rejects with `UnauthorizedException("INVALID_TOKEN")` |
| expired token (`exp` 120s in the past) | rejects with `UnauthorizedException("INVALID_TOKEN")` |
| foreign-key signature | rejects with `UnauthorizedException("INVALID_TOKEN")` |

`bun test tests/unit/jwt.guard.test.ts` reports `7 pass, 0 fail, 11 expect() calls`.

## Final env values (in three files)

| Key | Value |
| --- | --- |
| KEYCLOAK_ISSUER | `http://localhost:8080/realms/crash-game` |
| KEYCLOAK_JWKS_URI | `http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs` |
| KEYCLOAK_AUDIENCE | `account` |

Present in `services/wallets/src/config/defaults.ts`, `services/wallets/.env.example`, and root `.env.example`.

## Deviations from Plan

**1. [Rule 1 — Bug] Lazy env resolution in JwtGuard**
- **Found during:** Task 4 RED → GREEN transition.
- **Issue:** A top-level `import { env } from "../../config/defaults"` triggers `walletsEnvSchema.parse(process.env)` at module load. Unit tests that pass full `JwtGuardOptions` and never need `env` were still failing because the zod parse blew up on `DATABASE_URL` / `RABBITMQ_URL` missing.
- **Fix:** Removed the top-level import; constructor consults `loadEnvOptions()` only when no options are provided, and `loadEnvOptions` performs a lazy `require("../../config/defaults")` so the env schema is parsed only on production wiring, never during unit tests.
- **Files modified:** `services/wallets/src/presentation/guards/jwt.guard.ts`.
- **Commit:** `7cd9a81`.

**2. [Rule 3 — Blocker] Test file location**
- **Found during:** Task 4 setup.
- **Issue:** Plan frontmatter `files_modified` lists `services/wallets/src/presentation/guards/jwt.guard.test.ts` (co-located with source), but the plan's verify line and `services/wallets/package.json#scripts.test` both target `tests/unit/`. Bun would not have discovered the test under `src/`.
- **Fix:** Placed the test under `services/wallets/tests/unit/jwt.guard.test.ts` so it participates in `bun test tests/unit`. The frontmatter entry is a stale path; the runner convention wins.
- **Files modified:** none beyond the test file's location.
- **Commit:** `343b01a`.

No architectural-scale deviations triggered (no Rule 4 stop).

## TDD Gate Compliance

- RED gate: `343b01a` (test failing, module not found).
- GREEN gate: `7cd9a81` (76-line guard, 7/7 pass).
- REFACTOR gate: not required — guard is already minimal and below the 80-line ceiling.

## Verification snapshot

```
$ bun test tests/unit/jwt.guard.test.ts
 7 pass
 0 fail
 11 expect() calls
Ran 7 tests across 1 file. [170.00ms]

$ grep -nE 'KEYCLOAK_(ISSUER|JWKS_URI|AUDIENCE)' \
    services/wallets/src/config/defaults.ts \
    services/wallets/.env.example \
    .env.example
services/wallets/src/config/defaults.ts:19:  KEYCLOAK_ISSUER: z.string().url(),
services/wallets/src/config/defaults.ts:20:  KEYCLOAK_JWKS_URI: z.string().url(),
services/wallets/src/config/defaults.ts:21:  KEYCLOAK_AUDIENCE: z.string().min(1),
services/wallets/.env.example:28:KEYCLOAK_ISSUER=http://localhost:8080/realms/crash-game
services/wallets/.env.example:29:KEYCLOAK_JWKS_URI=http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs
services/wallets/.env.example:30:KEYCLOAK_AUDIENCE=account
.env.example:57:KEYCLOAK_ISSUER=http://localhost:8080/realms/crash-game
.env.example:58:KEYCLOAK_JWKS_URI=http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs
.env.example:59:KEYCLOAK_AUDIENCE=account

$ grep -n KC_HOSTNAME docker-compose.yml
56:      KC_HOSTNAME: localhost
57:      KC_HOSTNAME_STRICT: "false"
```

The `curl http://localhost:8080/realms/crash-game/.well-known/openid-configuration` probe in the plan's verify block was NOT executed because the Docker stack is intentionally down during Wave 2 parallel execution (P3.02 and P3.03 are also editing). The probe is deferred to phase verification (`/gsd:verify-phase 3`), at which point a full `bun run docker:up` happens once.

## Deferred / open items

- ADR-012 (Plan 03-10) should record the Option B decision with the same rationale captured above.
- Phase 6 games-service guard will inherit this same audience; if a distinct resource audience is wanted then, add the protocol mapper at that time and bump both services' `KEYCLOAK_AUDIENCE` together.
- The guard is implemented but NOT yet applied to a controller. The wallets controller (P3.05) will add `@UseGuards(JwtGuard)` and read `playerId` off `req.user`.

## Known Stubs

None — the guard is fully functional. The fact that no controller uses it yet is plan-scoped (P3.05 wires it).

## Self-Check: PASSED

- All six target files exist on disk.
- All four task commits resolve in `git log --all`: `0bfb0e8`, `08fec70`, `343b01a`, `7cd9a81`.
