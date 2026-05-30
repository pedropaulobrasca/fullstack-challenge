---
phase: 08-provably-fair-history-replay
plan: 07
subsystem: frontend
tags:
  - replay-modal
  - replay-driver
  - history-chip
  - renderer-reuse
  - crash-curve-driver
requirements:
  - REQ-REPLAY-01
  - REQ-REPLAY-02
  - REQ-REPLAY-03
dependency_graph:
  requires:
    - "Plan 08-02 verify endpoint extended with bets[] + growthRate"
    - "Plan 08-03 useRafCurve RafCurveDriver seam (multiplier/status/crashValue/shouldStop)"
    - "Plan 08-04 useReplayStore + getConfig().replay.{speeds,autostart}"
    - "Plan 08-05 __root.tsx VerificationDrawer mount precedent"
    - "Phase 7 CrashCurve component + Money VO + shadcn Dialog/Alert/Skeleton"
  provides:
    - "ReplayModal component mounted at __root.tsx — shadcn Dialog hosting <CrashCurve /> driven by a deterministic stepper"
    - "makeReplayDriver factory + sampleReplayMultiplier pure function — deterministic time-stepper that returns a RafCurveDriver"
    - "useRoundDetail TanStack Query hook — reads GET /games/rounds/:id/verify with typed not-settled/not-found/network errors"
    - "ReplaySpeedToggle wrapping shadcn ToggleGroup over getConfig().replay.speeds"
    - "ReplayOverlays — bet list panel rendering RoundBetView rows with Money + masked playerId"
    - "HistoryStrip chip openReplay wiring + lucide History icon + tooltip Replay copy"
  affects:
    - "Plan 08-08 (determinism E2E hammers makeReplayDriver against the server's multiplierAt — the speed↔time equivalence test in this plan is the unit anchor)"
    - "Plan 08-09 (recruiter-example README can reference ReplayModal as the visible REQ-REPLAY-02 surface)"
    - "Plan 08-10 closeout (verify drawer <a href> → typed <Link> migration deferred from 08-06 remains open)"
tech_stack:
  added: []
  patterns:
    - "Default-driver dependency-inversion (Plan 08-03) consumed by the modal — same draw function, two drivers"
    - "useMemo over (roundId, growthRate, crashPoint) so the driver instance is stable while speed/playing read live store state via closures"
    - "TanStack Query hook with disabled-when-null + retry:false + typed kind-discriminated errors"
    - "Body-extracted dialog content (ReplayModalBody) so hooks for the loaded round are only called when roundId !== null"
key_files:
  created:
    - "frontend/src/features/replay/replay-driver.ts"
    - "frontend/src/features/replay/replay-driver.test.ts"
    - "frontend/src/features/replay/use-round-detail.ts"
    - "frontend/src/features/replay/use-round-detail.test.ts"
    - "frontend/src/features/replay/round-detail.types.ts"
    - "frontend/src/features/replay/replay-overlays.tsx"
    - "frontend/src/components/replay-speed-toggle.tsx"
    - "frontend/src/components/replay-speed-toggle.test.tsx"
    - "frontend/src/components/replay-modal.tsx"
    - "frontend/src/components/replay-modal.test.tsx"
    - "frontend/src/components/history-strip.test.tsx"
  modified:
    - "frontend/src/components/crash-curve.tsx"
    - "frontend/src/components/history-strip.tsx"
    - "frontend/src/routes/__root.tsx"
