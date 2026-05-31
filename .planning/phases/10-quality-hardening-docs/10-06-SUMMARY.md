---
phase: 10-quality-hardening-docs
plan: 06
subsystem: frontend-polish + ws-contracts
tags: [polish-defects, shadcn, radix, tailwind-v4, zod, ws-reconnect]
requires: [10-01, 10-02]
provides:
  - "Sheet (Fairness drawer) + Dialog (Replay modal) animate into view via tw-animate-css registered in globals.css"
  - "roundSnapshotPayloadSchema accepts null (WS reconnect between rounds) via roundSnapshotObjectSchema.nullable()"
  - "FE round:snapshot dispatcher silently no-ops on null payload (waits for next round:started)"
affects: [frontend, packages/contracts]
tech_stack_added: []
tech_stack_patterns:
  - "Tailwind v4 CSS-plugin registration via @import (not @plugin) for asset-style plugins"
  - "zod schema split: object alias + nullable wrapper export — preserves strict validation for tests, relaxed for runtime"
key_files_created:
  - frontend/src/styles/globals.css.test.ts
  - packages/contracts/tests/ws/round-snapshot-nullable.test.ts
key_files_modified:
  - frontend/src/styles/globals.css
  - packages/contracts/src/ws/ws-event.payloads.ts
  - frontend/src/stores/ws-dispatch.ts
  - frontend/src/stores/ws-dispatch.test.ts
  - .planning/phases/10-quality-hardening-docs/deferred-items.md
decisions:
  - "Use @import \"tw-animate-css\" (not @plugin) — the package ships a CSS file under exports.\".\".style, not a JS plugin factory"
  - "Split roundSnapshotPayloadSchema into roundSnapshotObjectSchema + nullable wrapper rather than wrapping inline so test callers that want strict-object validation retain the precise alias"
  - "D-03c (HistoryStrip key warn) verified at source level only — no live click-through possible due to pre-existing node:crypto FE bundle crash; key={entry.roundId} is correct by construction because useHistoryStore dedups roundId (existing ws-dispatch.test.ts proves)"
metrics:
  duration_minutes: 10
  completed_at: "2026-05-31T16:07Z"
  tasks_completed: 3
  files_changed: 5
  files_created: 2
  commits: 4
requirements: [REQ-OBS-04]
---

# Phase 10 Plan 06: Polish defects (D-03a Sheet/Dialog + D-03b WS snapshot nullable + D-03c HistoryStrip key)

Close the 3 polish defects surfaced by the Phase 8 live smoke. D-03a + D-03b need code changes; D-03c verified resolved at source-level (no fix needed). Tests + commits per the plan; visual click-through deferred due to pre-existing FE bundle error unrelated to the polish work.

## What landed

### D-03a — Sheet/Dialog visibility (commit `d9da6e9`)

Per `d03a-diagnosis.md` (Plan 10-01 Task 2) the root cause was confirmed hypothesis (a): `tw-animate-css` package was installed but never registered with Tailwind v4. The shadcn Sheet + Dialog use `data-[state=open]:animate-in`, `data-[state=open]:slide-in-from-right`, `data-[state=open]:fade-in-0`, `data-[state=open]:zoom-in-95` utilities — all silently dropped by Tailwind v4 when the plugin source is unknown, so `data-state` toggled but no transform/opacity animation ran.

**Applied fix:** add `@import "tw-animate-css";` immediately after `@import "tailwindcss";` in `frontend/src/styles/globals.css`. Used `@import` (not `@plugin` as the diagnosis recommended verbatim) because `tw-animate-css@1.4.0`'s `package.json` only exposes `exports.".".style → ./dist/tw-animate.css` — there is no JS plugin entry, so `@plugin "tw-animate-css"` errors with `"." is not exported under the conditions ["module"…]`. The `@import` form is the Tailwind v4 idiom for CSS-asset plugins per Tailwind v4 docs (Asset Plugins section).

