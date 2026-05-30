---
phase: 08-provably-fair-history-replay
plan: 04
subsystem: frontend-foundation
tags: [env, config, shadcn, zustand, fairness, replay]
requires:
  - frontend Phase 7 config layer (src/lib/config.ts zod schema + getConfig)
  - frontend Phase 7 shadcn surface (dialog already present, radix-ui umbrella)
  - frontend Phase 7 Vitest harness (jsdom + canvas stub)
provides:
  - getConfig().replay.{speeds, autostart}
  - getConfig().drawer.slideMs
  - getConfig().fairness.instantCrashBucket
  - useFairnessStore (verdicts cache + transient MATCH checkmark + drawerOpen)
  - useReplayStore (roundId + playing + speed, config-agnostic)
  - shadcn Sheet / ToggleGroup / Toggle / Alert primitives
affects:
  - Plan 08-05 (FairnessBadge + VerificationDrawer consume drawerOpen + Sheet)
  - Plan 08-06 (/verify/:roundId route consumes fairness.instantCrashBucket)
  - Plan 08-07 (ReplayModal consumes replay.speeds + replay.autostart + replay.store + ToggleGroup)
tech-stack:
  added: []
  patterns:
    - "zod transform + pipe for csv env vars: split + trim + Number + pipe(z.array(...).nonempty())"
    - "buildConfig-asserted invariants (speeds must include 1) over schema-level (preserves a clear error message at the boundary)"
    - "Zustand selector functions exported alongside the hook so consumers under fake timers control the clock"
key-files:
  created:
    - frontend/src/features/fairness/fairness.store.ts
    - frontend/src/features/fairness/fairness.store.test.ts
    - frontend/src/features/replay/replay.store.ts
    - frontend/src/features/replay/replay.store.test.ts
    - frontend/src/components/ui/sheet.tsx
    - frontend/src/components/ui/toggle-group.tsx
    - frontend/src/components/ui/toggle.tsx
    - frontend/src/components/ui/alert.tsx
    - .planning/phases/08-provably-fair-history-replay/08-04-SUMMARY.md
  modified:
    - frontend/.env.example
    - frontend/src/lib/config.ts
    - frontend/src/lib/config.test.ts
decisions:
  - "VITE_REPLAY_AUTOSTART parses via z.string().default('true').transform((s) => s === 'true').pipe(z.boolean()) instead of z.coerce.boolean(). z.coerce.boolean treats ANY non-empty string as true (including the literal 'false'), which would silently flip the autostart contract. The strict 'true'-only transform matches the env contract the rest of the Phase 7 config follows."
  - "The 'speeds must include 1' invariant lives in buildConfig (after zod parse) rather than as a zod refine. Reason: it produces a human-readable error message at the boundary that calls out D-03 / UI-SPEC explicitly, instead of a generic ZodError stack."
  - "Both stores live under frontend/src/features/<feature>/ (not src/stores/) because they are feature-scoped: only fairness/replay components consume them, never the live game loop. This matches the RESEARCH Recommended Project Structure for feature-coupled state."
  - "drawerOpen + openDrawer/closeDrawer are in the INITIAL fairness.store design (this plan), not retroactively added in 08-05. Surfaces FairnessBadge + VerificationDrawer in 08-05 only CONSUME — no edits to fairness.store.ts in 08-05."
  - "replay.store is config-agnostic by contract: openReplay accepts (roundId, autostart, defaultSpeed) as parameters so consumers thread getConfig().replay.* in at the call-site. Keeps the store test-clean (no vi.mock('@/lib/config') boilerplate)."
metrics:
  duration: ~25 minutes
  completed: 2026-05-29
  tasks: 3
  commits: 3
  tests_added: 23 (9 config + 7 fairness + 7 replay)
  files_changed: 11
---

# Phase 8 Plan 04: Wave-1 Foundation Closeout (env + shadcn + Zustand stores) Summary

Surfaces the four UI-SPEC env vars (`VITE_REPLAY_SPEEDS`, `VITE_REPLAY_AUTOSTART`, `VITE_DRAWER_SLIDE_MS`, `VITE_INSTANT_CRASH_BUCKET`) through the typed `getConfig()` layer, installs the three remaining shadcn primitives (`sheet`, `toggle-group`, `alert`), and lands the two Zustand slices (`fairness.store`, `replay.store`) that 08-05 / 08-06 / 08-07 consume.

## What landed

### Task 1: env + config (commit `a28495b`)