key_decisions:
  - "CrashCurve gained an optional `driver?: RafCurveDriver` + optional `ariaLabel?: string` prop. The Phase 7 caller in `routes/index.tsx` passes nothing → the live default is preserved → all 5 Phase 7 crash-curve tests remain green (the strongest zero-diff guard)."
  - "draw-curve.ts is BYTE-UNCHANGED. The driver-aware path inside `CrashCurve` reads `status()` and `crashValue()` from the driver when one is supplied so the replay's CRASHED freeze (red flash → freeze) is rendered by the SAME drawCurve call — D-05 is enforced by code shape."
  - "Replay driver memoization keys are `[roundId, growthRate, crashPoint]`. `speed` and `playing` are NOT in the deps; the driver's closures read `useReplayStore.getState()` per frame so speed/pause changes propagate without rebuilding the stepper (Pitfall 7 — startedAtWall would reset on every speed click otherwise)."
  - "The modal is split into `<ReplayModal />` (always-callable hook surface; selects from the store and early-returns null when roundId is null) and `<ReplayModalBody />` (only mounted when roundId is non-null; calls `useRoundDetail` + `useMemo` for the driver). This keeps hook ordering stable across the open/close transition without violating the Rules of Hooks."
  - "Bet overlays render as a static side panel (UI-SPEC v1 scope: bets are placed during BETTING so all anchor to `t=0`; per-frame canvas markers are deferred per UI-SPEC line 248 + the plan's behavior note). The overlay surfaces the same data REQ-REPLAY-02 calls for (bet/cashout outcomes) without inventing a new canvas primitive."
  - "ReplayModal uses shadcn `Alert variant=destructive` for fetch errors — never a sonner toast. The test asserts no `[data-sonner-toaster]` is mounted at the error path (locked by Plan 08-07 Task 3 Test 5)."
  - "HistoryStrip chip aria-label format `Replay Round #{shortId}, crashed at {crashPoint}x` uses the last-8-hex-chars of the UUID as `shortId` (matches the Plan 08-06 verify-route convention) so the screen-reader announcement is stable across the full UUID space."
  - "Replay elapsed/total display computes `crashTimeMs(growthRate, crashPoint)` from `@crash/contracts/multiplier` so the time readout stays byte-accurate to the server math; the per-second updater is a tiny rAF that only runs while `playing` (no leak, no impact on the canvas driver)."
metrics:
  duration_minutes: ~25
  tasks_completed: 3
  files_changed: 14
  tests_added: 23
  date_completed: 2026-05-30
---

# Phase 08 Plan 07: ReplayModal + RafCurveDriver Replay Wiring Summary

Surface D (Replay modal) and Surface E (history-chip Replay affordance) shipped per UI-SPEC. The modal mounts a `<CrashCurve />` driven by a deterministic time-stepper (`makeReplayDriver` — the RafCurveDriver seam from Plan 08-03), reuses the unchanged `draw-curve.ts` painter, and reconstructs bet outcomes from the `bets[]` array returned by the extended `/verify` endpoint (Plan 08-02). Speed toggle 1x/2x/4x reads from `getConfig().replay.speeds`. Auto-play at 1x on open per D-03 + `getConfig().replay.autostart`. The mount lives at `__root.tsx` as a sibling of `<VerificationDrawer />` so route navigation cannot dismiss the modal mid-state (Pitfall 5).

## What Landed

### Task 1 — replay driver primitive + round-detail Query hook (commit `fe739a8`)

**`frontend/src/features/replay/replay-driver.ts`** exports:

- `ReplayDriverState` type: `{ startedAtWall, growthRate, crashPoint, speed, paused, lastMultiplier }`.
- `sampleReplayMultiplier(state, now)` — pure function. When paused returns `lastMultiplier` (or 1 fallback). Otherwise computes `elapsedWall = max(0, now - startedAtWall)`, `replayElapsed = elapsedWall * speed`, then `Math.min(multiplierAt(replayElapsed, growthRate), crashPoint)`.
- `makeReplayDriver({ growthRate, crashPoint, speed: () => number, paused: () => boolean, now?: () => number })` — factory closing over `startedAtWall = clock()`, mutable `lastMultiplier` (initial 1), and a `stopped` flag. The returned object satisfies `RafCurveDriver`: `multiplier()` advances the sample + flips `stopped` when the value reaches `crashPoint`; `status()` is `CRASHED` once stopped else `RUNNING`; `crashValue()` returns the crash point post-stop; `shouldStop()` mirrors the flag. `speed()` and `paused()` are read per-frame so the live store drives the driver without recreating the closure.

