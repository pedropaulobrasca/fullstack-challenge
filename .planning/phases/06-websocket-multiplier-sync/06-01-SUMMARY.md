---
phase: 06-websocket-multiplier-sync
plan: 01
subsystem: games-service / presentation auth
tags: [auth, jwt, websocket-prep, refactor, tdd]
dependency_graph:
  requires:
    - services/games/src/presentation/guards/jwt.guard.ts (Phase 3)
    - services/games/src/config/defaults.ts (Phase 1)
  provides:
    - services/games/src/presentation/auth/jwt-verifier.service.ts
  affects:
    - services/games/src/presentation/guards/jwt.guard.ts (rewritten to delegate)
    - services/games/src/app.module.ts (registers JwtVerifierService provider)
tech_stack:
  added: []
  patterns:
    - shared verifier service consumed by HTTP guard + (future) WS handshake
    - jose createRemoteJWKSet cache constants preserved (cacheMaxAge 600000ms, cooldownDuration 30000ms)
key_files:
  created:
    - services/games/src/presentation/auth/jwt-verifier.service.ts
    - services/games/tests/unit/jwt-verifier.service.test.ts
    - services/games/tests/unit/jwt-guard.test.ts
  modified:
    - services/games/src/presentation/guards/jwt.guard.ts
    - services/games/src/app.module.ts
  removed:
    - services/games/tests/unit/jwt.guard.test.ts (replaced by jwt-guard.test.ts after constructor signature change)
decisions:
  - JwtVerifierService is a presentation-layer provider (not application) — it is wire-format / auth concern, no domain logic
  - Constructor reads env directly from config/defaults (matches pre-existing JwtGuard pattern); no constructor options injection
  - Guard preserves JwtGuardOptions export for API surface stability even though it is no longer consumed internally
metrics:
  duration_minutes: 4
  completed: 2026-05-28
  tasks_completed: 2
  files_changed: 5
  commits: 2
requirements:
  - REQ-AUTH-04
  - REQ-WS-01
---

# Phase 6 Plan 01: Extract JwtVerifierService Summary

Shared `JwtVerifierService` extracted from `JwtGuard` so the WS `IoAdapter` (Plan 06-03) can reuse the same `jose.createRemoteJWKSet`-backed token verifier instead of duplicating the JWKS cache and audience/issuer wiring.

## Goal

Make the HTTP guard and the upcoming WebSocket handshake middleware share a single JWT verification surface, while keeping the externally observable behavior of `JwtGuard` byte-stable (error codes, request augmentation shape, AuthenticatedRequest interface).

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create JwtVerifierService, rewrite JwtGuard, register provider | d1d9ab2 | jwt-verifier.service.ts (new), jwt.guard.ts (rewritten), app.module.ts (provider entry); removed obsolete tests/unit/jwt.guard.test.ts |
| 2 | Unit suites for verifier + delegating guard | 1b07784 | jwt-verifier.service.test.ts (new), jwt-guard.test.ts (new) |

## Behavior Locked

- `JwtVerifierService.verify(token)` resolves to `{playerId, tokenExp}` from `payload.sub`/`payload.exp` after `jose.jwtVerify(token, jwks, {issuer, audience})` succeeds.
- All failure modes — `jose` rejection (bad signature / expired / wrong iss / wrong aud), missing `sub`, missing `exp`, non-string `sub`, non-number `exp` — uniformly throw `UnauthorizedException("INVALID_TOKEN")` (T-06-02 mitigation: no jose stack trace leaked).
- JWKS cache constants carry forward verbatim: `cacheMaxAge: 600_000ms`, `cooldownDuration: 30_000ms` (T-06-03 mitigation).
- `JwtGuard.canActivate` still throws `UnauthorizedException("MISSING_BEARER_TOKEN")` for absent header, wrong scheme, or empty token after the `Bearer ` prefix — verifier is never invoked in these branches.
- `JwtGuard` is now constructor-injected with `JwtVerifierService` (no more `@Optional() JwtGuardOptions`); both are registered in `AppModule.providers`.

## Verification

