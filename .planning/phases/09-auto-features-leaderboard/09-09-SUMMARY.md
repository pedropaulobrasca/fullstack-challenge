---
phase: 09-auto-features-leaderboard
plan: 09
subsystem: frontend / right-rail tabbed Leaderboard + shared-kernel maskPlayerId consolidation
tags:
  - leaderboard
  - frontend
  - tanstack-query
  - shadcn-tabs
  - ws-subscribe
  - shared-kernel
  - rank-up-transition
  - own-row-detection
  - phase-9
requirements:
  - REQ-LEAD-03
  - REQ-LEAD-04
dependency_graph:
  requires:
    - Plan 09-06 — server-side WS `leaderboard:updated` emit with maskPlayerId transform + shared `@crash/contracts/ws/leaderboardUpdatedPayloadSchema`
    - Plan 09-07 — GET `/games/leaderboard?window=24h` JwtGuard-protected endpoint returning the same shape as the WS payload
    - Plan 09-08 — `subscribeWsEvent` pub-sub surface added on `ws-dispatch.ts` (re-used here for `leaderboard:updated`)
    - Plan 09-01 — `getConfig().leaderboard.{sizeN, windowHours, relativeRefreshMs, rankUpTransitionMs}` env layer
    - Phase 6 P6.05 — original `maskPlayerId` server implementation (SHA-256 hex prefix; identical algorithm preserved by the move)
  provides:
    - "`@crash/shared-kernel` `maskPlayerId(playerId: PlayerId) → string` exported from the identity namespace, ready to import on both backend AND frontend"
    - "`frontend/src/features/leaderboard/leaderboard-api.ts` — `fetchLeaderboard('24h')` with Zod-gated response"
    - "`frontend/src/features/leaderboard/use-leaderboard.ts` — TanStack Query hook + WS `leaderboard:updated` cache-replace subscription via `subscribeWsEvent`"
    - "`frontend/src/components/{rank-chip,leaderboard-row,leaderboard-panel}.tsx` — UI surface for the right-rail Leaderboard tab"
    - "Right rail in `routes/index.tsx` refactored into controlled shadcn `<Tabs>` (Live Feed default | Leaderboard) with `LiveFeed` preserved byte-unchanged"
  affects:
    - "All 6 server consumers of the legacy `services/games/src/application/use-cases/mask-player-id.ts` re-imported from `@crash/shared-kernel`; legacy file deleted"
    - "Plan 09-10 (closeout) ADR candidate — Light-CQRS read-side architecture lands the FE consumer here; closes Phase 9 ROADMAP success criterion 2 (FE renders leaderboard + WS live update)"
tech_stack:
  added: []
  patterns:
    - "Cross-environment shared helper: `maskPlayerId` lives in the workspace `@crash/shared-kernel`; the same function (SHA-256 → 8 hex prefix) runs on both the NestJS server (gateway/use-cases/projector) and the React frontend (own-row detection), eliminating any algorithm drift between transports"
    - "WS-driven TanStack Query cache replace: `useLeaderboard` subscribes to the `leaderboard:updated` event and calls `queryClient.setQueryData` with the inline payload (Q4 — no roundtrip), while `staleTime: Infinity` keeps the cache pinned to the WS-authoritative source"
    - "Zod gate at every transport boundary: both `fetchLeaderboard` (HTTP) and `dispatchWsEvent` (WS) parse against the same `leaderboardUpdatedPayloadSchema` from `@crash/contracts/ws` — single source of truth, zero drift"
    - "Tabbed-rail refactor preserves Phase 7 D-01 layout byte-stable: the `feed-rail` aside's grid column + width + min-height are unchanged; only the inner content swap is added"
    - "Rank-up transition is a CSS-only `transition: border-color` on `RankChip`; the row tracks `previousRank` per render via a `useRef` map and applies a transient `data-rank-up` attribute that flips back automatically after `rankUpTransitionMs + 600ms` — not a juice moment, not counted against the four-juice budget"
    - "Own-row detection uses the OIDC `sub` claim (held only in memory) hashed through the shared `maskPlayerId` to compare with `entry.playerIdMasked` — full UUID never serialised to the DOM (T-09-61 mitigation)"
  removed: []