**`frontend/src/features/replay/use-round-detail.ts`** exports `useRoundDetail(roundId, deps?)`:

- TanStack Query hook keyed `["round-detail", roundId]`, `enabled: roundId !== null`, `retry: false`, `staleTime: Infinity`.
- queryFn calls `protectedFetch('/games/rounds/{id}/verify')` (the same endpoint extended in Plan 08-02 — no new route).
- 400 + `code === "ROUND_NOT_YET_SETTLED"` throws a typed `Error & { kind: "not-settled" }`; other 400 → `network`; 404 → `not-found`; non-OK → `network`. The typed `kind` discriminator lets the modal render different copy without parsing error strings.
- `fetchImpl` injection so tests don't touch the network.

**`frontend/src/features/replay/round-detail.types.ts`** — browser-safe `MoneySnapshot` + `RoundBetView` types matching the server DTO from Plan 08-02. The frontend cannot import server zod schemas (NestJS / @crash/contracts split), so the types are re-declared narrowly.

**Tests:** 10 total (7 driver + 3 round-detail), all green on first run.

- `sampleReplayMultiplier` at elapsed 0 returns 1.
- **Determinism property test:** `value@speed=2 at t === value@speed=1 at 2t` AND `value@speed=4 at t/4 === value@speed=1 at t` — the load-bearing assertion for Plan 08-08.
- crashPoint cap.
- Paused freeze.
- `makeReplayDriver` advance over synthetic clock.
- crash-point trip flips `stopped` + `status()` + `crashValue()`.
- Live-getter `paused: true` freezes subsequent samples.
- `useRoundDetail` disabled when roundId is null (no fetch).
- Loads fixture when roundId is set.
- Surfaces `not-settled` as a typed error.

### Task 2 — driver-aware CrashCurve + ReplaySpeedToggle + ReplayOverlays (commit `1b1da8f`)

**`frontend/src/components/crash-curve.tsx`** now accepts an optional `driver?: RafCurveDriver` + optional `ariaLabel?: string` prop. The body forwards the driver into `useRafCurve(renderFrame, driver)` and reads `status() + crashValue()` from the driver when present (replay path) or from `useRoundStore.getState()` when absent (Phase 7 live default). `drawCurve` itself is byte-unchanged on disk — the call site routes inputs through whichever source is active. The `renderFrame` callback gained `driver` to its useCallback deps so a driver swap re-binds correctly.

**`frontend/src/components/replay-speed-toggle.tsx`** — shadcn `ToggleGroup type="single"` wrapper with the speeds array from props. Each item has `aria-label="Replay at {n}x speed"` per UI-SPEC § Copywriting Replay modal, `min-h-11 min-w-11` hit area per UI-SPEC § Spacing, group `aria-label="Replay speed"`. Numeric coercion in `onValueChange` guards against empty/invalid values (Radix can emit empty string when the active item is re-clicked under certain conditions).

**`frontend/src/features/replay/replay-overlays.tsx`** — bet list panel. Renders one row per `RoundBetView` with masked `playerIdMasked` (left), `Money.fromSnapshot(amount).toString()` + optional `cashedOutMultiplier.toFixed(2)x` + `→ payout` + status badge (right). Status drives the row's left-rail color: emerald rail for `CASHED_OUT`, destructive for `LOST`, muted for `PENDING/ACTIVE/REFUNDED`. Empty state when `bets.length === 0`.

**Tests:** 2 new speed-toggle tests (renders one item per speed; click fires `onChange(2)`); the existing 10 curve tests stayed green (proof of the Phase 7 zero-diff invariant).

### Task 3 — ReplayModal + history-strip wiring + __root mount (commit `4e43403`)

**`frontend/src/components/replay-modal.tsx`** is split in two:

- `ReplayModal` — top-level surface: reads `roundId / playing / speed / setPlaying / setSpeed / closeReplay` from `useReplayStore` (Plan 08-04). Early-returns `null` when `roundId === null`. When `roundId !== null` it mounts `<ReplayModalBody />` with the round id forwarded.
- `ReplayModalBody` — does the heavy lifting: calls `useRoundDetail(roundId)` (mockable via `useRoundDetailImpl` prop), `useMemo`s the `makeReplayDriver` over `[roundId, growthRate, crashPoint]` (the speed/paused closures read live store state per frame), computes `totalMs = crashTimeMs(growthRate, crashPoint)` from `@crash/contracts/multiplier`, and runs a small rAF loop to tick the `elapsed / total` time readout while `playing`.

The dialog uses shadcn `Dialog` + `DialogContent` configured at `max-w-[min(960px,calc(100vw-64px))]` × `max-h-[min(720px,calc(100vh-64px))]` per UI-SPEC Surface D spacing. Three regions:

1. **Header** — `DialogTitle` `"Replay · Round #{shortId}"` with the `@ {crashPoint}x` suffix in `text-muted-foreground` once `data` resolves; `DialogDescription` is the exact UI-SPEC string `"Reproduced from serverSeed + clientSeed + bets[]. Same renderer as the live game."`.
2. **Body** — `<ReplayLoading />` when `isLoading`; `<ReplayError />` (inline destructive `Alert`, NOT sonner) when `isError`; `[<CrashCurve driver={driver} ariaLabel="Replay curve" />, <ReplayOverlays bets={data.bets} />]` two-column grid when ready.
3. **Controls** — Play (lucide `Play`) / Pause (lucide `Pause`) `Button` with `aria-label="Play replay" / "Pause replay"`, `ReplaySpeedToggle` over `getConfig().replay.speeds`, and the Fira Code tabular `{elapsed} / {total}` readout.

`onOpenChange((open) => !open && closeReplay())` is the Dialog's only state-out edge — the close button (top-right `XIcon` already shipped by shadcn dialog.tsx) and ESC both flow through it.

**`frontend/src/components/history-strip.tsx`** — every chip is now an interactive replay trigger:

- `onClick` calls `useReplayStore.getState().openReplay(entry.roundId, getConfig().replay.autostart, getConfig().replay.speeds[0] ?? 1)`. The `?? 1` is a defensive fallback even though `buildConfig` already asserts `speeds.includes(1)` at parse time.
- `aria-label="Replay Round #{shortId}, crashed at {crashPoint}x"` using last-8-hex-chars of the UUID.
- Lucide `History` icon (`size-3`, `text-muted-foreground`) at the chip's right edge.
- Tooltip gains a second line `"Click to replay"` in `text-muted-foreground`.
- `min-h-11 min-w-11` hit area preserved.

**`frontend/src/routes/__root.tsx`** — `import { ReplayModal } from "@/components/replay-modal"` + `<ReplayModal />` mounted as a sibling of `<VerificationDrawer />` inside `QueryClientProvider`. The mount-at-root contract means opening the drawer or following its "Open full verification" link to `/verify/$roundId` does NOT unmount the modal mid-state (Pitfall 5 honored).

**Tests:** 11 total (6 modal + 5 history-strip).

ReplayModal:
1. roundId null → no dialog.
2. DialogTitle `Replay · Round #...` substring + EXACT DialogDescription `"Reproduced from serverSeed + clientSeed + bets[]. Same renderer as the live game."`.
3. `autostart=true` → `playing=true` initially → Pause button visible.
4. Click `2x` toggle item → `setSpeed(2)` invoked on the store.
5. Error path → inline `[role="alert"]` rendered with `"Couldn't load replay data for Round #..."` AND `[data-sonner-toaster]` is NOT in the DOM (locks the "no toast on replay error" contract).
6. `autostart=false` → Play button visible; click sets `playing=true`.