**Verification:**
- Build-artifact check: the CSS served by Vite dev (`http://localhost:3000/src/styles/globals.css`) now contains `animate-in`, `slide-in-from-right`, `fade-in-0`, `zoom-in-95` utility selectors and the `--tw-enter-translate-x`, `--tw-enter-opacity`, `--tw-enter-scale` CSS variables emitted by `tw-animate-css`.
- Regression guard: `frontend/src/styles/globals.css.test.ts` asserts `@import "tw-animate-css"` is present and ordered after `@import "tailwindcss"`. Vitest green.
- Live click-through screenshot: **deferred** — a pre-existing FE runtime error (`node:crypto` externalized by Vite, thrown when the fairness/replay code path runs) blocks React from mounting the full game shell in a fresh Playwright context. The badge renders but the rest of the tree is empty so neither the Sheet nor the Dialog can be triggered click-through. Logged to `.planning/phases/10-quality-hardening-docs/deferred-items.md` as out-of-scope for the polish-defect plan; should be addressed in plan 10-07 (Playwright E2E) or a follow-up bundle hygiene fix. The CSS fix itself is conclusively verified at the build layer.

### D-03b — `round:snapshot=null` zod warn (commits `466c35b` RED + `f540e36` GREEN)

WS reconnect between rounds delivers `round:snapshot=null` to indicate "no active round" — the prior strict zod object rejected this and surfaced "Expected object, received null" in the console.

**Applied fix:**
- `packages/contracts/src/ws/ws-event.payloads.ts`: split the strict object into `roundSnapshotObjectSchema` (unchanged shape, exported for strict-validation callers) + `roundSnapshotPayloadSchema = roundSnapshotObjectSchema.nullable()`. New types: `RoundSnapshotObject` (strict object) and `RoundSnapshotPayload = RoundSnapshotObject | null`.
- `frontend/src/stores/ws-dispatch.ts` `round:snapshot` handler short-circuits with `if (payload === null) return;` immediately after `parse` and before any store mutation. Preserves the "wait for next round:started" behavior per RESEARCH Pitfall 9.

**Tests:**
- `packages/contracts/tests/ws/round-snapshot-nullable.test.ts` (NEW): 5 cases — null accepted, valid object accepted, malformed rejected, garbage rejected, strict alias rejects null.
- `frontend/src/stores/ws-dispatch.test.ts` extended with 1 case asserting null payload triggers no throw, no warn, no store mutation.

All 49 contracts tests + 247 FE tests green; tsc + lint clean.

### D-03c — HistoryStrip key warn (commit `65562b8`, verification-only)

Source-level evidence proves no fix is needed:
- `frontend/src/components/history-strip.tsx` line 52 uses `key={entry.roundId}` — valid React idiom.
- `useHistoryStore` dedups by `roundId` (covered by the existing `ws-dispatch.test.ts` "does not duplicate a history entry when a non-head round re-crashes (stable keys)" test at lines 93-109).
- No nested `.map` without explicit keys in the file.

By construction no duplicate-key warning is possible. Live click-through smoke deferred together with D-03a's visual evidence due to the same pre-existing `node:crypto` bundle error; this does not affect the static-source verdict per RESEARCH Assumption A3.

## Deviations from Plan

### [Rule 1 — Bug] `@plugin "tw-animate-css"` would fail to resolve at build time

