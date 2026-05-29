---
phase: 07-frontend-vertical-slice
plan: 01
subsystem: infra
tags: [kong, cors, eslint, zod, contracts, websocket, monorepo]

# Dependency graph
requires:
  - phase: 06-websocket-multiplier-sync
    provides: "WS event payload zod schemas + types defined in services/games/src/presentation/dtos/ws-event.payloads.ts"
provides:
  - "@crash/contracts/ws subpath exporting the eleven WS payload zod schemas + inferred types as the single source of truth for both server and browser tiers"
  - "Scoped Kong cors plugin allowing http://localhost:3000 with credentials on the games + wallets REST services"
  - "@crash/no-number-for-money ESLint rule extended to .tsx so REQ-DOM-06 is enforced in React components"
affects: [07-02, 07-03, 07-04, 07-05, 07-06, frontend, websocket-client]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared contract subpath: WS payload schemas live once in @crash/contracts/ws; the games service re-exports them so the two tiers cannot drift"
    - "Per-service Kong cors plugin scoped to the SPA origin (never * with credentials) instead of a global wildcard"

key-files:
  created:
    - packages/contracts/src/ws/ws-event.payloads.ts
    - packages/contracts/src/ws/index.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/contracts/package.json
    - services/games/src/presentation/dtos/ws-event.payloads.ts
    - docker/kong/kong.yml
    - eslint.config.js

key-decisions:
  - "Attach the cors plugin per-service (games + wallets) rather than a single global plugin — keeps the policy explicit and credential-safe, leaves the WS service untouched since socket.io reflects origin at the handshake"
  - "max_age set to 3600 (1h) as a conventional preflight-cache hint, not a business constant"
  - "Adding **/*.tsx to the shared first config block also extends the no-restricted-properties process.env guard to .tsx, which is correct — the config-file override stays .ts-only and was not widened"

patterns-established:
  - "Single-source WS contract: schema defined in contracts, re-exported by the producing service; consumers keep their existing relative import path with zero call-site changes"

requirements-completed: [REQ-DOM-06, REQ-FE-04]

# Metrics
duration: ~12min
completed: 2026-05-28
---

# Phase 7 Plan 01: Pre-FE Infra & Shared Contract Unblock Summary

**Promoted the eleven WS payload zod schemas to a shared `@crash/contracts/ws` subpath, added a scoped Kong `cors` plugin for the SPA origin with credentials, and extended the `@crash/no-number-for-money` ESLint rule to `.tsx` — three browser-tier blockers landed before any FE code.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-28
- **Completed:** 2026-05-28
- **Tasks:** 3
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- WS payload schemas + inferred types relocated byte-for-byte into `packages/contracts/src/ws/ws-event.payloads.ts`, exposed at `@crash/contracts/ws` via the package exports map and the root barrel; the games service is now a one-line re-export so server and browser share exactly one definition (T-07-02 mitigation).
- Kong `cors` plugin attached to the games + wallets REST services scoped to `http://localhost:3000` with `credentials: true`, explicit `GET/POST/OPTIONS` methods and `Authorization/Content-Type` headers — never `*` with credentials (T-07-01 mitigation). WS service block left untouched.
- Money guard glob extended to `**/*.tsx` with the JSX parser option enabled and `**/*.test.tsx` added to the rule-off test override, so REQ-DOM-06 is enforced in React components (T-07-03 mitigation).

## Task Commits

1. **Task 1: Promote WS payload schemas to @crash/contracts/ws** — `158b33e` (feat)
2. **Task 2: Scoped Kong CORS plugin for the SPA origin** — `f26948c` (feat)
3. **Task 3: Extend the money ESLint rule to .tsx files** — `cd186d9` (feat)

## Files Created/Modified
- `packages/contracts/src/ws/ws-event.payloads.ts` - The eleven WS payload zod schemas + inferred types (single source of truth); `moneySnapshotSchema` imported relatively from `../money/snapshot`
- `packages/contracts/src/ws/index.ts` - Barrel re-export of the WS payloads
- `packages/contracts/src/index.ts` - Added `export * from "./ws"` so `@crash/contracts` also surfaces the WS types
- `packages/contracts/package.json` - Added `"./ws": "./src/ws/index.ts"` to the exports map
- `services/games/src/presentation/dtos/ws-event.payloads.ts` - Replaced body with `export * from "@crash/contracts/ws"`; existing relative-path consumers in the games service keep working unchanged
- `docker/kong/kong.yml` - Per-service `cors` plugin on games + wallets; WS service untouched
- `eslint.config.js` - `**/*.tsx` added to the money-rule files glob + `ecmaFeatures.jsx`; `**/*.test.tsx` added to the rule-off override

## Decisions Made
- Per-service `cors` plugins over a global plugin: explicit, credential-safe, and leaves the WS service's socket.io origin-reflection in place.
- `max_age: 3600` as a standard preflight-cache window (not a hardcoded business constant — CLAUDE.md compliant).
- Pure lift-and-shift of the WS schemas: no field name, no `roundTickPayloadSchema` shape, and no money-field type changed, preserving the verified Phase 6 server contract.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- The games unit suite shows **8 pre-existing failures** (213 pass / 8 fail). Verified via `git stash` comparison that the identical pass/fail counts hold at baseline commit `bf1100d` BEFORE any 07-01 change — they are `serverTime` / clock-mocking mismatches in `get-ws-snapshot.use-case.test.ts` and related (the use case reads wall-clock time instead of the injected `Clock`). Out of scope for this pure-relocation plan; logged to `.planning/phases/07-frontend-vertical-slice/deferred-items.md` for the verifier. `bunx tsc --noEmit` is clean for both the contracts package and the games service, confirming the relocation itself is sound.

## Verification Evidence
- `bunx tsc --noEmit -p packages/contracts/tsconfig.json` → exit 0
- `cd services/games && bunx tsc --noEmit` → clean
- `grep -c roundSnapshotPayloadSchema packages/contracts/src/ws/ws-event.payloads.ts` → 2
- `grep -v '^\s*#' docker/kong/kong.yml | grep -c cors` → 2; origin `http://localhost:3000` present, `credentials: true`, WS block unchanged (live `curl -i -X OPTIONS` preflight deferred to the phase live-smoke gate per plan done-criteria)
- `grep -c tsx eslint.config.js` → 2
- `bunx eslint --print-config frontend/Component.tsx` → `@crash/no-number-for-money` = `2` (error); `frontend/Component.test.tsx` → `0` (off)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Browser REST calls from `:3000` will pass the CORS preflight once `docker:up` is live (preflight returns the scoped origin, not `*`).
- FE can import WS payload schemas + types from `@crash/contracts/ws` with no risk of drift from the server.
- The money guard now covers `.tsx`, so FE components typing a money symbol as `number` will fail lint.
- Pre-existing games clock-injection unit failures are tracked in `deferred-items.md` for the verifier — not introduced by this plan.

## Self-Check: PASSED

- Created files verified present: `packages/contracts/src/ws/ws-event.payloads.ts`, `packages/contracts/src/ws/index.ts`, `07-01-SUMMARY.md`
- Commits verified in git history: `158b33e`, `f26948c`, `cd186d9`

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-28*
