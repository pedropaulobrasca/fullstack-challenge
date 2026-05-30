---
phase: 08-provably-fair-history-replay
plan: 05
subsystem: frontend-fairness-ui
tags: [fairness, verification, drawer, sheet, sha256, crypto.subtle, a11y]
requires:
  - "@crash/contracts/provably-fair-browser (sha256OfHexEncodedSeed from Plan 08-01)"
  - frontend Plan 08-04 (useFairnessStore.drawerOpen + openDrawer/closeDrawer, shadcn sheet/alert, getConfig().drawer.slideMs)
  - Phase 7 frontend shell (round.store status, history.store entries, lib/api protectedFetch, shadcn button/tooltip/skeleton/separator)
provides:
  - HashBlock + VerdictChip presentational primitives
  - useVerifyPrevious hook (fetch + in-browser SHA-256 + cache + retry + secure-context fallback)
  - VerificationExplainer (locked 1-paragraph copy)
  - FairnessBadge mounted in header (Surface A)
  - VerificationDrawer mounted at __root.tsx sibling of <Outlet /> (Surface B, Pitfall 5)
affects:
  - Plan 08-06 (/verify/:roundId route — the drawer's "Open full verification" link target lands then)
tech-stack:
  added: []
  patterns:
    - "Hook returns a discriminated state machine (idle | loading | computing | match | mismatch | error) so the consumer renders one path per state without re-running the fetch."
    - "Cache-first read from useFairnessStore.selectVerdict short-circuits the network when a verdict is already known."
    - "TypeError catch around sha256OfHexEncodedSeed locks the Pitfall 4 (crypto.subtle undefined in non-secure context) fallback at the boundary — Test 7 mocks crypto.subtle = undefined and asserts the locked copy."
    - "Drawer accepts a useVerifyPreviousImpl prop so tests inject deterministic state without touching protectedFetch."
    - "Drawer mounted as sibling of <Outlet /> at root so route navigation never unmounts it (Pitfall 5 invariant)."
key-files:
  created:
    - frontend/src/components/hash-block.tsx
    - frontend/src/components/hash-block.test.tsx
    - frontend/src/components/verdict-chip.tsx
    - frontend/src/components/verdict-chip.test.tsx
    - frontend/src/components/fairness-badge.tsx
    - frontend/src/components/fairness-badge.test.tsx
    - frontend/src/components/verification-drawer.tsx
    - frontend/src/components/verification-drawer.test.tsx
    - frontend/src/features/fairness/use-verify-previous.ts
    - frontend/src/features/fairness/use-verify-previous.test.ts
    - frontend/src/features/fairness/verification-explainer.tsx
  modified:
    - frontend/src/routes/__root.tsx
decisions:
  - "FairnessBadge derives commitmentLive from round.status (BETTING/RUNNING) instead of seedHash. The plan's <interfaces> referenced useRoundStore.seedHash but the actual Phase 7 round.store does NOT carry a seedHash field, and round.store.ts is not in this plan's files_modified. status is the authoritative observable signal that a round commitment is in flight — between rounds, status is IDLE/CRASHED/SETTLED and the dot dims, matching the UI-SPEC state matrix line-for-line."
  - "Drawer slideMs is applied via inline style={{ transitionDuration }} on SheetContent rather than a CSS variable. The shadcn Sheet's data-state animation classes hardcode duration-500/300 — overriding via inline transitionDuration is the minimal-surgery override that does not require forking the shadcn primitive."
  - "useVerifyPrevious accepts an optional fetchVerifyImpl injected dependency so the hook test exercises the full state machine without mocking the api module. Production calls protectedFetch('/games/rounds/{id}/verify') with the path-shape from Plan 08-02's DTO extension."
  - "Drawer renders 'Open full verification ↗' as a plain <a href=/verify/{id}> rather than TanStack <Link> since the route lands in Plan 08-06; using the typed Link would force a route-registration dependency on a not-yet-landed file."
  - "Verdict chip uses inline-flex with theme tokens (bg-accent/10 + border-accent/30 for MATCH, destructive variants for MISMATCH). MATCH gets aria-live='polite'; MISMATCH gets aria-live='assertive' per UI-SPEC Surface C escalation rule (a mismatch is a 'crash of trust')."
  - "TooltipProvider is mounted inside FairnessBadge directly (not at __root.tsx). This keeps the badge self-contained and matches the Phase 7 pattern (each surface owns its tooltip context) — no global TooltipProvider exists in the Phase 7 root yet."
metrics:
  duration: ~5 minutes
  completed: 2026-05-29
  tasks: 3
  commits: 3
  tests_added: 26 (4 hash-block + 5 verdict-chip + 7 use-verify-previous + 5 fairness-badge + 5 verification-drawer)
  files_changed: 12
---

# Phase 8 Plan 05: FairnessBadge + VerificationDrawer + useVerifyPrevious Summary

Filled the Phase 7 reserved `data-slot="fairness-badge"` slot in `__root.tsx` header with the live **FairnessBadge** (Surface A) and mounted **VerificationDrawer** (Surface B) at the root level as a sibling of `<Outlet />` so route changes do not unmount it (Pitfall 5). The drawer pulls the previous round's `serverSeed` via `protectedFetch`, computes `SHA-256` in the browser via `sha256OfHexEncodedSeed` from `@crash/contracts/provably-fair-browser` (Plan 08-01 subpath), and renders MATCH / MISMATCH / Pending verdicts with icon + text + theme color — never color-only. The required **Pitfall 4 fallback** (non-secure context → `crypto.subtle === undefined` → `TypeError`) is locked by Test 7, surfacing the exact UI-SPEC copy `"Browser cryptography unavailable. Open the app via http://localhost or HTTPS."` in a destructive `Alert`.

## What landed

### Task 1: HashBlock + VerdictChip primitives (commit `b6ef588`)

- `frontend/src/components/hash-block.tsx` — `<code>` wrapper styled `font-mono text-sm font-normal break-all rounded-md border border-border bg-popover px-4 py-2` + a ghost Copy button with `lucide-react` `Copy` → `Check` swap labelled "Copied" for 1400ms via `setTimeout`/`clearTimeout` cleanup-safe. `aria-label="Copy {label}"` per UI-SPEC § Copywriting / Copy button.
- `frontend/src/components/verdict-chip.tsx` — MATCH renders `CheckCircle2` + matchText with `bg-accent/10 text-accent border-accent/30` + `role="status" aria-live="polite"`. MISMATCH renders `XCircle` + mismatchText with destructive theme tokens + `role="status" aria-live="assertive"` (UI-SPEC Surface C escalation: a MISMATCH is a critical alarm). PENDING renders a shadcn `Skeleton` with `aria-label={pendingText}` — no icon, no text leak.
- Theme tokens only (`bg-accent`, `text-destructive`, `border-border`, etc.); zero hex literals — `grep -E '#[0-9a-fA-F]{3,6}'` exit 1.
- 9 tests (4 hash-block + 5 verdict-chip) all PASS — Copy invocation, "Copied" flash + revert, aria-label correctness, MATCH/MISMATCH role/aria-live, PENDING Skeleton, no-color-alone (icon + text both present).

### Task 2: useVerifyPrevious hook + verification-explainer (commit `d9dcd57`)

- `frontend/src/features/fairness/use-verify-previous.ts` — Returns `{ status, computedHash, previousRoundId, previousServerSeed, previousSeedHash, errorMessage, errorCode, retry }`. Effect runs on `[previousRoundId, version]`:
  1. `previousRoundId === null` → status `idle`, all fields null.
  2. **Cache-first:** `selectVerdict(state, roundId)` returns cached MATCH/MISMATCH → set status without firing fetch.
  3. Fetch → 400 with `code === "ROUND_NOT_YET_SETTLED"` → status `error`, errorCode `ROUND_NOT_YET_SETTLED`, errorMessage = locked copy. Non-200 → status `error`, errorCode `NETWORK`.
  4. Compute `sha256OfHexEncodedSeed(serverSeed)` inside `try/catch (err)`. If `err instanceof TypeError` → status `error`, errorCode `CRYPTO_UNAVAILABLE`, errorMessage = `"Browser cryptography unavailable. Open the app via http://localhost or HTTPS."` (Pitfall 4 fallback). Any other thrown error rethrows.
  5. Compare digest to `serverSeedHash` → call `useFairnessStore.getState().recordVerdict(roundId, "MATCH"|"MISMATCH")` → set status `match`/`mismatch`.
- `retry()` mutates `useFairnessStore.verdicts` to drop the cached entry, then bumps a `version` counter to re-trigger the effect.
- `verification-explainer.tsx` renders the **exact** locked-copy paragraph (verified by `grep -q "Before each round, the server publishes a SHA-256 hash of a secret seed."`).
- 7 tests all PASS including the **required, non-skippable Test 7** (Pitfall 4): `Object.defineProperty(globalThis.crypto, "subtle", { get: () => undefined })`, render hook → `status === "error"`, `errorCode === "CRYPTO_UNAVAILABLE"`, `errorMessage === "Browser cryptography unavailable. Open the app via http://localhost or HTTPS."`.

### Task 3: FairnessBadge + VerificationDrawer + __root.tsx mount (commit `cb15f13`)

- `frontend/src/components/fairness-badge.tsx` — shadcn `Button variant="outline" size="sm"` wrapped in a `Tooltip`. ShieldCheck (`text-accent`) + "Fairness" label (Fira Sans 14px semibold) + the dot indicator. Dot:
  - `motion-safe:animate-pulse bg-accent` when `status === "BETTING" || "RUNNING"` (commitment live).
  - `bg-muted-foreground` between rounds.
  - Replaced by `<CheckCircle2 aria-label="verified">` when `selectRecentlyVerified(state, mostRecentChip.roundId, Date.now()) === true` (4s transient after MATCH).
- Clicking calls `useFairnessStore.getState().openDrawer()`. `aria-label="Open fairness verification panel"`. `min-h-11 min-w-11` touch target.
- `frontend/src/components/verification-drawer.tsx` — shadcn `Sheet side="right"`. `open` bound to `useFairnessStore(state => state.drawerOpen)`; `onOpenChange` calls `closeDrawer()`. `SheetContent` is `w-[420px] max-w-[calc(100vw-32px)]` with `motion-reduce:transition-none` and inline `style={{ transitionDuration }}` driven by `getConfig().drawer.slideMs`. Locked `SheetTitle="Fairness verification"` + `SheetDescription="Hashed in your browser. No server trust required."`. Sections: current commitment block, separator, previous round (revealed serverSeed → in-browser SHA-256 → VerdictChip), VerificationExplainer, plain `<a href="/verify/{prevRoundId}">` link. Branches for `errorCode` (ROUND_NOT_YET_SETTLED neutral Alert + Retry, NETWORK destructive Alert + Retry, CRYPTO_UNAVAILABLE destructive Alert with no Retry since retrying won't fix a non-secure context).
- `frontend/src/routes/__root.tsx` — Replaced `<div data-slot="fairness-badge" aria-hidden className="h-6" />` placeholder with `<FairnessBadge />` inside the header `<div className="flex items-center gap-3">`. Added `<VerificationDrawer />` as sibling of `<main>` (still inside `QueryClientProvider`), placed before the `<Toaster />`. The drawer mounts once at root and persists across route navigation — Pitfall 5 invariant honored.
- 10 tests (5 fairness-badge + 5 verification-drawer) all PASS. The VerificationDrawer tests inject a stubbed `useVerifyPreviousImpl` so the network is never exercised in unit tests.

## Verification

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run test` (full FE suite) | 125 / 125 pass across 20 files (99 prior + 26 new) |
| `bunx vitest run src/components/hash-block.test.tsx src/components/verdict-chip.test.tsx` | 9 / 9 pass |
| `bunx vitest run src/features/fairness/use-verify-previous.test.ts` | 7 / 7 pass (including REQUIRED Pitfall 4 Test 7) |
| `bunx vitest run src/components/fairness-badge.test.tsx src/components/verification-drawer.test.tsx` | 10 / 10 pass |
| `grep -E '#[0-9a-fA-F]{3,6}'` on the four new component files | clean (exit 1) |
| `grep -q '<FairnessBadge' src/routes/__root.tsx` | FOUND |
| `grep -q '<VerificationDrawer' src/routes/__root.tsx` | FOUND |
| `grep 'data-slot="fairness-badge" aria-hidden' src/routes/__root.tsx` | NOT FOUND (placeholder replaced) |
| `grep -q 'Before each round, the server publishes a SHA-256 hash of a secret seed.' src/features/fairness/verification-explainer.tsx` | FOUND |
| `bun run lint` | 0 errors (pre-existing routeTree.gen.ts warning unrelated) |

## Deviations from Plan

**1. [Rule 3 — Blocking] FairnessBadge reads round.status, not the nonexistent useRoundStore.seedHash**

- **Found during:** Task 3 implementation (`useRoundStore` does not expose `seedHash`).
- **Issue:** The plan's `<interfaces>` block and Task 3 `<behavior>` said the FairnessBadge would read `useRoundStore` for `seedHash` to drive the dot pulse. The actual Phase 7 `round.store.ts` exposes `{ roundId, status, bettingEndsAt, roundStartedAt, crashValue }` — no `seedHash` field. `round.store.ts` is NOT in this plan's `files_modified`, so retroactively adding a field was out of scope.
- **Fix:** Derived `commitmentLive` from `status === "BETTING" || status === "RUNNING"`. This matches the UI-SPEC § State Matrix row exactly ("commitment live during BETTING/RUNNING → dot accent pulsing; between rounds → dot muted") — `status` is the authoritative observable signal that a round is in flight. When Phase 8's later plans (e.g. 08-06 `/verify/:roundId` route) push `seedHash` through `round.store`, a follow-up can widen the predicate; for the badge's visual contract, the current derivation is correct.
- **Files modified:** `frontend/src/components/fairness-badge.tsx`.
- **Commit:** `cb15f13`.

**2. [Rule 3 — Blocking] Drawer "Open full verification" link is a plain `<a>` instead of TanStack typed `<Link>`**

- **Found during:** Task 3 implementation.
- **Issue:** The plan acknowledges this: "the route lands in Plan 08-06; the link target must compile against the file-based route registration — DO NOT block on the route file; tsc may temporarily fail until 08-06 lands, in which case use a plain `<a href={`/verify/${id}`}>` for now and migrate to typed Link in 08-06 follow-up."
- **Fix:** Used `<a href={`/verify/${previousRoundId}`}>` with accent-tinted classes + `ExternalLink` icon. 08-06 will migrate to `<Link to="/verify/$roundId">` after the route file lands.
- **Files modified:** `frontend/src/components/verification-drawer.tsx`.
- **Commit:** `cb15f13`.

**3. [Rule 3 — Blocking] HashBlock test uses fireEvent rather than `@testing-library/user-event`**

- **Found during:** Task 1 first test run.
- **Issue:** Initial draft of `hash-block.test.tsx` imported `@testing-library/user-event`, which is not in the frontend `devDependencies`. Vite import-analysis failed.
- **Fix:** Rewrote the click interactions using `fireEvent.click` wrapped in `act(async () => ...)` — matches the convention already used in `cashout-button.test.tsx` and other Phase 7 component tests. No new package install needed (T-07-SC honored).
- **Files modified:** `frontend/src/components/hash-block.test.tsx`.
- **Commit:** `b6ef588`.

**4. [Path-of-record, not a deviation] Drawer slideMs applied as inline `style={{ transitionDuration }}`**

- The shadcn-installed `sheet.tsx` (Plan 08-04) hardcodes `data-[state=closed]:duration-300 data-[state=open]:duration-500` in its className. Overriding via `getConfig().drawer.slideMs` requires either an inline `style` override or forking the shadcn primitive. The plan's action body anticipated this exact choice: "if shadcn doesn't expose a config knob, use an inline `style={{transitionDuration: ...}}` on the SheetContent OR document the default and skip the env override for v1 — confirm during execution." Inline `transitionDuration` was the minimal-surgery option and is honored.

No Rule-1, Rule-2, or Rule-4 deviations.

## Pitfall 4 fallback — provably tested

`useVerifyPrevious` wraps the call to `sha256OfHexEncodedSeed` in `try { ... } catch (err) { if (err instanceof TypeError) { setStatus("error"); setErrorCode("CRYPTO_UNAVAILABLE"); setErrorMessage("Browser cryptography unavailable. Open the app via http://localhost or HTTPS."); return; } throw err; }`. The drawer reads `errorCode === "CRYPTO_UNAVAILABLE"` and renders a destructive Alert without a Retry button (retrying won't recover from a non-secure context — the user must navigate to an HTTPS URL).

Test 7 exercises this end-to-end: `Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, get: () => undefined })` triggers a `TypeError: Cannot read properties of undefined (reading 'digest')` inside `sha256OfHexEncodedSeed` → the catch branch fires → `result.current.status === "error"` and `result.current.errorMessage === "Browser cryptography unavailable. Open the app via http://localhost or HTTPS."`. The test restores `crypto.subtle` in its cleanup so subsequent tests are not affected.

## Drawer mount preservation (Pitfall 5)

`<VerificationDrawer />` is mounted at `__root.tsx` as a sibling of the `<main>` wrapping `<Outlet />`, inside `QueryClientProvider`. Route changes mount/unmount the `<Outlet />` subtree but leave the drawer instance intact. This is the architectural invariant from D-01 and UI-SPEC § Layout Contract "the drawer is mounted at the root level so it overlays any route without unmounting".

## TooltipProvider hierarchy

The Phase 7 `__root.tsx` does not provide a global `TooltipProvider`. FairnessBadge mounts its own `TooltipProvider` directly, matching the per-surface pattern already in use. If a later plan introduces a global TooltipProvider at root, the local one can be removed without changing badge behavior (TooltipProvider composes safely).

## Unblocks

- **Plan 08-06** (`/verify/:roundId` route): the drawer's "Open full verification" link now points at the route path Plan 08-06 will register. After 08-06 lands, the `<a>` can be migrated to the typed `<Link>`.
- **Plan 08-08** (determinism E2E): the in-browser `sha256OfHexEncodedSeed` path is now exercised by Surface B in the running app, so the determinism E2E has a real consumer to anchor against.

## Self-Check: PASSED

- `frontend/src/components/hash-block.tsx` — FOUND
- `frontend/src/components/hash-block.test.tsx` — FOUND
- `frontend/src/components/verdict-chip.tsx` — FOUND
- `frontend/src/components/verdict-chip.test.tsx` — FOUND
- `frontend/src/components/fairness-badge.tsx` — FOUND
- `frontend/src/components/fairness-badge.test.tsx` — FOUND
- `frontend/src/components/verification-drawer.tsx` — FOUND
- `frontend/src/components/verification-drawer.test.tsx` — FOUND
- `frontend/src/features/fairness/use-verify-previous.ts` — FOUND
- `frontend/src/features/fairness/use-verify-previous.test.ts` — FOUND
- `frontend/src/features/fairness/verification-explainer.tsx` — FOUND
- `frontend/src/routes/__root.tsx` — FairnessBadge + VerificationDrawer mounted; placeholder removed
- Commit `b6ef588` (Task 1 feat) — FOUND in `git log`
- Commit `d9dcd57` (Task 2 feat) — FOUND in `git log`
- Commit `cb15f13` (Task 3 feat) — FOUND in `git log`
- `bunx tsc --noEmit` exit 0 — VERIFIED
- `bun run test` 125/125 green — VERIFIED
- Required Pitfall 4 Test 7 passes — VERIFIED