- `frontend/.env.example` appended a "Replay & Verification UX" block with the four new keys + a one-line `#` comment each (defaults `1,2,4` / `true` / `220` / `101`).
- `frontend/src/lib/config.ts` schema gained:
  - `VITE_REPLAY_SPEEDS` — csv split + trim + `Number` + pipe to `z.array(z.number().positive().finite()).nonempty()`. Default `"1,2,4"`.
  - `VITE_REPLAY_AUTOSTART` — strict `"true"`-only transform (NOT `z.coerce.boolean` — see Decisions). Default `"true"`.
  - `VITE_DRAWER_SLIDE_MS` — `z.coerce.number().int().positive().default(220)`.
  - `VITE_INSTANT_CRASH_BUCKET` — `z.coerce.number().int().positive().default(101)`.
- `AppConfig` extended with three Readonly sections: `replay: { speeds: readonly number[]; autostart: boolean }`, `drawer: { slideMs: number }`, `fairness: { instantCrashBucket: number }`.
- `buildConfig` asserts `env.VITE_REPLAY_SPEEDS.includes(1)` and throws with the message `VITE_REPLAY_SPEEDS must include 1 (default 1x speed per D-03 / UI-SPEC)` — this is the T-08-12 mitigation.
- `Object.freeze([...env.VITE_REPLAY_SPEEDS])` makes the speeds array immutable so consumers can't mutate the shared config.

**Tests:** 9 new test cases in `config.test.ts` (16 total, up from 7):
1. `VITE_REPLAY_SPEEDS` parses to `[1, 2, 4]`.
2. `VITE_REPLAY_AUTOSTART` parses to `true`.
3. `VITE_DRAWER_SLIDE_MS` parses to `220`.
4. `VITE_INSTANT_CRASH_BUCKET` default `101`.
5. `VITE_INSTANT_CRASH_BUCKET` override `"77"` → `77`.
6. Malformed `VITE_REPLAY_SPEEDS="1,abc,4"` throws.
7. Missing-1 `VITE_REPLAY_SPEEDS="2,4"` throws with `/must include 1/i`.
8. All four env vars absent → defaults apply.
9. `cfg.replay`, `cfg.replay.speeds`, `cfg.drawer`, `cfg.fairness` are all `Object.isFrozen === true`.

### Task 2: shadcn primitives (commit `44de9e8`)

`bunx shadcn@latest add sheet toggle-group alert --yes` from the official shadcn-ui registry (T-08-13 / T-07-SC honored — no third-party registry block).

Files landed:
- `frontend/src/components/ui/sheet.tsx` — `Sheet`, `SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetClose`.
- `frontend/src/components/ui/toggle-group.tsx` — `ToggleGroup`, `ToggleGroupItem`.
- `frontend/src/components/ui/toggle.tsx` — `Toggle`, `toggleVariants` (transitive of toggle-group in shadcn v4 — the plan only listed three but four is the correct surface; logged here for traceability).
- `frontend/src/components/ui/alert.tsx` — `Alert`, `AlertTitle`, `AlertDescription`.

All four import from the umbrella `radix-ui` package (already in `package.json` deps from Phase 7), so **`package.json` was untouched** by this install — the plan expected `@radix-ui/react-toggle-group` to land as a transitive, but the actual Phase 7 setup uses `radix-ui` namespace imports. No new deps required. `bun.lock` also unchanged.

Theme-token verification:
- `grep -RIn '#[0-9a-fA-F]{3,6}'` on the four files → **no hits** (only theme tokens like `bg-popover`, `bg-card`, `border-border`, `text-foreground`).

### Task 3: Zustand stores (commit `1a9afa4`)

**`frontend/src/features/fairness/fairness.store.ts`** — `useFairnessStore` exporting:
- State: `verdicts: Map<string, 'MATCH' | 'MISMATCH'>`, `recentlyVerifiedRoundId: string | null`, `recentlyVerifiedExpiresAt: number | null`, `drawerOpen: boolean`.
- Actions: `recordVerdict(roundId, verdict)` (MATCH arms transient with `Date.now() + 4000` TTL; MISMATCH only writes the map), `clearRecentlyVerified()`, `openDrawer()`, `closeDrawer()`.
- Pure selectors: `selectVerdict(state, roundId)`, `selectRecentlyVerified(state, roundId, now=Date.now())`.
- Exported `initialFairnessState` so tests can reset deterministically.

**`frontend/src/features/replay/replay.store.ts`** — `useReplayStore` exporting:
- State: `roundId: string | null`, `playing: boolean`, `speed: number` (initial `{ null, false, 1 }`).
- Actions: `openReplay(roundId, autostart, defaultSpeed)`, `closeReplay()`, `setPlaying(b)`, `setSpeed(n)`.
- Pure selector: `selectIsReplayOpen(state)` returns `state.roundId !== null`.
- Exported `initialReplayState`.