- `cd services/games && bunx tsc --noEmit` — clean
- `cd services/games && bun test tests/unit` — 174 pass / 0 fail / 565 expect() calls (baseline was 165 before the test-file swap; net delta is +9 tests — 6 verifier + 5 guard - 7 removed legacy guard tests, plus a known +5 from a pre-existing untracked `config-defaults.test.ts` outside this plan's scope)
- `grep -c 'from "jose"' services/games/src/presentation/guards/jwt.guard.ts` returns `0`
- `grep -c 'JwtVerifierService' services/games/src/app.module.ts` returns `2` (import + provider entry)

## Deviations from Plan

1. **[Rule 3 - Blocking issue] Removed `services/games/tests/unit/jwt.guard.test.ts` during Task 1 instead of leaving it for Task 2 to rewrite.** The legacy file constructed `new JwtGuard({jwksUri, issuer, audience})` against the pre-refactor constructor. After Task 1 changed the constructor to `(verifier: JwtVerifierService)`, the file became a TypeScript compile error and would have blocked Task 1's verify step (`bunx tsc --noEmit && bun test`). Deletion is `git rm`'d in the Task 1 commit; the replacement file `jwt-guard.test.ts` is created in Task 2. No behavior is lost — Task 2's new file covers the same MISSING_BEARER_TOKEN and INVALID_TOKEN paths plus the verifier-delegation contract.

2. **[Rule 1 - Test bug, caught during initial Task 2 run] First draft of `jwt-verifier.service.test.ts` used `mockRejectedValueOnce` for the jose-rejection scenario.** Two consecutive `await expect(...).rejects.*` calls consumed the one-shot mock; the second call hit the default (resolved) and the test failed. Switched to `mockRejectedValue` (persistent) so both assertions in the same test see the rejection. Fixed before the Task 2 commit.

## Threat Coverage

| Threat ID | Disposition | Implementation site | Verified by |
|-----------|-------------|---------------------|-------------|
| T-06-01 (spoofing) | mitigated | `JwtVerifierService.verify` pins `issuer` + `audience` from env Keycloak realm; missing/typed-wrong sub or exp rejected | jwt-verifier.service.test.ts tests 3-6 |
| T-06-02 (info disclosure) | mitigated | All failure modes uniformly throw `UnauthorizedException("INVALID_TOKEN")` — no jose stack trace forwarded | jwt-verifier.service.test.ts test 2 + jwt-guard.test.ts test 5 |
| T-06-03 (JWKS hammering / DoS) | mitigated | `createRemoteJWKSet({cacheMaxAge: 600_000, cooldownDuration: 30_000})` constants preserved verbatim from the pre-refactor guard | code inspection (constructor of jwt-verifier.service.ts) |

## Out-of-Scope Pre-Existing Modifications Observed

The repository working tree contained pre-existing modifications outside this plan's scope at execute time: `.env.example`, `services/games/.env.example`, `services/games/src/config/defaults.ts`, `services/games/tests/setup.ts`, and an untracked `services/games/tests/unit/config-defaults.test.ts`. These were NOT included in any 06-01 commit. They are unrelated to JWT verifier extraction and should be reviewed/committed by the owner of whatever change introduced them.

## Known Stubs

None — the verifier is fully wired (real `jose` calls in production, mocked only in unit tests via `mock.module`).

## Next Plan

06-02 (parallel sibling, Wave 1) and 06-03 (Wave 2, will inject `JwtVerifierService` into the new `JwtIoAdapter` via `app.get(JwtVerifierService)` in `main.ts`).

## Self-Check: PASSED

- `services/games/src/presentation/auth/jwt-verifier.service.ts` — FOUND
- `services/games/src/presentation/guards/jwt.guard.ts` — FOUND (rewritten)
- `services/games/src/app.module.ts` — FOUND (JwtVerifierService registered)
- `services/games/tests/unit/jwt-verifier.service.test.ts` — FOUND
- `services/games/tests/unit/jwt-guard.test.ts` — FOUND
- Commit `d1d9ab2` (Task 1) — FOUND in `git log`
- Commit `1b07784` (Task 2) — FOUND in `git log`
- `grep -c 'from "jose"' …/jwt.guard.ts` returns 0 — VERIFIED
- `grep -c 'JwtVerifierService' …/app.module.ts` returns 2 — VERIFIED
- Full `bun test tests/unit` green (174 pass / 0 fail) — VERIFIED
