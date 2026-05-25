---
phase: 03-wallet-service
plan: 07
subsystem: gateway
tags: [kong, routing, gateway, perimeter, req-wall-04]
requires:
  - phase: 01-foundation
    provides: "Kong DB-less declarative routing at docker/kong/kong.yml fronting wallets:4002 and games:4001"
  - phase: 03-wallet-service/04
    provides: "JwtGuard live at the wallets service; perimeter narrowing is now meaningful because the only auth-bearing surface is also the only Kong-forwarded surface"
provides:
  - "Two named, method-constrained Kong routes for wallets-service: wallets-provision (POST ~/wallets$) and wallets-me (GET ~/wallets/me$)"
  - "Regex-anchored path matching that closes the prefix-leak through which POST /wallets/me/debit reached the service"
  - "Documented post-condition probe matrix that smoke tests can replay verbatim"
affects:
  - 03-05 (WalletsController gains exactly the two surfaces Kong exposes — no controller method is reachable without a matching Kong route)
  - 03-09 (smoke probes will re-run this matrix in CI once P3.05 controllers are live in the container image)
  - 06 (games-service guard rollout inherits the same method-constrained route pattern when game endpoints land)
tech-stack:
  added: []
  patterns:
    - "Kong regex paths anchored with ~ ... $ to defeat the default prefix-match behaviour"
    - "One named route per (method, path) tuple — additive expansion requires an explicit YAML edit, visible in code review"
key-files:
  created:
    - .planning/phases/03-wallet-service/03-07-SUMMARY.md
  modified:
    - docker/kong/kong.yml
key-decisions:
  - "Use regex-anchored Kong paths (~/wallets$, ~/wallets/me$) instead of plain prefix paths — plain /wallets matched POST /wallets/me/debit during the live probe"
  - "Keep games-service route untouched in this plan — games-service hardening is owned by Phase 6"
patterns-established:
  - "Perimeter narrowing pattern: one Kong route per (method, path) tuple; everything else returns gateway-origin 404 before the service is reached"
  - "Verification pattern: a probe matrix where each row records expected code, observed code, and origin (Kong vs service) — leakage shows up as a 404 with a service error envelope instead of Kong's no-route body"
requirements-completed: [REQ-WALL-04]
duration: 12 min
completed: 2026-05-25
---

# Phase 03 Plan 07: Kong wallets-route narrowing Summary

**Kong gateway map for wallets-service tightened from one permissive `/wallets/*` prefix route to two method-anchored regex routes (`POST ~/wallets$`, `GET ~/wallets/me$`); five mutation probes now return Kong's `no Route matched` 404 before reaching the wallets container.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-25T19:18:00Z
- **Completed:** 2026-05-25T19:30:57Z
- **Tasks:** 2 (1 auto + 1 checkpoint)
- **Files modified:** 1 (`docker/kong/kong.yml`)

## Accomplishments

- Replaced the permissive `wallets-routes` block with two named, method-constrained routes — `wallets-provision` (POST `~/wallets$`) and `wallets-me` (GET `~/wallets/me$`).
- Confirmed via Kong admin API that exactly two wallets routes plus the untouched `games-routes` are loaded.
- Closed REQ-WALL-04 at the perimeter: every mutation method/path combination beyond the two allowed surfaces returns a Kong-origin `404 no Route matched with those values` before the wallets service is touched.
- Established the regex-anchor pattern (`~ ... $`) for future gateway tightening when games-service or any other bounded context follows the same shape.

## Task Commits

1. **Task 1 — Replace permissive `wallets-routes` with two narrow named routes** — `ae853d0` (chore)
2. **Task 1 follow-up — Regex-anchor the paths so prefix matching cannot leak** — `fdd5ec5` (fix)
3. **Task 2 — Live probe checkpoint (human-verify)** — no commit; verification only

**Plan metadata:** this SUMMARY commit (`docs(03-07): complete Kong wallets route narrowing plan`).

## Files Created/Modified

- `docker/kong/kong.yml` — wallets-service `routes:` array replaced; two regex-anchored, method-constrained routes; games-service block untouched.
- `.planning/phases/03-wallet-service/03-07-SUMMARY.md` — this file.

## Final route map (live, observed via Kong admin API)

```
$ curl -s http://localhost:8001/routes | jq -r '.data[].name'
wallets-provision
games-routes
wallets-me
```

`docker/kong/kong.yml` post-plan:

```yaml
- name: wallets-service
  url: http://wallets:4002
  routes:
    - name: wallets-provision
      paths:
        - ~/wallets$
      methods:
        - POST
      strip_path: true
    - name: wallets-me
      paths:
        - ~/wallets/me$
      methods:
        - GET
      strip_path: true
```

## Probe matrix (observed against the live stack)

