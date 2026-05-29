---
phase: 07-frontend-vertical-slice
plan: 09
subsystem: docs
tags: [adr, oidc-spa, pkce, canvas-2d, zustand, broadcastchannel, eslint, money-vo, closeout]

# Dependency graph
requires:
  - phase: 07-frontend-vertical-slice
    provides: "07-02..07-08 — the four frontend decisions this plan records (oidc-spa instance strategy, Canvas 2D curve, isolated multiplier store, multi-tab BroadcastChannel) and the config.ts env-cents lint debt logged in deferred-items.md"
provides:
  - "ADR-024..027 — the four Phase 7 frontend decisions recorded at next-free numbers (existing ADRs ended at 023, no collision)"
  - "ADRs README indexes ADR-024..027 under a Phase 7 section + a corrected future-ADRs numbering note"
  - "STATE/ROADMAP/REQUIREMENTS rotated to Phase 7 complete (7/10 phases); ROADMAP anticipated ADR-019..022 labels reconciled to 024..027 with a renumber note"
  - "frontend config.ts money-rule flag resolved (justified narrow eslint-disable; rule not weakened; lint clean)"
affects: [08-provably-fair-replay, verify-phase-7, ui-review]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ADR-renumber discipline: anticipated ROADMAP ADR labels are planning placeholders; shipped ADRs are never renumbered, so a phase's ADRs take the next-free range and the stale labels are reconciled in the phase closeout"
    - "Money-rule exception discipline: env-parsed raw integer cents that are immediately wrapped in Money.of(BigInt(...)) carry a justified, single-line eslint-disable with an explanatory comment rather than weakening the rule or obscuring the Cents semantics"

key-files:
  created:
    - .planning/adrs/ADR-024-tanstack-start-oidc-spa-pkce.md
    - .planning/adrs/ADR-025-canvas-2d-crash-curve.md
    - .planning/adrs/ADR-026-zustand-isolated-multiplier-store.md
    - .planning/adrs/ADR-027-oidc-spa-broadcastchannel-multi-tab-refresh.md
    - .planning/phases/07-frontend-vertical-slice/07-09-SUMMARY.md
  modified:
    - .planning/adrs/README.md
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - frontend/src/lib/config.ts

key-decisions:
  - "ADR-024..027 are the NEXT-FREE numbers (existing ADRs run 001..023); the ROADMAP anticipated 019..022 but those were consumed by Phases 5/6, so the four Phase 7 ADRs renumber to 024..027 — shipped ADRs are not renumbered"
  - "config.ts minCents/maxCents resolved with a narrowly-scoped justified eslint-disable rather than renaming (the keys ARE raw integer cents from env, honestly named) or weakening the @crash/no-number-for-money rule globally"
  - "REQUIREMENTS.md needed no requirement-status flips — all 15 Phase 7 REQ-IDs were already marked Done by the prior plans' executors; only the footer was updated to record the 07-09 closeout"

patterns-established:
  - "Phase-closeout ADR renumber-and-reconcile: record the actual ADR numbers, reconcile the ROADMAP's stale anticipated labels, and add a forward note that later phases' anticipated labels likewise resolve to next-free"

requirements-completed: [REQ-FE-01, REQ-FE-02, REQ-FE-03, REQ-FE-04, REQ-FE-05, REQ-FE-06, REQ-FE-07, REQ-FE-08, REQ-FE-11, REQ-FE-12, REQ-FE-13, REQ-FE-14, REQ-AUTH-01, REQ-AUTH-02, REQ-AUTH-03]

# Metrics
duration: ~25min
completed: 2026-05-29
---

# Phase 7 Plan 09: Frontend ADRs + Phase Closeout Summary

**Authored the four Phase 7 frontend ADRs (ADR-024 TanStack Start + oidc-spa PKCE-S256, ADR-025 Canvas 2D crash curve, ADR-026 Zustand isolated multiplier store, ADR-027 oidc-spa BroadcastChannel multi-tab refresh) at next-free numbers, rotated STATE/ROADMAP/REQUIREMENTS to Phase 7 complete (7/10 phases) with the anticipated ADR-019..022 labels reconciled to 024..027, and cleared the config.ts env-cents money-rule debt with a justified narrow eslint-disable — lint clean, tsc exit 0, 65/65 FE tests green.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-29
- **Completed:** 2026-05-29
- **Tasks:** 2 of 2 complete (both `type=auto`)
- **Files modified:** 10 (5 created, 5 modified)