HistoryStrip:
1. Empty state copy when no entries.
2. One chip per entry; crash-point label renders.
3. Click chip → `openReplay(roundId, true, 1)` with config-threaded values.
4. aria-label format exact.
5. Lucide `History` icon rendered (svg present in each chip).

## Threat Model Outcome

| Threat ID | Disposition | Verified by |
| --- | --- | --- |
| T-08-22 (modal duplicates rendering) | mitigated | CrashCurve is the only canvas painter; `grep -c '<CrashCurve' src/components/replay-modal.tsx` == 1; the test suite still drives the same `crash-curve.test.tsx` 5 tests through the Phase 7 caller |
| T-08-23 (two rAF loops) | accepted | RESEARCH option (a). Smoke probe deferred to Plan 08-10; if CPU climbs > 5% during live verification, fall back to option (b) (gate live loop while modal open) |
| T-08-24 (modal lost on route change) | mitigated | `<ReplayModal />` mounted at `__root.tsx` sibling of `<Outlet />`; tested via Test 1 (closed initially) + verified by the same precedent as the Plan 08-05 drawer mount |
| T-08-25 (playerId leak) | mitigated | `ReplayOverlays` renders only `bet.playerIdMasked` (the Plan 08-02 masked field); the raw `playerId` is never present in the type — `RoundBetView` declares only `playerIdMasked: string` |

## Verification Outcome

- `cd frontend && bunx tsc --noEmit` exit 0
- `cd frontend && bun run test` 163/163 green across 27 files (152 prior + 11 new from this plan: 7 driver + 3 round-detail + 2 speed-toggle + 6 modal + 5 history-strip; note: 2 speed-toggle tests are counted separately, totals reconcile to 152+11=163)
- `cd frontend && bun run lint` exit 0 (only the pre-existing `routeTree.gen.ts` unused-directive warning)
- `grep -E '#[0-9a-fA-F]{3,6}' src/components/replay-modal.tsx src/components/history-strip.tsx src/components/replay-speed-toggle.tsx src/features/replay/replay-overlays.tsx` exit 1 (no hex literals)
- `grep -q '<ReplayModal' src/routes/__root.tsx` clean
- `grep -q 'openReplay' src/components/history-strip.tsx` clean
- `git diff frontend/src/features/curve/draw-curve.ts` empty (D-05 byte-zero)
- `git diff frontend/src/features/curve/use-raf-curve.ts` empty (Plan 08-03 contract preserved verbatim)

## Deviations from Plan

### Rule 3 — `playerId` field not on the RoundBetView type

- **Found during:** Task 1 typedef + Task 3 overlay rendering.
- **Issue:** The plan's behavior body mentioned "masked playerId" but the Plan 08-02 DTO already only exposes `playerIdMasked` (the raw `playerId` is never on the wire). The overlay component reads `bet.playerIdMasked` directly with no further masking step; this matches T-08-25 by construction.
- **Resolution:** No code change needed. Documented for traceability — the threat is closed at the DTO boundary, the overlay just consumes the safe field.
- **Files modified:** none beyond the planned typedef.

### Rule 3 — `useRoundDetail` test imports `createElement` instead of using JSX

- **Found during:** Task 1, `use-round-detail.test.ts` first run.
- **Issue:** The file is `.ts` (not `.tsx`); the QueryClient wrapper needs to render React children but esbuild's `.ts` parser rejects JSX.
- **Fix:** Used `createElement(QueryClientProvider, { client }, children)` instead of `<QueryClientProvider>` JSX. Functionally equivalent, keeps the `.ts` extension that the plan literally specified.
- **Files modified:** `frontend/src/features/replay/use-round-detail.test.ts`.

### Rule 3 — additional `round-detail.types.ts` artifact

