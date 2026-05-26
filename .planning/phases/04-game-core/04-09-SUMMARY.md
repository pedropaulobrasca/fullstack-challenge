---
phase: 04-game-core
plan: 09
subsystem: gateway
tags: [kong, routing, gateway, perimeter, defense-in-depth, req-game-02, req-game-03, req-game-04, req-game-05]
dependency-graph:
  requires:
    - phase: 04-game-core/08
      provides: "Four READ controllers reachable at /games/rounds/current, /games/rounds/history, /games/rounds/:roundId/verify, /games/bets/me"
    - phase: 03-wallet-service/07
      provides: "PCRE-anchored Kong route pattern (~ ... $ + methods array) — wallets-provision and wallets-me as reference shape"
  provides:
    - "Four named, method-constrained, regex-anchored Kong routes for games-service (games-current, games-history, games-verify, games-bets-me)"
    - "Kong-origin 404 default-deny for every path under /games not matched by the four allowed (method, path) pairs — including the future POST /games/bet from Phase 5"
  affects:
    - 04-11 (smoke probes lift the same probe-matrix discipline from P3.09 against the four games routes)
    - 05 (Phase 5 must add POST /games/bet + POST /games/bet/cashout entries to kong.yml alongside the saga; without that explicit edit the saga is unreachable from the public side — by design)
tech-stack:
  added: []
  patterns:
    - "Kong PCRE-anchored regex paths (`~ ... $`) with explicit methods whitelist — additive expansion requires a visible YAML edit"
    - "One named route per (method, path) tuple — `games-` prefix mirrors the `wallets-` prefix from P3.07"
key-files:
  created:
    - .planning/phases/04-game-core/04-09-SUMMARY.md
  modified:
    - docker/kong/kong.yml
key-decisions:
  - "PCRE anchors on every route (`~/games/...$`) — without `$` Kong falls back to prefix-match and a path like `/games/rounds/current/extra` would also resolve. P3.07 documented this exact failure mode (commit fdd5ec5)."
  - "Method whitelist explicitly `GET` on all four routes — closes the X-Method-Override attack surface at the gateway and makes any future POST require an explicit YAML edit."
  - "Verify route uses `[^/]+` for the roundId segment, NOT `.+` — `[^/]+` enforces single-segment matching so `/games/rounds/abc/verify/extra` is rejected at the gateway."
  - "Did NOT add POST /games/bet or POST /games/bet/cashout — Phase 5 owns those alongside the saga. Defense-in-depth: even if a Phase 5 controller is wired before its Kong route is added, the route is unreachable from the public side."
  - "Did NOT introduce any plugin (logging/auth/rate-limit) — bare narrowing only; plugin discipline is an out-of-plan concern."
patterns-established:
  - "Gateway narrowing discipline now applies to both wallets (P3.07) and games (P4.09) services — Phase 5 saga and any future service inherits the same one-route-per-tuple rule."
requirements-completed: []
duration: 4 min
completed: 2026-05-26
metrics:
  duration_minutes: 4
  task_count: 1
  files_modified: 1
  completed_at: "2026-05-26"
requirements:
  - REQ-GAME-02
  - REQ-GAME-03
  - REQ-GAME-04
  - REQ-GAME-05
---

# Phase 04 Plan 09: Kong games-route narrowing Summary

**Kong gateway map for games-service tightened from one permissive `/games` prefix route to four named, method-anchored regex routes (`GET ~/games/rounds/current$`, `GET ~/games/rounds/history$`, `GET ~/games/rounds/[^/]+/verify$`, `GET ~/games/bets/me$`); every other path/method under `/games` now returns a Kong-origin 404 before the games container is touched.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-26T21:35:23Z
- **Completed:** 2026-05-26T21:40:00Z
- **Tasks:** 1 (1 auto)
- **Files modified:** 1 (`docker/kong/kong.yml`)

## Accomplishments

- Replaced the permissive `games-routes` (`paths: [/games]`) block with four named, regex-anchored, method-constrained routes mirroring the P3.07 wallets pattern.
- Closed REQ-GAME-02 / 03 / 04 / 05 at the gateway perimeter — the four READ endpoints shipped in Plan 04-08 are the only `/games/*` surfaces reachable from the public side.
- Enforced GET-only on every route — `POST/PUT/DELETE/PATCH` on any of the four allowed paths now returns a Kong-origin 404, not a service-origin 405.
- Preserved Phase 5 isolation — `POST /games/bet` and `POST /games/bet/cashout` are intentionally absent from kong.yml so that the saga must explicitly open them when it lands, making the additive change reviewable.
- Did not touch the wallets-service block.

## Final route map

`docker/kong/kong.yml` post-plan (games block only):

```yaml
- name: games-service
  url: http://games:4001
  routes:
    - name: games-current
      paths:
        - ~/games/rounds/current$
      methods:
        - GET
      strip_path: false
    - name: games-history
      paths:
        - ~/games/rounds/history$
      methods:
        - GET
      strip_path: false
    - name: games-verify
      paths:
        - ~/games/rounds/[^/]+/verify$
      methods:
        - GET
      strip_path: false
    - name: games-bets-me
      paths:
        - ~/games/bets/me$
      methods:
        - GET
      strip_path: false
```

## Verification (static — live verification deferred to Plan 04-11)