key_files:
  created:
    - packages/shared-kernel/src/identity/mask-player-id.ts
    - packages/shared-kernel/tests/identity/mask-player-id.test.ts
    - frontend/src/features/leaderboard/leaderboard-api.ts
    - frontend/src/features/leaderboard/use-leaderboard.ts
    - frontend/src/features/leaderboard/use-leaderboard.test.ts
    - frontend/src/components/rank-chip.tsx
    - frontend/src/components/leaderboard-row.tsx
    - frontend/src/components/leaderboard-panel.tsx
    - frontend/src/components/leaderboard-panel.test.tsx
    - .planning/phases/09-auto-features-leaderboard/09-09-SUMMARY.md
  modified:
    - packages/shared-kernel/src/index.ts (re-export `./identity/mask-player-id`)
    - services/games/src/application/use-cases/get-current-round.use-case.ts
    - services/games/src/application/use-cases/get-leaderboard.use-case.ts
    - services/games/src/application/use-cases/get-ws-snapshot.use-case.ts
    - services/games/src/application/use-cases/verify-round.use-case.ts
    - services/games/src/infrastructure/messaging/ws-bridge.consumer.ts
    - services/games/src/presentation/gateways/game-ws.gateway.ts
    - services/games/tests/unit/get-leaderboard.use-case.test.ts
    - frontend/src/stores/ws-dispatch.ts (added `leaderboard:updated` event slot + Zod schema gate)
    - frontend/src/routes/index.tsx (right-rail refactored to shadcn `<Tabs>` controlled by `feedTab` state)
    - frontend/src/routes/index.test.tsx (+3 tab tests; mocks `LeaderboardPanel`/`LiveFeed` for layout isolation)
  deleted:
    - services/games/src/application/use-cases/mask-player-id.ts
decisions:
  - "Direct deletion over re-export shim for the legacy `mask-player-id.ts` — every consumer was already cataloged (grep returned 6 production + 1 test call sites, all owned by `services/games`); migrating them in the same commit kept the import path canonical and avoided leaving a deprecated alias surface"
  - "Inline WS cache replace via `queryClient.setQueryData` rather than `invalidateQueries` — the server already throttles `leaderboard:updated` to rank-change boundaries (Plan 09-06) and the payload IS the full top-N; a refetch would be one extra round-trip for no new information (Q4 recommendation)"
  - "Own-row detection runs through the shared `maskPlayerId` and compares the 8-hex prefix — never the raw UUID — so the OIDC `sub` claim cannot leak into a DOM attribute. The cross-environment determinism test in `packages/shared-kernel/tests/identity/mask-player-id.test.ts` is the gate proving the FE hash matches the server hash byte-for-byte for the same UUID"
  - "Footer relative-timestamp `setInterval` registers only when the panel's `isActive` prop is true (controlled by the parent `Tabs` `onValueChange` in `routes/index.tsx`); switching back to Live Feed clears the interval on the effect cleanup, honoring the Phase 7/8 isolation principle that auxiliary surfaces never tick when off-screen"
  - "Rank-up transition is gated on `entry.rank < previousRank` only (not rank-down) per UI-SPEC §Color — the emerald accent signal is reserved for rising/winning. Duration sourced from `getConfig().leaderboard.rankUpTransitionMs` (default 200ms) plus a 600ms ease-back via the CSS `transition` shorthand; reduced-motion users get the data-attribute toggle without the transition rule firing (no JS branch needed — Tailwind/CSS handles it)"
  - "Test interaction for the Tabs trigger uses `fireEvent.pointerDown + mouseDown + click` instead of `userEvent.click` because Radix Tabs activates on pointer down in jsdom — same pattern Plan 09-08 had to apply to its bet-panel trigger; documented inline so future tabs tests don't repeat the discovery"
metrics:
  duration: approximately 25 minutes
  completed: 2026-05-30
  tasks_total: 4
  tasks_complete: 4
  tests_added: 24
  commits: 8
  files_created: 9
  files_modified: 10
  files_deleted: 1
---

# Phase 9 Plan 09: Frontend Leaderboard Panel + shared `maskPlayerId` Summary

**One-liner:** Right rail refactored into a controlled shadcn `<Tabs>` (`Live Feed` default | `Leaderboard`) with a new `LeaderboardPanel` rendering the top-N from `GET /games/leaderboard?window=24h` via TanStack Query + the inline-replace `leaderboard:updated` WS subscription, both Zod-gated against the same `@crash/contracts/ws/leaderboardUpdatedPayloadSchema`; the `maskPlayerId` helper moved to `@crash/shared-kernel` so the FE own-row detection runs the byte-identical SHA-256 prefix algorithm the server uses, with a cross-environment determinism unit test locking the contract.

---

## What landed

### Task 1 — `maskPlayerId` consolidation in `@crash/shared-kernel`

