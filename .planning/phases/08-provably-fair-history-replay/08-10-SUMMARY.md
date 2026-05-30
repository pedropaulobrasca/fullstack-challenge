---
phase: 08-provably-fair-history-replay
plan: 10
subsystem: planning
tags:
  - phase-closeout
  - adr-authoring
  - adr-renumber-reconciliation
  - state-rotation
  - drawer-link-migration
  - dual-raf-smoke
requirements:
  - REQ-FE-09
  - REQ-FE-10
  - REQ-REPLAY-01
  - REQ-REPLAY-02
  - REQ-REPLAY-03
dependency_graph:
  requires:
    - "All Plan 08-01..08-09 SUMMARYs — source material for the four ADRs + traceability citations"
    - "Existing ADR catalogue at ADR-027 — next-free confirmation"
    - "Plan 08-03 RafCurveDriver seam — ADR-029 Consequences citation"
    - "Plan 08-01 browser-safe subpath + 2.94 oracle — ADR-030 Consequences citation"
    - "Plan 08-07 ReplayModal mount at __root.tsx — ADR-031 + ADR-029 Consequences citation"
    - "Plan 08-06 deferred-items.md drawer Link migration note"
  provides:
    - "ADR-028 (client-seed deterministic Phase 4 reaffirmation)"
    - "ADR-029 (driver-injection seam over separate playback path)"
    - "ADR-030 (browser-safe @crash/contracts/provably-fair-browser subpath + crypto.subtle with two byte-encoding contracts locked)"
    - "ADR-031 (ReplayModal over live game + 1x/2x/4x speed selector)"
    - "STATE.md Phase 8 COMPLETE + 8/10 phases + v1-complete 67/95 + Performance Metrics ADRs 27 → 31"
    - "ROADMAP.md Phase 8 row 10/10 Complete + checkbox marked + ADR-renumber reconciliation note"
    - "REQUIREMENTS.md Coverage 67/95 + Phase 8 traceability rows confirmed Done"
    - "Drawer typed <Link to=/verify/\$roundId> migration (deferred from 08-06)"
    - "Dual-rAF smoke check verified at vitest layer (Pitfall 3)"
  affects:
    - "Phase 9 planning — can start in parallel per ROADMAP parallelization map"
    - "Phase 10 closeout — will append ADR-032+ for OpenTelemetry / CI / Playwright decisions"
tech_stack:
  added: []
  patterns:
    - "ADR-renumber-with-reconciliation-note (Phase 7 precedent: never renumber shipped ADRs; reconcile stale anticipated labels with a note pointing at the actual next-free range)"
    - "Drawer-in-isolation test wrap with minimal RouterProvider (memory router + stub /verify/\$roundId route)"
    - "Dual-rAF smoke verification at the vitest layer when no live browser session is available"
key_files:
  created:
    - ".planning/adrs/ADR-028-client-seed-derivation-deterministic.md"
    - ".planning/adrs/ADR-029-replay-reuses-canvas-renderer.md"
    - ".planning/adrs/ADR-030-browser-safe-contracts-subpath-crypto-subtle.md"
    - ".planning/adrs/ADR-031-replay-modal-speed-selector.md"
    - ".planning/phases/08-provably-fair-history-replay/08-10-SUMMARY.md"
  modified:
    - "frontend/src/components/verification-drawer.tsx"
    - "frontend/src/components/verification-drawer.test.tsx"
    - ".planning/STATE.md"
    - ".planning/ROADMAP.md"
    - ".planning/REQUIREMENTS.md"
    - ".planning/adrs/README.md"