| Check | Command | Expected | Observed |
|---|---|---|---|
| Total `name: games-` entries (service + 4 routes) | `grep -c "name: games-" docker/kong/kong.yml` | >= 5 | 5 |
| Regex-prefixed games path entries | `grep -c "~/games/" docker/kong/kong.yml` | >= 4 | 4 |
| Lines ending in `$` (4 games + 2 wallets PCRE end-anchors) | `grep -c '\$$' docker/kong/kong.yml` | >= 6 | 6 |
| Mutation methods on games routes | `grep -nE 'POST\|PUT\|DELETE\|PATCH' docker/kong/kong.yml` (lines under games block) | none | none (only wallets-provision POST at line 39) |

Live probe matrix (post `bun run docker:up` or `docker compose restart kong`) is owned by Plan 04-11. Expected matrix:

| # | Probe | Expected | Origin |
|---|-------|----------|--------|
| 1 | `GET /games/rounds/current` | 2xx (controller from P4.08) | games-service |
| 2 | `GET /games/rounds/history` | 2xx | games-service |
| 3 | `GET /games/rounds/<uuid>/verify` (pre-SETTLED) | 400 `ROUND_NOT_YET_SETTLED` | games-service |
| 4 | `GET /games/bets/me` (no JWT) | 401 | games-service (JwtGuard) |
| 5 | `POST /games/bet` | 404 | Kong (`request_id` body signature) |
| 6 | `POST /games/bet/cashout` | 404 | Kong |
| 7 | `DELETE /games/rounds/current` | 404 | Kong |
| 8 | `GET /games/admin` | 404 | Kong |
| 9 | `GET /games/rounds/current/extra` | 404 | Kong (PCRE `$` anchor closes prefix-leak) |
| 10 | `GET /games/rounds/abc/verify/extra` | 404 | Kong (`[^/]+` single-segment match closes the leak) |

## Task Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | Replace `games-routes` with four method-anchored regex routes | `46ff005` |

**Plan metadata commit:** `docs(04-09): complete Kong games route narrowing plan` (added after this SUMMARY is written).

## Decisions Made

- **PCRE anchors on every route.** Without `$`, Kong's prefix-match would let `/games/rounds/current/anything` match `games-current`. P3.07 ran into this exact failure mode on the wallets side (commit `fdd5ec5`); applying the lesson by construction here.
- **Method whitelist GET only.** Every allowed surface is read-only; method discipline at the gateway means even an accidental Phase 5 mutation controller wired at one of the four allowed paths would be blocked until a kong.yml edit lifts the restriction.
- **`[^/]+` not `.+` for the roundId segment.** Single-segment matching prevents path traversal like `/games/rounds/foo/verify/bar` from reaching `games-verify`.
- **No plugins added.** Auth, rate limit, and logging are not in REQ-GAME-02..05 scope; bare narrowing only.
- **No POST routes for Phase 5.** Explicitly leaving `POST /games/bet` and `POST /games/bet/cashout` out of the route map enforces the Phase 5 contract: the saga lands together with its gateway entry, not before.

## Deviations from Plan

None — the plan executed exactly as written. Rules 1-4 were not triggered.

## Threat Model Compliance

| Threat ID | Disposition | Mitigation in this plan |
|---|---|---|
| T-04-09-01 (Tampering — accidental admin route exposure) | mitigate | Default-deny at Kong: any new `/games/*` path requires an explicit, reviewable YAML entry. The four routes are an exhaustive allowlist; everything else is 404. |
| T-04-09-02 (Tampering — HTTP method override) | accept | No method-override plugin is loaded in `kong.yml`. Kong validates the wire-level method natively against the `methods` array. |
| T-04-09-03 (Information disclosure — verify URL brute force) | accept | Round IDs are UUID v4 (128 bits of entropy). Future rate limiting tracked in REQ-STRETCH-07. |
| T-04-09-04 (Spoofing — bypass JwtGuard by hitting the games container directly) | accept | Internal container network only; production hardening out of scope. |

## Threat Flags

None — no new trust boundaries or surfaces introduced; the change strictly contracts the existing public surface.

## Known Stubs

None — declarative gateway config, fully implemented.

## Requirements Closed

None closed exclusively by this plan — REQ-GAME-02..05 close end-to-end once Plan 04-11 smoke probes confirm both the gateway narrowing (this plan) and the controllers (Plan 04-08) behave as specified live. This plan owns the gateway half of that pair.

## Next Phase Readiness

- Plan 04-11 (smoke probes) is unblocked — the probe matrix above is ready to execute verbatim once the games container is rebuilt with the P4.06 round loop + P4.08 controllers.
- Phase 5 (saga) inherits the discipline: adding `POST /games/bet` and `POST /games/bet/cashout` requires explicit `kong.yml` entries; without them the saga is unreachable from the public side — exactly the defense-in-depth goal.

---
*Phase: 04-game-core*
*Completed: 2026-05-26*

## Self-Check: PASSED

- `.planning/phases/04-game-core/04-09-SUMMARY.md` — FOUND (this file)
- `docker/kong/kong.yml` — FOUND, contains four `games-` routes with PCRE-anchored paths
- Commit `46ff005` — FOUND in `git log` (`chore(04-09): narrow Kong games routes to four method-anchored regex paths`)
- `grep -c "name: games-" docker/kong/kong.yml` → 5 (matches done criterion ≥ 5)
- `grep -c "~/games/" docker/kong/kong.yml` → 4 (matches done criterion ≥ 4)
- `grep -c '\$$' docker/kong/kong.yml` → 6 (matches done criterion ≥ 6)
- No mutation methods on any games route