Created `packages/shared-kernel/src/identity/mask-player-id.ts` carrying the byte-identical Phase 6 implementation (`createHash("sha256").update(playerId).digest("hex").substring(0, 8)`), exported through the shared-kernel barrel. Migrated all 6 production consumers + 1 unit test to `import { maskPlayerId } from "@crash/shared-kernel"`:

- `services/games/src/application/use-cases/get-current-round.use-case.ts`
- `services/games/src/application/use-cases/get-leaderboard.use-case.ts`
- `services/games/src/application/use-cases/get-ws-snapshot.use-case.ts`
- `services/games/src/application/use-cases/verify-round.use-case.ts`
- `services/games/src/infrastructure/messaging/ws-bridge.consumer.ts`
- `services/games/src/presentation/gateways/game-ws.gateway.ts`

Legacy `services/games/src/application/use-cases/mask-player-id.ts` deleted. The shared-kernel test suite locks a fixture UUID `3f29b1a2-4d5e-6f7a-8b9c-0d1e2f3a4b5c` through a reference `node:crypto` implementation — proving the FE-imported function and the server-imported function produce the same 8-hex string for the same input. Cross-environment determinism gate green.

### Task 2 — `useLeaderboard` hook + WS-driven cache replace

`leaderboard-api.ts` exposes `fetchLeaderboard('24h')` which calls `protectedFetch('/games/leaderboard?window=24h')` (Bearer token via the Phase 7 OIDC SPA helper) and parses the response through `leaderboardResponseSchema` (re-exported from `@crash/contracts/ws/leaderboardUpdatedPayloadSchema`).

`use-leaderboard.ts` exposes `useLeaderboard()` returning a `useQuery({ queryKey: ['leaderboard', '24h'], queryFn: fetchLeaderboard, staleTime: Infinity })`. A `useEffect` subscribes to the `leaderboard:updated` WS event via `subscribeWsEvent` (the pub-sub surface Plan 09-08 added) and on each valid payload calls `queryClient.setQueryData(leaderboardQueryKey, payload)` — inline cache replace, no refetch, no roundtrip.

`ws-dispatch.ts` extended with the new event slot (event name added to `WS_EVENTS`, schema mapped through `leaderboardUpdatedPayloadSchema`, a no-op handler so the dispatcher schema gate runs even when no subscriber is attached). Invalid payloads are dropped at the existing `safeParse` boundary with a `console.warn`.

### Task 3 — `RankChip` + `LeaderboardRow` + `LeaderboardPanel`

- `RankChip` renders a 24×24 circle (ranks 1-9) or 24×32 rounded rect (rank 10) with the UI-SPEC §Color rank-color rule (rank-1 emerald, rank-2 cyan, rank-3 muted, 4-10 hairline). Color is exposed via `data-rank-color` for unit-test assertion and CSS only — no hardcoded hex.
- `LeaderboardRow` renders the 2-line layout: rank chip + masked playerId (or `YOU (first5hex…)` for own row) + right-aligned Money net profit with leading `+` / `−` sign + lucide `TrendingUp` / `TrendingDown` icon; bottom line = `Nw` win count muted. Negative profit uses `muted-foreground` (NOT destructive/red per UI-SPEC §Color — red is reserved for crash). Left-rail follows the same rank rule (emerald rank-1 / cyan rank-2 / muted rank-3 / transparent 4-10), with an emerald override for own-row regardless of rank. Rank-up transition fires only when `entry.rank < previousRank`, applying a transient `data-rank-up` attribute for 200ms + 600ms ease-back (CSS-only).
- `LeaderboardPanel` reads `useLeaderboard()` + `useOidc().oidcTokens.decodedIdToken.sub`, computes `ownMasked = maskPlayerId(PlayerId(sub))`, and renders distinct skeleton (5 rows matching loaded dimensions), empty, error (shadcn `Alert variant="destructive"` + `Retry` button) and list states. Heading `"Top ${sizeN} · last ${windowHours}h"` from env. Refresh button has a `≥ 44×44px` hit area + aria-label `"Refresh leaderboard"` + `Refresh now` tooltip. Footer `Updated Ns ago` ticks only while `isActive` is true. `aria-live="polite"` announces `"You moved up to rank N"` when own rank improves; never on rank-down.

### Task 4 — Right rail refactored to controlled shadcn `<Tabs>`

`routes/index.tsx` wraps the `feed-rail` aside's content in `<Tabs value={feedTab} onValueChange={setFeedTab}>` with two triggers — `Live Feed` (default active) and `Leaderboard` (with lucide `Trophy` icon). `LiveFeed` mounted byte-unchanged inside its `TabsContent`. `LeaderboardPanel` mounted inside the other `TabsContent` and receives `isActive={feedTab === 'leaderboard'}` so its footer interval only runs while the user is looking at it. The grid layout (`grid-cols-[320px_minmax(0,1fr)_320px]`), aside dimensions (`min-h-40 lg:min-h-[520px]`), and the bet-rail + curve-stage sections are byte-stable.