## Accomplishments

- **Four senior-depth ADRs at next-free numbers (ADR-024..027):** Re-listed `.planning/adrs/` to reconfirm 024 is free (existing run to 023, no collision), then authored each in the exact house format (Status/Date/Phase/Context/Considered/Decision/Consequences/Alternatives Rejected) at ADR-023 depth — including the "Why NOT" subsections and the anticipated-recruiter-question lines the arguição probes. Each ADR cites its source evidence: ADR-024 (the 07-02 single-getOidc spike + 07-04 wiring + Pitfall 5), ADR-025 (CLAUDE.md §Frontend lock, D-05, 07-06 implementation, T-07-16 server freeze), ADR-026 (D-06, the 07-04 dispatch test asserting tick isolation), ADR-027 (REQ-AUTH-03, the 07-02 two-tab single-refresh observation, Pitfall 5).
- **ADRs README indexed:** added a Phase 7 section listing ADR-024..027 with one-line summaries in the existing table style, and corrected the "Future ADRs" note to explain the anticipated-label-vs-shipped-number reconciliation (and that later phases' labels likewise resolve to next-free).
- **Planning docs rotated to Phase 7 complete:** STATE.md → Phase 7 complete, progress bar `▰▰▰▰▰▰▰▱▱▱` 7/10, plans-landed narrative, next action `/gsd:verify-phase 7` + `/gsd:ui-review` + `/gsd:plan-phase 8`, ADRs landed 23→27. ROADMAP.md → Phase 7 checkbox `[x]`, all nine plans checked with a plans-landed narrative, anticipated ADR-019..022 labels reconciled to 024..027 with a renumber note, Progress table row 9/9 Complete. REQUIREMENTS.md → confirmed all 15 Phase 7 REQ-IDs Done (already flipped by prior plans), footer updated; Phase 8 REQ-FE-09/10 + REQ-REPLAY-* left Pending.
- **config.ts money-rule debt cleared (`<also_resolve>`):** the `@crash/no-number-for-money` flag on `minCents`/`maxCents` (the `AppConfig.bet` type signature) is resolved with a single-line `eslint-disable-next-line` carrying an explanatory comment — these are raw integer cents parsed from env, never a Money value, wrapped in `Money.of(BigInt(...))` at the only consumer (`features/bet/bet-amount.ts`). The rule was NOT weakened and the honest `Cents` naming was NOT obscured. `bun run lint` → 0 errors, `bunx tsc --noEmit` → exit 0, `bun run test` → 65/65 green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the four Phase 7 frontend ADRs (ADR-024..027) + README index** - `cc4894d` (docs)
2. **`<also_resolve>`: config.ts env-cents money-rule resolution** - `39d712e` (fix)
3. **Task 2: Rotate STATE / ROADMAP / REQUIREMENTS to Phase 7 complete** - `f8bfce1` (docs)

_The `<also_resolve>` lint fix is a distinct logical change (a source fix, not documentation), so it was committed separately from the ADR authoring task it shares Wave 6 with._

## Files Created/Modified

- `.planning/adrs/ADR-024-tanstack-start-oidc-spa-pkce.md` - TanStack Start + oidc-spa for OIDC Authorization Code + PKCE S256 over raw oidc-client-ts / hand-rolled PKCE
- `.planning/adrs/ADR-025-canvas-2d-crash-curve.md` - Canvas 2D (rAF + devicePixelRatio + clearRect) for the crash curve over SVG / WebGL
- `.planning/adrs/ADR-026-zustand-isolated-multiplier-store.md` - Zustand slice-per-concern with the rAF multiplier loop isolated to its own store over one shared store
- `.planning/adrs/ADR-027-oidc-spa-broadcastchannel-multi-tab-refresh.md` - multi-tab refresh via oidc-spa's built-in BroadcastChannel over hand-rolled coordination
- `.planning/adrs/README.md` - Phase 7 ADR index section + corrected future-ADRs numbering note
- `.planning/STATE.md` - Phase 7 complete, 7/10 progress, plans-landed narrative, next action, metrics, phase history row
- `.planning/ROADMAP.md` - Phase 7 checkbox + plans checked, plans-landed narrative, ADR labels reconciled, Progress row Complete
- `.planning/REQUIREMENTS.md` - footer recording the 07-09 closeout (all 15 Phase 7 REQ-IDs already Done)
- `frontend/src/lib/config.ts` - justified narrow eslint-disable on the env-parsed bet-cents type signature

## Decisions Made

- **ADR-024..027 are next-free, not the anticipated 019..022** — the existing ADRs run 001..023 (verified by re-listing the dir); the ROADMAP's anticipated "ADR-019..022" labels for Phase 7 were consumed by the shipped Phase 5 (019/020) and Phase 6 (021/022/023) ADRs. Shipped ADRs are never renumbered, so the Phase 7 decisions take 024..027 and the stale labels are reconciled with a note.
- **config.ts: narrow eslint-disable over rename** — `minCents`/`maxCents` ARE raw integer cents from env and are immediately wrapped in `Money.of(BigInt(...))` downstream, so no money value is ever a `number`. Renaming away the `Cents` suffix would obscure the honest semantics; weakening the rule globally is forbidden by CLAUDE.md. A single-line, commented `eslint-disable-next-line @crash/no-number-for-money` on the one offending type signature is the cleanest honest resolution. The flag was only on the `AppConfig.bet` type signature (line 30); the `buildConfig` object-literal properties are not type-annotated signatures so they never tripped the rule.
- **REQUIREMENTS.md needed no status flips** — all 15 Phase 7 REQ-IDs were already marked Done (checkboxes + traceability table + v1-complete 62/95) by the prior plans' executors as each closed its requirements. Task 2's REQUIREMENTS work reduced to verifying that state and updating the footer to record the closeout.

## Deviations from Plan

None - plan executed exactly as written. The plan's `<also_resolve>` directive (the config.ts money-rule fix) was completed as specified, choosing the narrow eslint-disable option with the required justification and noting the choice here. The plan anticipated possibly flipping REQUIREMENTS status fields; in practice those were already Done, so only the footer changed — this is the plan being satisfied, not a deviation.

## Issues Encountered

- **A `Read`-hook false positive** suggested a "bootstrap"/Vercel skill when reading the ADRs `README.md` (basename pattern match). Disregarded — this is a markdown ADR index in a Bun/NestJS/TanStack monorepo, not a Vercel/Next bootstrap; no skill applies to a documentation-only planning plan.
- **The remaining frontend lint warning** (`routeTree.gen.ts:1` unused eslint-disable directive) is the pre-existing generated-artifact item already logged in `deferred-items.md` — out of scope (generated file, not hand-edited), left untouched. `bun run lint` reports 0 errors.

## User Setup Required

None - documentation + a single-line lint annotation; no external service configuration. (For the eventual live smoke / `bun run dev`: copy `frontend/.env.example` → `frontend/.env`, `docker compose restart kong` for the 07-03 OPTIONS/CORS additions, Keycloak realm `crash-game` + user `player/player123` — unchanged from prior plans.)

## Next Phase Readiness

- Phase 7 is complete and traceable: four defensible ADRs at the senior depth the arguição expects, all 15 REQ-IDs delivered, planning docs rotated to 7/10.
- Ready for `/gsd:verify-phase 7` (goal-backward audit against the ROADMAP Phase 7 Success Criteria) and `/gsd:ui-review` (Phase 7 is UI-relevant), then `/gsd:plan-phase 8` (Provably-Fair UX, History & Replay — which reuses the Canvas 2D renderer locked in ADR-025).
- No blockers. The config.ts money-rule debt is cleared; the only open frontend lint item is the pre-existing generated-file warning in deferred-items.md.

## Self-Check: PASSED

- Created files verified present: ADR-024/025/026/027 + 07-09-SUMMARY.md (all FOUND)
- Commits verified in git history: `cc4894d` (Task 1 ADRs), `39d712e` (config.ts money-rule fix), `f8bfce1` (Task 2 doc rotation) — all FOUND
- Plan verification greps re-run: 4 ADRs present + 4 Status Accepted; README indexes all four; STATE `7/10`; ROADMAP ADR-024..027 + Phase 7 box `[x]`; Phase 8 REQ-FE-09/10 still `[ ]` Pending
- frontend `bun run lint` 0 errors; `bunx tsc --noEmit` exit 0; `bun run test` 65/65 green

---
*Phase: 07-frontend-vertical-slice*
*Completed: 2026-05-29*
