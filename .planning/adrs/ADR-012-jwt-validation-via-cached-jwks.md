# ADR-012: JWT validation via `jose` + cached JWKS at each service over passport-jwt + Kong JWT plugin

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 3

## Context

REQ-AUTH-04 requires each backend service to validate incoming JWTs via cached JWKS (issuer + audience + signature + expiry checks). ARCHITECTURE.md §1 + the `docker/kong/kong.yml` shape already settled the gateway role: Kong is a pure router with no JWT plugin loaded — every protected endpoint validates the bearer inside the service. Phase 3 owns the first implementation against the `wallets-service`; Phase 6 will inherit the same shape for the `games-service` and the WebSocket gateway handshake.

Three constraints shaped the library choice. First, Bun 1.3 + NestJS 11.1 + SWC decorator transform has a documented friction with `@nestjs/passport` metadata (PITFALLS M1 — `reflect-metadata` interaction with Bun's SWC pipeline strips some decorator types). Second, the JWKS cache must respect Keycloak's `Cache-Control` headers without us hand-rolling a fetch + TTL ladder. Third, the dependency footprint matters for the arguição — every extra package is a potential question, and a chain of three (`passport` + `passport-jwt` + `jwks-rsa` + `@nestjs/passport`) is harder to defend than one focused library.

A separate, audience-strategy decision rode in on the same plan (03-04 Task 3): does the `crash-game-client` Keycloak client emit a custom audience for the wallets service, or do we accept Keycloak's default `aud: "account"`? Keycloak's default-emitted audience is documented behaviour for public PKCE clients without a protocol mapper.

Three implementation options were evaluated.

## Considered

- **`passport-jwt` + `jwks-rsa` + `@nestjs/passport`** — The "standard NestJS" path on Stack Overflow. `passport-jwt` handles bearer extraction + claim validation, `jwks-rsa` provides the JWKS cache + signing-key lookup, `@nestjs/passport` glues the strategy into a NestJS guard. Three packages plus the passport peer dep. Each has its own configuration shape, its own cache semantics, its own error mapping. The combination is documented but lengthy; the decorator metadata interaction with Bun's SWC pipeline is a real risk (PITFALLS M1, observed in early Phase 1 spikes).
- **Kong JWT plugin** — Move JWT validation to the gateway. Requires Kong DB mode (the plugin is incompatible with declarative DB-less config in the way `kong.yml` is wired in `docker-compose.yml`); requires per-consumer credentials configured against Kong's admin API at boot; ties the audience strategy to Kong's claim-mapping rather than our application; conflicts with REQ-AUTH-04's "at each service" wording (the wording is explicit because the WebSocket handshake in Phase 6 must validate at the IoAdapter, not the gateway).
- **`jose@^6.2.3` `createRemoteJWKSet` + `jwtVerify` (chosen)** — Single dependency. `createRemoteJWKSet(new URL(jwksUri), { cacheMaxAge: 600_000, cooldownDuration: 30_000 })` returns a `JWKSAuthenticationKeyResolver` that fetches Keycloak's JWKS on first verify, caches by `kid` for `cacheMaxAge`, and refuses to re-fetch within `cooldownDuration` even on cache miss (DOS-resistant). `jwtVerify(token, JWKS, { issuer, audience })` does the rest — signature, iss, aud, exp checks in one call; throws `JOSEError` subclasses (`JWTExpired`, `JWTClaimValidationFailed`) that the guard maps to a uniform `UnauthorizedException`. No reflect-metadata interaction, no SWC decorator friction, no peer-dependency chain.

## Decision

**`jose@^6.2.3` `createRemoteJWKSet` + `jwtVerify` invoked from a per-service `JwtGuard` implementing `CanActivate`.** **Audience: `account`** (Option B — accept Keycloak's default-emitted aud for public PKCE clients without adding a realm mapper).

`JwtGuard` (Plan 03-04 commit `343b01a` + `7cd9a81`, file `services/wallets/src/presentation/guards/jwt.guard.ts`):

```ts
const JWKS = createRemoteJWKSet(new URL(jwksUri), {
  cacheMaxAge: 600_000,        // 10 minutes
  cooldownDuration: 30_000,    // refuse re-fetch faster than every 30s
});

const { payload } = await jwtVerify(token, JWKS, { issuer, audience });
req.user = { playerId: payload.sub, tokenExp: payload.exp };
return true;
```

Bearer extraction handles `Authorization: Bearer <token>` only — no query-string fallback, no cookie fallback. Failures map to a single `UnauthorizedException("INVALID_TOKEN")` (or `"MISSING_BEARER_TOKEN"`); the raw `JOSEError` is never logged or returned to the caller (avoids leaking JWKS internals or token contents). Constructor accepts an optional `JwtGuardOptions` for test injection; production wiring lazily requires `config/defaults` so the unit suite never has to satisfy the full zod schema (Plan 03-04 deviation 1).

Audience strategy — Option B: `KEYCLOAK_AUDIENCE=account`. Rationale: `crash-game-client` is a public PKCE SPA client with no protocol mapper in `docker/keycloak/realm-export.json`, so Keycloak emits `aud: "account"` (its management audience) by default. Option A (add an audience mapper for `wallets-service` to the realm export) was considered and rejected for the v1 surface — zero realm changes means zero import-time risk and one fewer thing for the recruiter to ask "why" about. The semantic concern (sharing Keycloak's management audience for game traffic) is acceptable for the challenge scope and documented for Phase 6 revisit. The realm export was later aligned with the audience mapper (commit `edb4560`) to keep the .env.example honest about what the realm emits, but the JwtGuard still accepts `account` as the canonical audience — a future tightening to a dedicated `wallets` audience is a one-line .env change in both services.

Final `services/wallets/src/config/defaults.ts` env trio (also in root `.env.example`):

| Key | Value |
|-----|-------|
| `KEYCLOAK_ISSUER` | `http://localhost:8080/realms/crash-game` |
| `KEYCLOAK_JWKS_URI` | `http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs` |
| `KEYCLOAK_AUDIENCE` | `account` |

`KC_HOSTNAME=localhost` + `KC_HOSTNAME_STRICT=false` (added in `docker-compose.yml` commit `08fec70`) pins the `iss` claim regardless of network path — browser-issued tokens and in-network-issued tokens both carry `iss: http://localhost:8080/realms/crash-game`, while in-network callers (wallets, games) still resolve `keycloak:8080` for the JWKS fetch. This closes 03-RESEARCH Pitfall 2 (cross-network iss mismatch).

Seven unit tests (Plan 03-04, `services/wallets/tests/unit/jwt.guard.test.ts`) cover happy path + six rejection cases: missing header, malformed bearer, iss mismatch, aud mismatch, expired token (exp 120s in the past), foreign-key signature. Test fixture uses an extractable RS256 key pair via `generateKeyPair` + `exportJWK`, served from an in-process `Bun.serve` listener on an ephemeral port; tokens signed with `SignJWT`; a second "foreign" key pair proves signature rejection. `bun test tests/unit/jwt.guard.test.ts` reports 7 pass, 0 fail.

Rationale, per 03-RESEARCH §6 "JWKS guard": `jose` is the canonical low-level JWT library for the JOSE ecosystem (RFCs 7515/7516/7517/7519), audited and used inside multiple major OIDC libraries. `createRemoteJWKSet`'s cache + cooldown contract is exactly what we'd build by hand, so reusing it removes a maintenance surface without giving up auditability — the guard itself is 76 lines, every one defensible. The Passport chain's value proposition (strategy abstraction over multiple auth schemes) buys us nothing on a single-issuer project, and the SWC decorator friction is real PITFALLS material. Kong JWT plugin is the wrong layer for REQ-AUTH-04 + Phase 6 WS handshake.

## Consequences

- **Locked in**: `jose@^6.2.3` as a direct dependency of `services/wallets`; the same dependency will land in `services/games` and the WebSocket gateway in Phase 6 (one library, one pattern, one cache shape across all three surfaces); `KEYCLOAK_ISSUER` / `KEYCLOAK_JWKS_URI` / `KEYCLOAK_AUDIENCE` env trio + `KC_HOSTNAME=localhost` + `KC_HOSTNAME_STRICT=false` is the canonical Keycloak alignment for the project.
- **JWKS cache semantics**: 10-minute `cacheMaxAge` + 30-second `cooldownDuration` are the `jose` library's effective contract — re-fetch happens at most every 30 seconds even under cache-miss pressure; Keycloak's `Cache-Control` headers from the JWKS endpoint are respected.
- **Audience tightening path**: switching from `account` to a dedicated `wallets` audience is a one-line `.env` change in both services + a realm mapper edit; documented for Phase 6 alongside the games-service guard rollout.
- **Foreclosed**: `@nestjs/passport` strategy pattern at the service layer (not needed for single-issuer single-scheme); Kong JWT plugin (wrong layer, conflicts with DB-less Kong config and the Phase 6 WS handshake validation requirement); hand-rolled JWKS fetch (no audit value, more code).
- **Anticipated recruiter question**: "Why not `passport-jwt`?" — defended by the dependency-chain argument, the SWC decorator friction (PITFALLS M1), and the fact that the guard is 76 lines that the recruiter can read end-to-end in the arguição.
- **Operational cost**: one JWKS fetch per service per `cacheMaxAge` (10 minutes) — call it 144 fetches per service per day, negligible against Keycloak's capacity.

## Alternatives Rejected

- **`passport-jwt` + `jwks-rsa` + `@nestjs/passport`** — three-package chain plus Passport peer dep; documented Bun + SWC decorator friction (PITFALLS M1); strategy abstraction has no payoff on a single-issuer project; more code, more configuration surface, worse arguição story.
- **Kong JWT plugin** — requires DB-mode Kong (incompatible with the current declarative `kong.yml`); ties audience strategy to gateway claim-mapping; conflicts with REQ-AUTH-04's "at each service" wording and the Phase 6 WebSocket handshake validation requirement.
- **Hand-rolled JWKS fetch** — re-implements cache + cooldown semantics that an audited library already provides; no scoring benefit on the architecture rubric since the trade-off is "we built less" not "we built better".
- **Audience Option A (add a realm mapper for a dedicated `wallets` audience)** — one extra realm-export entry, one extra failure mode at import time, no semantic gain at the v1 scope; deferred to Phase 6 when games-service joins and the audience surface widens.