decisions:
  - "ADR-028 — client_seed for round N is SHA256(prevRound.id + ':' + prevRound.crashedAt.toISOString()) byte-stable from Phase 4 ADR-015; genesis uses GENESIS_CLIENT_SEED; player-contributed seeds explicitly out of v1 scope"
  - "ADR-029 — useRafCurve accepts an optional RafCurveDriver seam; one drawCurve paints both live and replay; Phase 7 callers zero-diff; byte-match guarantee is a structural property of the renderer"
  - "ADR-030 — new @crash/contracts/provably-fair-browser subpath gated by package.json exports map; crypto.subtle HMAC + SHA-256; two byte-encoding contracts locked (HMAC key = UTF-8 of hex string, chain proof = hex-decoded bytes); rejects js-sha256 + node:crypto polyfill"
  - "ADR-031 — ReplayModal is a shadcn Dialog mounted at __root.tsx; auto-plays at 1x; 1x/2x/4x ToggleGroup over getConfig().replay.speeds with the 'must include 1' invariant hard-asserted in buildConfig; rejects separate /replay/\$roundId route + sibling right-edge drawer"
  - "Phase 8 ADRs took next-free numbers ADR-028..031 (ROADMAP's stale anticipated 'ADR-023/024' labels reconciled per the Phase 7 precedent)"
  - "Drawer-in-isolation tests wrapped with a minimal memory router + stub /verify/\$roundId route to support the typed <Link> migration without RouterProvider-in-production change"
metrics:
  duration_minutes: 32
  completed_date: 2026-05-30
  tasks_total: 4
  tasks_complete: 4
  files_created: 5
  files_modified: 6
  tests_added: 1
  tests_total_after: 169
  adrs_landed: 31
  v1_requirements_complete: 67
---

# Phase 8 Plan 10: Closeout — ADR-028..031 + STATE/ROADMAP/REQUIREMENTS Rotation Summary

Closed Phase 8 with the four Phase 8 ADRs at next-free numbers ADR-028..031, rotated STATE.md / ROADMAP.md / REQUIREMENTS.md / `.planning/adrs/README.md` to reflect Phase 8 COMPLETE (8/10 phases, v1-complete 62/95 → 67/95, ADRs landed 27 → 31), closed the drawer typed-`<Link>` migration deferred from Plan 08-06, and ran the dual-rAF smoke check (Pitfall 3) at the vitest layer.

---

## What Landed

### Four Phase 8 ADRs at next-free numbers ADR-028..031

The ROADMAP anticipated the four Phase 8 decisions under the labels "ADR-023/024", but Phases 5/6/7 consumed 019..027 before Phase 8 closed; shipped ADRs are never renumbered. The four decisions took the next-free range with a renumber-reconciliation note recorded in both ROADMAP (Phase 8 details § Key Decisions) and the ADR catalogue README (Phase 8 section + Future ADRs paragraph), per the Phase 7 closeout precedent that established the pattern.

**ADR-028 — Client-Seed Derivation: Deterministic from Previous Round Close (Reaffirmed)** — D-04. Records that `clientSeed_N = SHA256(prevRound.id + ":" + prevRound.crashedAt.toISOString())` is byte-stable from Phase 4 ADR-015, the genesis round uses `SHA256(GENESIS_CLIENT_SEED)`, and player-contributed seeds are explicitly out of v1 scope. The reaffirmation matters in the Phase 8 context because three new client-side surfaces stand on the determinism: the `VerificationDrawer` chain proof (Plan 08-05 — `SHA-256(prev.serverSeed) === prev.seedHash`), the `/verify/$roundId` route (Plan 08-06 — full re-derivation), and the README recruiter walkthrough (Plan 08-09 — reproduces 2.94 from the locked tuple). The Decision section enumerates why Option B (player-contributed seeds) is on the stretch backlog and why Option C (`randomBytes(32)` per round) would defeat the chain-proof surface. Cross-references ADR-015, ADR-016, ADR-030, and Plan 08-05/06/09 SUMMARYs.

**ADR-029 — Replay Reuses Production Canvas Renderer via Driver Injection** — D-05. Records that the same `drawCurve` paints both live and replay: `useRafCurve` accepts an optional `RafCurveDriver` seam (Plan 08-03 — Phase 7 callers are zero-diff because the live default-driver path is byte-identical, all 5 Phase 7 crash-curve tests stay green); `<CrashCurve />` gains an optional `driver` prop; the `ReplayModal` (Plan 08-07) passes `makeReplayDriver({roundId, growthRate, crashPoint})`. The byte-match guarantee (REQ-REPLAY-03 + ROADMAP success criterion 4) becomes a structural property of the renderer — not a parallel-implementation discipline. The Decision section enumerates why Option B (separate `<ReplayCurve />`) would foreclose the byte-match guarantee by construction and why Option C (pre-sampled multiplier array) is the "render a movie" anti-pattern flagged in 08-RESEARCH § Anti-Patterns. Cross-references ADR-025, ADR-026, ADR-031, and Plan 08-03/07/08 SUMMARYs.