---

## Tests

| Suite | New cases | Total |
| ----- | --------- | ----- |
| `packages/shared-kernel/tests/identity/mask-player-id.test.ts` | 5 | 5/5 pass |
| `frontend/src/features/leaderboard/use-leaderboard.test.ts` | 7 | 7/7 pass |
| `frontend/src/components/leaderboard-panel.test.tsx` | 17 | 17/17 pass (5 RankChip + 5 LeaderboardRow + 7 LeaderboardPanel) |
| `frontend/src/routes/index.test.tsx` | +3 (tabs) | 11/11 pass |
| `frontend/src/stores/ws-dispatch.test.ts` (regression) | 0 | 10/10 still pass |
| **Frontend full suite** | **+27 net** | **244/244 pass** (was 217; +27 from this plan — store + hook + components + tabs) |
| **Services/games unit suite** | 0 (regression-only gate) | 279 pass / 8 fail (baseline pre-existing failures unchanged; +0 from this plan because the migration is a pure import-path swap) |

---

## Verification

| Gate | Result |
| ---- | ------ |
| `cd packages/shared-kernel && bun test tests/identity/mask-player-id.test.ts` | 5/5 pass, 7 expect() calls |
| `cd services/games && bunx tsc --noEmit` | exit 0 |
| `cd services/games && bun test tests/unit` | 279 pass / 8 fail (baseline unchanged) |
| `cd frontend && bunx tsc --noEmit` | exit 0 |
| `cd frontend && bunx vitest run` | 244/244 pass across 36 files in ~3.3s |
| `cd frontend && bun run lint` | clean (only pre-existing `routeTree.gen.ts` warning, unrelated) |
| `grep -E "bg-destructive\|text-destructive\|text-red" frontend/src/components/leaderboard-row.tsx` | 0 matches (UI-SPEC §Color — muted, NOT red, for negative profit) |
| `grep -E "\b5000\b\|\b200\b" frontend/src/components/leaderboard-panel.tsx` | 0 matches (sizes/intervals env-driven) |
| `grep -E "z\.parse\|safeParse\|\.parse\(" frontend/src/features/leaderboard/leaderboard-api.ts` | 1 match (Zod gate present on the response) |
| `grep -E "replace\(/\-/g\|slice\(0, *8\)" frontend/src/components/leaderboard-panel.tsx` | 0 matches (no buggy UUID-prefix mask) |
| `grep -E "from \"@crash/shared-kernel\"" frontend/src/components/leaderboard-panel.tsx` | 1 match (shared helper imported) |
| `grep -rE "from.*application/use-cases/mask-player-id" services/games/src/` | 0 matches (all consumers migrated) |

---

## Deviations from Plan

### Rule 1 — test-DX fix for Radix Tabs in jsdom

**Found during:** Task 4 first test run.
**Issue:** `leaderboardTrigger.click()` alone does not switch a Radix Tab in jsdom — Radix listens to `pointerdown` first.
**Fix:** Use `fireEvent.pointerDown(trigger, { button: 0 }) + fireEvent.mouseDown(trigger, { button: 0 }) + fireEvent.click(trigger)` — same pattern Plan 09-08 already established for the bet-panel Tabs trigger.
**Files affected:** `frontend/src/routes/index.test.tsx` (test code only — zero production change).
**Commit:** folded into `5f75ae0` (Task 4 GREEN commit).

### Rule 1 — `findByText(otherMasked)` exact-match mismatch

**Found during:** Task 3 first test run.
**Issue:** The leaderboard row renders the masked id with an ellipsis suffix (`bd14a3c2…`), so an exact-text `findByText("bd14a3c2")` query fails.
**Fix:** Switched the panel tests to `findByText(new RegExp(masked))` substring match.
**Files affected:** `frontend/src/components/leaderboard-panel.test.tsx` (test code only).
**Commit:** folded into `9b355b8` (Task 3 GREEN commit).