| # | Probe | Expected | Observed code | Origin | Body signature |
|---|-------|----------|---------------|--------|----------------|
| 2 | `POST /wallets` | 2xx or service 404 (P3.05 not yet in container image) | 404 | wallets-service | `{"message":"Cannot POST /","error":"Not Found","statusCode":404}` |
| 3 | `GET /wallets/me` | 2xx or service 404 (P3.05 not yet in container image) | 404 | wallets-service | `{"message":"Cannot GET /","error":"Not Found","statusCode":404}` |
| 4 | `PATCH /wallets` | 404 at gateway | 404 | Kong | `{"message":"no Route matched with those values","request_id":"7abe1f5f..."}` |
| 5 | `POST /wallets/me/debit` | 404 at gateway | 404 | Kong | `{"message":"no Route matched with those values","request_id":"f8c12b3e..."}` |
| 6 | `DELETE /wallets/me` | 404 at gateway | 404 | Kong | `{"message":"no Route matched with those values","request_id":"88908d1b..."}` |
| 7 | `PUT /wallets` | 404 at gateway | 404 | Kong | `{"message":"no Route matched with those values","request_id":"5aa6fa65..."}` |
| 8 | `GET /games/health` | 200 (untouched) | 200 | games-service | `{"status":"ok","service":"games","version":"0.0.1"}` |

The matrix is read top-to-bottom as: probes 2-3 forward into the wallets container (correct gateway behaviour; the service responds 404 because the WalletsController commit `8649189` lives on the branch but the container image has not been rebuilt in this wave); probes 4-7 each return the Kong-origin `no Route matched` 404 (origin confirmed by `request_id` field, which is a Kong-only response header / body field); probe 8 is unchanged at 200.

**Critical distinction:** A leak would surface as a service-origin 404 (NestJS error envelope with `statusCode` field) on probes 4-7. The fact that probes 4-7 carry the Kong `request_id` body signature proves the gateway short-circuited the request and `wallets:4002` was never contacted.

## Decisions Made

- **Regex-anchored paths over plain prefix paths.** Kong's default behaviour for a plain `paths: [/wallets]` entry is *prefix* matching, so `POST /wallets/me/debit` matched the `wallets-provision` route even with `methods: [POST]` set (the method matched, the prefix matched, the route matched). Switching to `~/wallets$` and `~/wallets/me$` forces Kong to compile the entry as a PCRE regex anchored at end-of-string, giving exact-match enforcement. Documented as a Rule 1 (bug) deviation below; verified via probe 5 returning gateway-origin 404.
- **Leave the games-service route alone.** It is owned by Phase 6 and out of REQ-WALL-04 scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Plain `/wallets` prefix path leaked POST /wallets/me/debit through Kong**
- **Found during:** Task 2 live probe matrix (probe 5).
- **Issue:** The plan-prescribed YAML uses `paths: [/wallets]` and `paths: [/wallets/me]` with method constraints. Kong's plain-path semantics are prefix-match, so `POST /wallets/me/debit` matched the `wallets-provision` route (path prefix `/wallets`, method `POST`) and was forwarded to the wallets service. The service then returned its own 404 — which is exactly the failure mode REQ-WALL-04 says must NOT happen.
- **Fix:** Switched both paths to PCRE form with the `~` prefix and the `$` end-anchor: `~/wallets$` and `~/wallets/me$`. Kong then compiles these as exact-match regexes, and the leak closes.
- **Files modified:** `docker/kong/kong.yml`.
- **Verification:** Probe 5 re-run after `docker compose restart kong`: code went from a service-origin 404 to a Kong-origin 404 (`request_id` body signature). Same outcome for probes 4, 6, 7.
- **Committed in:** `fdd5ec5` (`fix(kong): anchor wallets route paths so prefix POST /wallets/* is blocked at gateway`).

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** The deviation strengthens the plan's stated goal — it is the difference between "the gateway looks tightened but actually isn't" and "the gateway is verifiably tightened". No scope creep; one-line YAML change per route.

## Issues Encountered

- The two **allowed** probes (POST /wallets, GET /wallets/me) return service-origin 404 in this snapshot. This is expected and orthogonal to this plan: `8649189 feat(wallets): WalletsController POST /wallets + GET /wallets/me behind JwtGuard` has landed on the branch but the running wallets container image was built before that commit. P3.05 owns the controller-into-image step; P3.09 owns the CI smoke probe that locks the full 2xx behaviour. The Kong narrowing decision in this plan is independent of that — what this plan asserts is the **gateway-side post-condition**, not the **service-side response code**.
- No other issues.

## User Setup Required

None — the kong.yml change is declarative and picked up on `docker compose restart kong`.

## Next Phase Readiness

- REQ-WALL-04 is closed at the gateway layer. Recruiter inspecting `docker/kong/kong.yml` during arguição sees an explicit, two-route enumeration with method anchors — a deliberate signal.
- P3.05 (WalletsController) is unblocked; once the wallets container is rebuilt, probes 2 and 3 will flip from service-origin 404 to 201/200, and probes 4-7 will remain Kong-origin 404 (the regex anchors make that invariant by construction).
- P3.09 (CI smoke) should lift this same probe matrix verbatim. The `request_id` field in the Kong-origin body is a reliable assertion target — its presence is a Kong signature, its absence on probes 4-7 would indicate a regression in the route map.
- No blockers for the remainder of Phase 3.

---
*Phase: 03-wallet-service*
*Completed: 2026-05-25*

## Self-Check: PASSED

- `.planning/phases/03-wallet-service/03-07-SUMMARY.md` exists on disk.
- `docker/kong/kong.yml` exists on disk.
- Commit `ae853d0` resolves in `git log --all` (initial narrowing).
- Commit `fdd5ec5` resolves in `git log --all` (regex-anchor fix).