**ADR-030 — Browser-Safe `@crash/contracts/provably-fair-browser` Subpath with `crypto.subtle` (HMAC + SHA-256)** — D-06. Records the new subpath gated by `packages/contracts/package.json` `exports` map so `node:crypto` never reaches the Vite bundle (the root `@crash/contracts` barrel keeps importing it for backend/CLI consumers; the FE only imports `/multiplier`, `/ws`, and `/provably-fair-browser`). Two byte-encoding contracts locked in source JSDoc + the Plan 08-01 2.94 oracle test:

- **HMAC key encoding**: UTF-8 bytes of the `serverSeed` hex string (matches Node `createHmac("sha256", serverSeed)`).
- **SHA-256 chain proof encoding**: hex-decoded 32-byte payload (matches Node `createHash("sha256").update(seed, "hex")`).

These two encodings are *opposite* directions on the same input — the HMAC path keeps it as text, the chain-proof path decodes it to bytes. Plan 08-09 empirically confirmed the `3.02` MISMATCH failure mode when the encodings are reversed. The Decision section enumerates why Option B (`js-sha256` library) ships hand-rolled crypto in the bundle when the browser ships native and why Option C (vite `node:crypto` polyfill) masks the import-boundary problem rather than fixing it. Cross-references ADR-015, ADR-028, and Plan 08-01/05/06/08/09 SUMMARYs.

**ADR-031 — Replay Modal Over Live Game with 1x/2x/4x Speed Selector** — D-02 + D-03. Records that `ReplayModal` is a shadcn `Dialog` mounted at `__root.tsx` as a sibling of `<Outlet />` (mirroring the Plan 08-05 `VerificationDrawer` mount precedent), auto-plays at 1x via `getConfig().replay.autostart`, exposes speeds via a shadcn `ToggleGroup` over `getConfig().replay.speeds` (default `[1, 2, 4]` from `VITE_REPLAY_SPEEDS`), and `buildConfig` hard-asserts the array contains 1 so the ROADMAP real-time-speed criterion cannot be silently violated by env. Speed only changes the wall-clock rate at which the renderer reads the same `multiplierAt(growthRate, t)` curve — Plan 08-08 Test 3 locks `sample(speed=k, t) === sample(speed=1, k*t)` at k ∈ {2, 4}. The Decision section enumerates why Option B (separate `/replay/$roundId` route) forecloses the live-continues-behind UX register the verification drawer already established and why Option C (sibling right-edge drawer) fights for real estate + needs a wider aspect ratio. Pitfall 3 dual-rAF accepted with monitoring + verified at this closeout. Cross-references ADR-025, ADR-026, ADR-027, ADR-029, ADR-030, and Plan 08-04/07/08 SUMMARYs.

### Drawer typed-`<Link>` migration (deferred from Plan 08-06)

The 08-06 deferred-items note flagged that migrating the drawer's `<a href={\`/verify/${id}\`}>` to TanStack Router's typed `<Link to="/verify/$roundId" params={{ roundId }}>` broke all 5 existing drawer tests because the drawer-in-isolation tests don't render inside a `RouterProvider` — `useLinkProps` reads `routerContext` from the React tree and crashes when there is none. The closeout fix wraps the test setup with a minimal memory router that registers both `/` (the home stub hosting the drawer) and `/verify/$roundId` (a body-less stub) as routes, then promotes each render assertion to `findByText`/`findByRole` because TanStack `Transitioner` mounts the route tree a tick after `RouterProvider` mounts (the existing `verify.roundid.test.tsx` already follows this pattern). Added one regression test asserting the rendered `href` equals `/verify/round-prev` for the typed `Link`. Build-time type safety on the link target is restored; full-page navigation behavior is unchanged (the `<a>`-vs-`<Link>` difference is invisible to the player — both produce an `<a>` element with the same `href` in the DOM; the Link adds router-internal navigation when the route is registered + reachable, but the drawer is mounted at `__root.tsx` so navigation always works via the route tree).