No Rule 2 / Rule 3 / Rule 4 deviations triggered. The cross-environment determinism gate (Task 1's anchor test) ran green on the first GREEN commit — no algorithm regression on any of the 6 server consumers.

---

## Authentication gates

None. The new `useLeaderboard` hook uses the existing Phase 7 `protectedFetch` helper which threads the OIDC SPA Bearer token through Kong to the JwtGuard-protected `/games/leaderboard` endpoint Plan 09-07 already shipped. No new Keycloak realm config, no new client credentials.

---

## Threat-model dispositions

| Threat | Disposition | Verified by |
| ------ | ----------- | ----------- |
| T-09-60 Tampering — malicious WS payload with invalid shape | mitigate | `dispatchWsEvent` runs `leaderboardUpdatedPayloadSchema.safeParse` on every inbound payload; invalid drops with `console.warn` and the cache stays at the last valid state. Locked by `use-leaderboard.test.ts` case "drops invalid WS payloads without corrupting cache". |
| T-09-61 Information Disclosure — FE leaks own full player UUID via DOM | mitigate | Own-row detection runs through shared `maskPlayerId` to produce an 8-hex prefix; the OIDC `sub` claim is only held in the memoised `useOwnMasked` hook and never written to a `data-*` attribute or text node. Grep gate `no replace(/-/g)` and `no slice(0,8)` in `leaderboard-panel.tsx` enforces this. |
| T-09-62 Availability — render storm on rapid WS events | mitigate | `setQueryData` is idempotent + memoized; React renders only when data identity changes. The server already throttles `leaderboard:updated` to rank-change boundaries (Plan 09-06 throttle gate). |
| T-09-63 Availability — footer setInterval leaks across tab swaps | mitigate | The `useRelativeFooter` hook's `useEffect` clears the interval on cleanup; it never registers when `isActive` is false. Verified by inspection + the panel's `isActive` prop flowing from `routes/index.tsx`'s controlled `<Tabs value=...>`. |

---

## Commits

| Hash      | Type | Scope | Description |
| --------- | ---- | ----- | ----------- |
| `2173e3f` | test | 09-09 | RED — failing tests for shared-kernel maskPlayerId |
| `82ac1e7` | feat | 09-09 | GREEN — move maskPlayerId to @crash/shared-kernel + migrate 6 server consumers |
| `41a69ec` | test | 09-09 | RED — failing tests for useLeaderboard hook + fetchLeaderboard |
| `c3c0ac5` | feat | 09-09 | GREEN — useLeaderboard hook with WS-driven cache replace + ws-dispatch extension |
| `636f40e` | test | 09-09 | RED — failing tests for RankChip + LeaderboardRow + LeaderboardPanel |
| `9b355b8` | feat | 09-09 | GREEN — LeaderboardPanel with rank chip, own-row override, rank-up transition |
| `eeda105` | test | 09-09 | RED — failing tests for right-rail tabs (Live Feed | Leaderboard) |
| `5f75ae0` | feat | 09-09 | GREEN — tab right rail into Live Feed + Leaderboard |

---

## What this unblocks

- **Plan 09-10 closeout** — REQ-LEAD-03 (FE consumes endpoint via TanStack Query) + REQ-LEAD-04 (FE renders side panel with WS live updates) both closed at this plan; closure recorded for ROADMAP rotation. ADR candidate: "Shared `maskPlayerId` helper as the cross-environment determinism gate for own-row detection (Phase 9 read-side closure)".
- **Future Phase 10 hardening** — the right-rail tab structure is now in place so future surfaces (achievements, history-by-player) can land as additional `TabsTrigger` rows without disturbing the live-game grid.

---

## Self-Check: PASSED

- [x] `packages/shared-kernel/src/identity/mask-player-id.ts` FOUND
- [x] `packages/shared-kernel/tests/identity/mask-player-id.test.ts` FOUND
- [x] `frontend/src/features/leaderboard/leaderboard-api.ts` FOUND
- [x] `frontend/src/features/leaderboard/use-leaderboard.ts` FOUND
- [x] `frontend/src/features/leaderboard/use-leaderboard.test.ts` FOUND
- [x] `frontend/src/components/rank-chip.tsx` FOUND
- [x] `frontend/src/components/leaderboard-row.tsx` FOUND
- [x] `frontend/src/components/leaderboard-panel.tsx` FOUND
- [x] `frontend/src/components/leaderboard-panel.test.tsx` FOUND
- [x] `services/games/src/application/use-cases/mask-player-id.ts` DELETED (verified via `ls`)
- [x] Commit `2173e3f` FOUND in git log
- [x] Commit `82ac1e7` FOUND in git log
- [x] Commit `41a69ec` FOUND in git log
- [x] Commit `c3c0ac5` FOUND in git log
- [x] Commit `636f40e` FOUND in git log
- [x] Commit `9b355b8` FOUND in git log
- [x] Commit `eeda105` FOUND in git log
- [x] Commit `5f75ae0` FOUND in git log