- **Found during:** Task 1 — first HMR attempt after writing `@plugin "tw-animate-css";` per the diagnosis's verbatim recommendation.
- **Issue:** Vite dev server returned 500 with `"." is not exported under the conditions ["module", "browser", "development", "import"]` because `tw-animate-css@1.4.0` exposes only `exports.".".style → ./dist/tw-animate.css` (it ships a CSS file, not a JS plugin module). The diagnosis's recommendation was Tailwind-v4-spec but library-incorrect for this package.
- **Fix:** changed to `@import "tw-animate-css";` (Tailwind v4's asset-plugin syntax) which respects the `style` condition of the exports map.
- **Files modified:** `frontend/src/styles/globals.css`
- **Commit:** `d9da6e9`

### [Plan-spec gate misread] `.nullable()` count in `ws-event.payloads.ts` is 8, not 1

- **Found during:** Task 2 GREEN verification step.
- **Issue:** The plan's automated gate `grep -c ".nullable()" packages/contracts/src/ws/ws-event.payloads.ts | grep -qE '^[1]$'` expects exactly 1 occurrence. The file already had 7 pre-existing `.nullable()` uses on individual fields inside `roundShapeSchema` (lines 21-25) and `myBetEntrySchema` (line 42); the relax adds the 8th at the top-level wrapper.
- **Interpretation:** the gate's intent — "did the relax leak to another payload schema?" — is satisfied. No other top-level payload schema (`roundStartedPayloadSchema`, `roundCrashedPayloadSchema`, etc.) was relaxed. The numerical gate is a plan-spec oversight, not a fix problem.
- **No code change** — documented here so the verifier knows why the literal gate text doesn't pass.

### [Deferred — scope boundary] Live click-through visual evidence for D-03a/D-03c

- **Found during:** Task 1 — Playwright run for screenshot capture.
- **Issue:** A fresh Playwright context navigates through OIDC successfully but the React tree never fully mounts. Browser console: `Module "node:crypto" has been externalized for browser compatibility. Cannot access "node:crypto.createHash" in client code.` Page renders only the header (logo + Fairness badge + Reconnecting pill); main content area is empty so the Fairness badge click toggles `useFairnessStore.drawerOpen` but the Sheet portal can't paint because the rest of the React subtree never reached a mountable state.
- **Why it's out of scope:** Pre-existing Phase 8 bundle hygiene issue (some module is `import`ing `node:crypto` directly instead of routing through the `provably-fair-browser` entry of `@crash/contracts`). Not introduced by this plan; per the executor's SCOPE BOUNDARY rule auto-fixing is bounded to changes the current plan caused.
- **Logged to:** `.planning/phases/10-quality-hardening-docs/deferred-items.md` for plan 10-07 (Playwright E2E) or a follow-up bundle-hygiene fix plan.

## Threat Flags

None — D-03b's `.nullable()` is purely additive on the inbound-validation side and the regression test asserts malformed payloads (`status: "NOT_A_STATUS"`, raw numbers, strings, arrays) are still rejected. D-03a is CSS-only. D-03c is verification-only.

## Known Stubs

None.

## Self-Check: PASSED

Files verified to exist on disk:
- `frontend/src/styles/globals.css` (modified)
- `frontend/src/styles/globals.css.test.ts` (created)
- `packages/contracts/src/ws/ws-event.payloads.ts` (modified)
- `packages/contracts/tests/ws/round-snapshot-nullable.test.ts` (created)
- `frontend/src/stores/ws-dispatch.ts` (modified)
- `frontend/src/stores/ws-dispatch.test.ts` (modified)
- `.planning/phases/10-quality-hardening-docs/deferred-items.md` (modified)

Commits verified in `git log --oneline`:
- `d9da6e9` fix(10-06): D-03a Sheet/Dialog visibility per d03a-diagnosis.md
- `466c35b` test(10-06): D-03b add failing tests for null round:snapshot handling
- `f540e36` fix(10-06): D-03b relax roundSnapshotPayloadSchema to nullable + dispatcher no-op
- `65562b8` chore(10-06): D-03c verified resolved — HistoryStrip key prop already correct

Tests + types green:
- `bun --cwd packages/contracts test` → 49 pass / 0 fail (34163 expect() calls)
- `bun --cwd frontend test` → 37 files, 247 pass / 0 fail (previously 246)
- `bun --cwd frontend run typecheck` → clean (`tsc --noEmit` exit 0)
- `bun --cwd packages/contracts run typecheck` (via `bunx tsc --noEmit`) → clean
- `bun --cwd frontend run lint` → only the pre-existing autogenerated `routeTree.gen.ts` warning, no new errors