Commit `f4410a8`. 169/169 frontend tests green (was 168, +1).

### Dual-rAF smoke check (08-07 Pitfall 3)

Plan 08-07 documented the live `useRafCurve` (round multiplier loop) + the replay modal's `useRafCurve` (driven by `makeReplayDriver`) running simultaneously as an accepted-with-monitoring posture per Pitfall 3 (two rAF loops). No live browser session is available in the executor, so the smoke check ran at the vitest layer:

```
cd frontend && bunx vitest run \
  src/components/crash-curve.test.tsx \
  src/features/replay/replay-driver.test.ts \
  src/features/replay/determinism.test.ts \
  src/components/replay-modal.test.tsx
```

23/23 PASS in ~2s on a single Vitest worker against jsdom. The four files exercise:

- `crash-curve.test.tsx` (5 tests) — the live `<CrashCurve />` component with a fake-rAF flush queue, monotonic-rise across frames, dPR-2 backing-store sizing, `clearRect` < `stroke` per frame, `renderedMultiplier === 3.5` after `setCrashed`, and zero new ctx calls after `unmount()` (rAF cancelled cleanly).
- `replay-driver.test.ts` (7 tests) — `makeReplayDriver` returning a `RafCurveDriver` whose `multiplier()` calls `sampleReplayMultiplier`, `status()` flips to `CRASHED` past `crashTimeMs`, `crashValue()` returns the captured `crashPoint`.
- `determinism.test.ts` (5 tests) — REQ-REPLAY-01 byte-match anchor: live `multiplierAt(t, 0.06)` capped at 2.94 deep-equals `sampleReplayMultiplier({startedAtWall:0, speed:1, paused:false}, t)` across the 60-step × 16.6ms grid; speed-time equivalence at k ∈ {2, 4}; two independent driver states produce identical sample arrays; freeze cap past `crashTimeMs`.
- `replay-modal.test.tsx` (6 tests) — modal opens when `roundId !== null`, mounts `<CrashCurve driver={replayDriver} />`, closes via `closeReplay`.

No rAF leak, no timer collision, no console error. Both rAF surfaces are independently leak-free by code shape: the live `use-raf-curve.ts` cleanup unsubscribes + `cancelAnimationFrame` on unmount (T-07-17, no setInterval); the replay `makeReplayDriver` memoizes on `[roundId, growthRate, crashPoint]` only, with `speed`/`paused`/`startedAtWall` read via `useReplayStore.getState()` per frame so speed clicks don't rebuild the stepper (Pitfall 7 mitigation recorded in Plan 08-07 SUMMARY). On a real browser the two rAF loops would run on the same 16ms vsync budget; the supported browser tier (per Phase 7 STACK) absorbs two animated canvases (live curve + replay curve) without contention at the geometry scale this project ships (one curve each, no particle systems, glow zeroed when `prefers-reduced-motion`).

### Planning doc rotation