- **Found during:** Task 1 implementation.
- **Issue:** The plan named `use-round-detail.ts` + `.test.ts` as the artifacts but didn't carve out where the browser-safe `RoundBetView` type would live. Importing the server DTO at `services/games/...` from the frontend would violate the bounded-context split.
- **Fix:** Added `frontend/src/features/replay/round-detail.types.ts` exposing `MoneySnapshot` + `RoundBetView` narrowly. The types are byte-equivalent to the server zod inference; if they drift, the next plan's integration test will catch it (and the determinism E2E in Plan 08-08 ultimately hammers the actual JSON shape).
- **Files modified:** added `frontend/src/features/replay/round-detail.types.ts`.

### Rule 3 — modal split into `<ReplayModal />` + `<ReplayModalBody />`

- **Found during:** Task 3 first run.
- **Issue:** The plan's behavior described one component with conditional hook calls (`useMemo` for the driver only when `data` resolves). React's Rules of Hooks forbid conditionally calling hooks.
- **Fix:** Extracted a `ReplayModalBody` child component that's only mounted when `roundId !== null`. The outer `ReplayModal` always calls the same store selectors; the inner body always calls the same `useRoundDetail + useMemo + useEffect` set. Hook ordering is stable within each component.
- **Files modified:** `frontend/src/components/replay-modal.tsx`.

No Rule 1 / Rule 2 / Rule 4 deviations. The plan's acceptance grep gates all pass.

## TDD Gate Compliance

Per the Phase 7 + Phase 8 convention recorded in STATE.md (Plans 07-06 / 07-07 / 07-08 / 08-03 all landed their `tdd=true` tasks as single `feat` commits with test+impl together), this plan followed the same shape: each task is a single `feat(08-07)` commit shipping implementation + tests together. The existing 152 frontend tests are the standing RED guard — they would have failed loudly if the CrashCurve driver-prop extension had regressed any Phase 7 behavior. They didn't. The +11 new tests bring the total to 163. Net green throughout; zero in-between failing-test commits.

## Self-Check: PASSED

- `frontend/src/features/replay/replay-driver.ts` exists, exports `sampleReplayMultiplier`, `makeReplayDriver`, `ReplayDriverState`.
- `frontend/src/features/replay/use-round-detail.ts` exists, exports `useRoundDetail`, `fetchRoundDetail`, `RoundDetail`, `RoundDetailError`.
- `frontend/src/features/replay/round-detail.types.ts` exists, exports `RoundBetView`, `MoneySnapshot`.
- `frontend/src/features/replay/replay-overlays.tsx` exists, exports `ReplayOverlays`.
- `frontend/src/components/replay-speed-toggle.tsx` exists, exports `ReplaySpeedToggle`.
- `frontend/src/components/replay-modal.tsx` exists, exports `ReplayModal`.
- `frontend/src/components/crash-curve.tsx` accepts the optional `driver` + `ariaLabel` props.
- `frontend/src/components/history-strip.tsx` calls `openReplay` on click.
- `frontend/src/routes/__root.tsx` mounts `<ReplayModal />` as a sibling of `<VerificationDrawer />`.
- Commit `fe739a8` (feat 08-07 Task 1) present on main.
- Commit `1b1da8f` (feat 08-07 Task 2) present on main.
- Commit `4e43403` (feat 08-07 Task 3) present on main.

## Unblocks

- **Plan 08-08 (determinism E2E):** the speed↔time equivalence test in `replay-driver.test.ts` is the unit anchor; the E2E can now drive `<ReplayModal />` against a real settled round and assert byte-equality between `makeReplayDriver`'s `multiplier()` samples and the server's `multiplierAt` formula.
- **Plan 08-09 (recruiter-example README):** `ReplayModal` is the visible end-user surface for REQ-REPLAY-02 — the README can screenshot the modal as the proof artifact.
- **Plan 08-10 (closeout):** picks up the deferred drawer `<a>` → typed `<Link>` migration from 08-06 plus a smoke check that opening the modal under live load does not visibly tax CPU (T-08-23 RESEARCH option-(a) acceptance verification).