**Tests:** 14 new (7 fairness + 7 replay) — full suite stays green at 99/99 (85 prior + 14 new).

## Verification

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run test` (full FE suite) | 99/99 pass across 15 files |
| `bunx vitest run src/lib/config.test.ts` | 16/16 pass (7 prior + 9 new) |
| `bunx vitest run src/features/fairness/...test.ts src/features/replay/...test.ts` | 14/14 pass |
| Grep audit: no hardcoded `220` outside config | clean |
| Grep audit: no hardcoded `[1,2,4]` literal outside config | clean |
| Grep audit: no hex literals in new shadcn primitives | clean |
| All four `.env.example` keys present | clean |

## Deviations from Plan

**1. [Rule 3 - Blocking] z.coerce.boolean does not give us strict "true"-only semantics**

- **Found during:** Task 1 schema design
- **Issue:** The plan's action body suggested `z.coerce.boolean().default(true)` for `VITE_REPLAY_AUTOSTART` but flagged the semantic risk inline ("z.coerce.boolean treats any truthy string as true — confirm semantics for 'true'/'false' env values"). Confirmed problematic: `Boolean("false") === true`, so `VITE_REPLAY_AUTOSTART=false` in `.env` would silently flip to `true`.
- **Fix:** Used the plan's documented fallback — `z.string().optional().default("true").transform((s) => s === "true").pipe(z.boolean())`. This is the strict-equality contract every Phase 7 boolean env follows.
- **Files modified:** `frontend/src/lib/config.ts`.
- **Commit:** `a28495b`.

**2. [Path-of-record correction, not a deviation] shadcn add installed `toggle.tsx` as well**

- **Observed:** Plan acceptance criteria listed three files (`sheet.tsx`, `toggle-group.tsx`, `alert.tsx`). The shadcn v4 CLI also installs `toggle.tsx` as a required dependency of `toggle-group` (toggle-group composes individual Toggle items).
- **Action:** Accepted and committed all four. No rule-deviation — the plan's expectation was incomplete on the dep graph, not contradictory.
- **Files modified:** `frontend/src/components/ui/toggle.tsx` added.
- **Commit:** `44de9e8`.

**3. [Path-of-record correction, not a deviation] No new radix dep landed**

- **Observed:** The plan expected `@radix-ui/react-toggle-group@^1.1.11` to appear in `package.json`. Phase 7 already migrated to the umbrella `radix-ui` namespace package, so the new components import via `import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"` — no per-primitive dep needed. `package.json` and `bun.lock` were untouched by the install.
- **Action:** No corrective action needed. Documented here for traceability so a future audit doesn't flag the missing `@radix-ui/react-toggle-group` entry as a regression.

No Rule-1, Rule-2, or Rule-4 deviations.

## Unblocks

- **Plan 08-05** can land `FairnessBadge` + `HashBlock` + `VerdictChip` + `VerificationDrawer` (using `Sheet` for the drawer, `Alert` for the MISMATCH banner, `useFairnessStore.openDrawer`/`closeDrawer` for shared open-state) without touching `fairness.store.ts` again.
- **Plan 08-06** `/verify/:roundId` route can pull `getConfig().fairness.instantCrashBucket` so `deriveCrashPointAsync` runs with the correct bucket.
- **Plan 08-07** `ReplayModal` can mount the `ToggleGroup` over `getConfig().replay.speeds`, default to `getConfig().replay.autostart`, and drive `useReplayStore` directly — wire the existing `useRafCurve` driver seam (08-03) with a deterministic stepper.

## Self-Check: PASSED

- frontend/.env.example contains the four new keys: FOUND
- frontend/src/lib/config.ts declares replay/drawer/fairness Readonly: FOUND
- frontend/src/components/ui/sheet.tsx: FOUND
- frontend/src/components/ui/toggle-group.tsx: FOUND
- frontend/src/components/ui/toggle.tsx: FOUND
- frontend/src/components/ui/alert.tsx: FOUND
- frontend/src/features/fairness/fairness.store.ts: FOUND
- frontend/src/features/fairness/fairness.store.test.ts: FOUND
- frontend/src/features/replay/replay.store.ts: FOUND
- frontend/src/features/replay/replay.store.test.ts: FOUND
- Commit a28495b: FOUND
- Commit 44de9e8: FOUND
- Commit 1a9afa4: FOUND