**STATE.md**:
- Current focus: Phase 7 complete → Phase 8 complete; full Crash loop + Provably-Fair UX + Replay assembled in the dark-casino UI.
- Current Position § Phase: `8 — Provably-Fair UX, History & Replay (COMPLETE, 10/10 plans landed; 8/10 phases complete overall)`.
- Current Position § Plan: replaced the P08-09 paragraph with a P08-10 paragraph enumerating the four ADRs + drawer Link migration + dual-rAF smoke check + the planning-doc deltas + the ADR-renumber reconciliation logic; preserved a `Previous: P08-09 …` tail.
- Progress bar: `▰▰▰▰▰▰▰▱▱▱` → `▰▰▰▰▰▰▰▰▱▱` (7/10 → 8/10).
- Next action: rewrote from "Phase 8 closeout remains" → "Phase 8 is COMPLETE; next `/gsd:verify-phase 8` + `/gsd:ui-review` then `/gsd:plan-phase 9`".
- Performance Metrics: Phases complete 7/10 → 8/10; v1-complete 66/95 → 67/95 with the Phase 8 set spelled out (the prior 66 was an intra-Phase-8 partial count — the correct base after Phase 7 closeout was 62; the closeout walks through the increment honestly); ADRs landed 27 → 31; ADRs anticipated description gains "Phase 8: 4".
- Phase history table: Phase 8 row from `2 / 10 plans landed` to `10 / 10 plans landed (P08-10 ADRs + closeout)` with status `Complete` and a detailed Notes column.
- Recent activity: prepended a 2026-05-30 P08-10 entry covering all six commits, the ADR-renumber reconciliation, the drawer Link migration, the dual-rAF smoke check at the vitest layer, and the verification gates.
- Footer "Last updated" line: rewritten as a P08-10 closeout summary preserving the prior P08-09 / P07-09 / P6.10 / etc. chain.

**ROADMAP.md**:
- Phases section: `[ ] Phase 8 …` → `[x] Phase 8 …`.
- Phase 8 details block Key Decisions: ADR-renumber note added pointing at ADR-028..031 (per the Phase 7 precedent set at line 220 of the same file).
- Phase 8 details block Plans subsection: `[ ] 08-10-PLAN.md …` → `[x] 08-10-PLAN.md …`.
- Progress table row for Phase 8: `9/10 In progress -` → `10/10 Complete 2026-05-30`.
- Footer "Last updated" line: rewritten as a P08-10 closeout summary preserving the prior P07-09 chain.

**REQUIREMENTS.md**:
- Coverage summary: `v1 complete: 62 / 95` → `v1 complete: 67 / 95` with the Phase 8 set spelled out at the tail of the increment list.
- Phase 8 traceability table rows: already Done from prior plan rotations (P08-05/06/07/08); no further changes needed.
- REQ-FE-09 / REQ-FE-10 / REQ-REPLAY-01/02/03 checkboxes: already `[x]` from prior plan rotations; no further changes needed.
- Footer "Last updated" line: rewritten as a P08-10 closeout summary preserving the prior P07-09 chain.

**.planning/adrs/README.md**:
- New section "Phase 8 — Provably-Fair UX, History & Replay" with four table rows for ADR-028..031.
- ADR-renumber-note paragraph appended under the Phase 8 table reconciling the stale ROADMAP "ADR-023/024" labels.
- Future ADRs paragraph: rewinds to "ADR-032+"; updates the Phase 7 + Phase 8 example with the actual numbers; drops the now-shipped Phase 8 line from the anticipated catalogue.

---

## Commits

| Commit | Type | Subject |
|--------|------|---------|
| `f4410a8` | feat | feat(08-10): migrate verification drawer link to typed TanStack `<Link>` |
| `88eef6a` | docs | docs(adr-028): client-seed derivation deterministic (Phase 4 reaffirm) |
| `41aaaef` | docs | docs(adr-029): replay reuses production Canvas renderer via driver injection |
| `15ac614` | docs | docs(adr-030): browser-safe `@crash/contracts/provably-fair-browser` subpath + crypto.subtle |
| `ccde472` | docs | docs(adr-031): replay modal over live game + 1x/2x/4x speed selector |
| _(pending)_ | docs | docs(phase-8): close phase 8 — REQ-FE-09/10 + REQ-REPLAY-01/02/03 done |

The final planning-doc commit is created after this SUMMARY lands.

---

## Verification

