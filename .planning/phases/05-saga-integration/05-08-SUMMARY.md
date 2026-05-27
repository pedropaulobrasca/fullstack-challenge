---
phase: 05-saga-integration
plan: 08
subsystem: gateway
tags: [kong, perimeter, routes, pcre]
requires:
  - 05-04  # POST /games/bet handler exists in games-service
  - 05-06  # POST /games/bet/cashout handler exists in games-service
provides:
  - "Kong perimeter routes for POST /games/bet and POST /games/bet/cashout"
  - "PCRE-anchored + method-constrained gateway surface for bet mutations"
affects:
  - docker/kong/kong.yml
tech_stack_added: []
patterns:
  - "PCRE-anchored route paths (~/path$) + explicit methods list — same shape used by P3.07 wallets perimeter"
key_files:
  created:
    - .planning/phases/05-saga-integration/05-08-SUMMARY.md
  modified:
    - docker/kong/kong.yml
decisions:
  - "Routes listed as place-then-cashout (matching research §Updated Kong block) — Kong's PCRE matcher prioritizes by path length regardless of YAML order, so ordering is a maintenance convention only."
  - "Both anchored paths use $ terminator so /games/bet/anything and /games/bet/cashout/anything are not matched and fall through to Kong-origin 404."
metrics:
  duration_minutes: 3
  completed_date: 2026-05-27
  tasks_completed: 1
  files_changed: 1
---

# Phase 05 Plan 08: Kong Routes for Bet Place + Cashout Summary

Added two PCRE-anchored POST routes (`games-bet-place`, `games-bet-cashout`) to Kong's `games-service` block so the gateway forwards `POST /games/bet` and `POST /games/bet/cashout` to `games:4001`. Brings total games-service routes to 6 (4 GET from P4.09 + 2 POST from this plan). Wallets-service block untouched.

## What Was Built

Two new entries appended to `services[0].routes` in `docker/kong/kong.yml`:

| Route name          | PCRE path                | Method | Upstream      |
| ------------------- | ------------------------ | ------ | ------------- |
| `games-bet-place`   | `~/games/bet$`           | POST   | `games:4001`  |
| `games-bet-cashout` | `~/games/bet/cashout$`   | POST   | `games:4001`  |

Both use `strip_path: false` matching the existing convention. The `$` terminator prevents path-suffix attacks (`/games/bet/../wallets`, `/games/bet/cashout/extra`).

## Verification

Performed `bun -e` validation via js-yaml parse:

```
count: 6
routes: ["games-current","games-history","games-verify","games-bets-me","games-bet-place","games-bet-cashout"]
place: {"name":"games-bet-place","paths":["~/games/bet$"],"methods":["POST"],"strip_path":false}
cashout: {"name":"games-bet-cashout","paths":["~/games/bet/cashout$"],"methods":["POST"],"strip_path":false}
OK
```

Live perimeter probes (POST allowed, other methods 404, mutation paths not in list 404) are deferred to plan 05-10's smoke probe matrix.

## Deviations from Plan

None — plan executed exactly as written.

Note on verification tooling: the plan suggested `python3 -c "import yaml; ..."` but PyYAML is not available on this machine (PEP 668 restricts system pip). Switched to an equivalent `bun -e` invocation using `js-yaml` (already in the project's transitive deps via Bun's standard module resolution). Same assertion (route names + count = 6) ran and passed. This is not a Rule deviation — the plan permitted `yq` or any equivalent YAML parse; recording it here for transparency.

## Threat Surface

No new threat surface beyond what the threat register already covers:
- T-05-08-S (path traversal) — mitigated by `$` terminator.
- T-05-08-M (unexpected methods) — mitigated by `methods: [POST]`.

The actual service-layer handlers (validation, auth, rate limits) live in `services/games/src/presentation/controllers/bet-command.controller.ts` (plans 05-04 / 05-06) — this plan only opens the gateway.

## Known Stubs

None.

## Commits

| Hash      | Message                                                                            |
| --------- | ---------------------------------------------------------------------------------- |
| efca229   | feat(05-08): open Kong perimeter for POST /games/bet and /games/bet/cashout        |

## Self-Check: PASSED

- docker/kong/kong.yml — FOUND, 6 routes confirmed via js-yaml parse
- commit efca229 — FOUND in git log
- .planning/phases/05-saga-integration/05-08-SUMMARY.md — being written now