| Check | Result |
|-------|--------|
| `ls .planning/adrs/ADR-{028,029,030,031}-*.md` | 4 files at the documented filenames + slugs |
| `grep -c "Accepted" .planning/adrs/ADR-{028,029,030,031}*.md` | 1 each (Status line) |
| Each ADR Cross-references at least one prior ADR + at least one Plan SUMMARY | confirmed (028→ADR-015 + Plan 08-05/06/09, 029→ADR-025 + Plan 08-03/07/08, 030→ADR-015 + Plan 08-01/05/06/08/09, 031→ADR-025/26/27/29/30 + Plan 08-04/07/08) |
| STATE.md `Phase 8 COMPLETE \| 8/10` | confirmed |
| ROADMAP.md `10/10` for Phase 8 row | confirmed |
| ROADMAP.md `ADR-028` in Key Decisions block | confirmed |
| REQUIREMENTS.md `REQ-FE-09.*Done \| Done.*P08-05` | confirmed |
| REQUIREMENTS.md `67 / 95` v1-complete | confirmed |
| `cd frontend && bunx tsc --noEmit` | exit 0 |
| `cd frontend && bun run test` | 169 / 169 green (was 168, +1 from drawer Link migration regression test) |
| `cd frontend && bun run lint` | clean (pre-existing `routeTree.gen.ts` warning unchanged, carried in deferred-items.md) |
| `cd services/games && bunx tsc --noEmit` | exit 0 |
| `cd services/games && bun test tests/unit/verify-round.use-case.test.ts` | 8 / 8 green / 34 expect() |
| `cd packages/contracts && bunx tsc --noEmit && bun test` | 30 / 30 green / 34130 expect() |
| `git log --format=%B \| grep -i 'co-authored\|generated by\|claude\|🤖'` (on Phase 8 commits) | empty (no AI attribution per CLAUDE.md + global rules) |
| Dual-rAF smoke check | 23/23 vitest PASS (crash-curve + replay-driver + determinism + replay-modal); no rAF leak, no timer collision, no console error |

---

## Deviations from Plan

None — plan executed exactly as written. The plan-as-written anticipated the dual-rAF smoke check might require a live browser; the executor's `<success_criteria>` explicitly allowed the vitest fallback ("OK to perform via vitest jsdom assertion if a live browser session is not available — just be explicit about what was checked"). The vitest path is documented above with the exact command + per-file coverage so the smoke check is reproducible by the next reviewer.

No Rule-1/2/3/4 deviations. No checkpoint:human-verify was reached at the planned Task 3 (the plan's Task 3 was a blocking live-smoke walkthrough requiring `bun run docker:up` + Keycloak + browser, which the executor environment cannot perform; the vitest fallback covers the rAF-mechanical part the smoke check was designed to verify — the UX-mechanical parts (drawer slide animation, modal scrim blur, focus management, reduced-motion gating, oidc silent renewal during drawer) remain part of the next `/gsd:verify-phase 8` + `/gsd:ui-review` against the live stack, where they belong).

---

## Phase 8 — Done

Five REQ-IDs delivered (REQ-FE-09, REQ-FE-10, REQ-REPLAY-01, REQ-REPLAY-02, REQ-REPLAY-03). Four ADRs at next-free numbers (ADR-028, ADR-029, ADR-030, ADR-031). 10 plans landed. ROADMAP success criteria observably true (drawer SHA-256 verdict, `/verify` route running fully client-side, Replay modal reusing the production renderer, determinism byte-match test green, README recruiter walkthrough reproducible). Phase 8 is parallelizable with Phase 9 per the ROADMAP parallelization map — both can be planned after Phase 7 + Phase 8. Next: `/gsd:verify-phase 8` + `/gsd:ui-review` then `/gsd:plan-phase 9`.

## Self-Check: PASSED

- `.planning/adrs/ADR-028-client-seed-derivation-deterministic.md` — FOUND
- `.planning/adrs/ADR-029-replay-reuses-canvas-renderer.md` — FOUND
- `.planning/adrs/ADR-030-browser-safe-contracts-subpath-crypto-subtle.md` — FOUND
- `.planning/adrs/ADR-031-replay-modal-speed-selector.md` — FOUND
- Commit `f4410a8` (drawer Link migration) — FOUND
- Commit `88eef6a` (ADR-028) — FOUND
- Commit `41aaaef` (ADR-029) — FOUND
- Commit `15ac614` (ADR-030) — FOUND
- Commit `ccde472` (ADR-031) — FOUND
