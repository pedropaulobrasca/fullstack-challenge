---
phase: 08-provably-fair-history-replay
plan: 06
subsystem: frontend-verify-route
tags: [verify, route, tanstack-router, ssr-false, hmac-sha256, crypto.subtle, a11y]
requirements:
  - REQ-FE-10
dependency_graph:
  requires:
    - "@crash/contracts/provably-fair-browser (deriveCrashPointWithHmacHex from Plan 08-01)"
    - frontend Plan 08-04 (getConfig().fairness.instantCrashBucket + shadcn alert/card)
    - frontend Plan 08-05 (HashBlock + VerdictChip + VerificationExplainer reused as-is)
  provides:
    - useRecomputeCrashpoint hook (fetches /verify endpoint, recomputes crashPoint via shared helper, ignores server matches/recomputedCrashPoint)
    - VerifyPage component + /verify/$roundId TanStack Router file-based route (ssr:false)
  affects:
    - Plan 08-07 (ReplayModal can mirror the route's recompute pattern if it needs a verdict)
    - Plan 08-08 (determinism E2E now has a real client-side recompute surface to anchor against)
    - Plan 08-09 (README recruiter example panel is mounted but empty — Plan 08-09 will populate it with the actual curl + shasum commands)
tech_stack:
  added: []
  patterns:
    - "Discriminated state machine for the recompute hook (idle | loading | computing | match | mismatch | not-settled | not-found | error) so the route renders one path per state without re-running the fetch."
    - "Hook accepts an optional fetchVerifyImpl dependency-injection seam so the route tests stub the network without touching protectedFetch."
    - "Hook returns a tagged-union fetch result ({ kind: 'ok' | 'not-settled' | 'not-found' | 'error' }) so the 404/400/200 paths stay type-safe and explicit at the boundary."
    - "TypeError catch around deriveCrashPointWithHmacHex locks the Pitfall 4 (crypto.subtle undefined in non-secure context) fallback at the boundary — Test 9 mocks crypto.subtle = undefined and asserts the locked copy. Single source of truth: the helper from Plan 08-01 anchors the byte-encoding; the route never duplicates crypto.subtle.importKey/sign."
    - "Route file-based at routes/verify.\$roundId.tsx with ssr:false (matches routes/index.tsx precedent). z.string().uuid().safeParse short-circuits the not-found path BEFORE any fetch when the path param is invalid (Test 5)."
key_files:
  created:
    - frontend/src/features/verify/use-recompute-crashpoint.ts
    - frontend/src/features/verify/use-recompute-crashpoint.test.ts
    - frontend/src/routes/verify.$roundId.tsx
    - frontend/src/routes/verify.roundid.test.tsx
  modified:
    - frontend/src/routeTree.gen.ts
decisions:
  - "Route file-based at routes/verify.\$roundId.tsx with ssr:false matches the routes/index.tsx precedent. The TanStack Router plugin regenerated routeTree.gen.ts to register the new route — committed in the same atomic commit as the route file."
  - "HMAC hex display is sourced from deriveCrashPointWithHmacHex's tagged return value ({ crashPoint, hmacHex, first13Hex }). The route never duplicates crypto.subtle.importKey/sign — the byte-encoding contract (UTF-8 bytes of the hex string as HMAC key, Pitfall 1) is anchored ONCE in Plan 08-01's computeHmacHexInternal. Grep gate `! grep -E 'crypto\\.subtle\\.(importKey|sign)' src/features/verify/use-recompute-crashpoint.ts` is enforced."
  - "Hook IGNORES response.matches and response.recomputedCrashPoint by design (REQ-FE-10 — no server recomputation trust). Grep gate `! grep -E '\\.matches\\b|\\.recomputedCrashPoint' src/features/verify/use-recompute-crashpoint.ts` enforces this at the source level, and Test 4 (server claims matches=false + recomputedCrashPoint=1.0 but the browser recomputes the correct value against the seeds — verdict still MATCH) proves it behaviorally."
  - "VerifyPage exported separately from the file-based Route wrapper so tests can render the page with an injected useRecomputeImpl without setting up a full router. The Route export uses createFileRoute(...).component = VerifyRoutePage which calls Route.useParams() and forwards to VerifyPage."
  - "Route tests use createRouter + createMemoryHistory with an injected route component instead of importing the file-based Route directly. The fileBased Route requires the routeTree at runtime, which doesn't exist in the vitest context. The (Route as unknown).update() pattern from TanStack Router's test utilities lets us bind the route to a fresh root tree."
  - "instantCrashBucket consumed from getConfig().fairness.instantCrashBucket (Plan 08-04 shipped this env key in wave 1). The route does NOT touch frontend/.env.example or frontend/src/lib/config.ts — Plan 08-04 ownership boundary respected; grep gate confirmed clean."
  - "Drawer's 'Open full verification' migration to typed `<Link to=\"/verify/\$roundId\">` was DEFERRED to Plan 08-10 closeout (success criterion explicitly allowed deferral if non-trivial). Migrating to typed Link breaks the existing verification-drawer.test.tsx (5 tests) because TanStack `<Link>` requires a router context that the drawer-in-isolation tests don't provide. The plain `<a href={`/verify/${id}`}>` still resolves to the route correctly (full page nav) — the only sacrifice is type-safety at the link site. Tracked as a follow-up; the route URL is byte-stable now."
  - "Recruiter-example panel is mounted with a placeholder `# README example will land in Plan 08-09 — see README.md` comment. UI-SPEC Surface C mandates the panel exists with monospace block + copy affordance; the EXACT shell commands land in Plan 08-09. The panel scaffold is in place so 08-09 can drop the content without restructuring."
metrics:
  duration_minutes: 12
  completed_date: 2026-05-30
  tasks_total: 2
  tasks_complete: 2
  files_created: 4
  files_modified: 1
  tests_added: 15
  tests_total_after: 140
---

# Phase 8 Plan 06: /verify/$roundId Route + useRecomputeCrashpoint Hook Summary

Added the `/verify/$roundId` TanStack Router file-based route per UI-SPEC Surface C. The route runs HMAC-SHA-256 + the Bustabit formula fully in-browser via `deriveCrashPointWithHmacHex` from `@crash/contracts/provably-fair-browser` (Plan 08-01 anchor), compares the locally-recomputed `crashPoint` against the value reported by the server, and renders `MATCH ✓` or `MISMATCH ✗` with icon + text + theme color + `aria-live` (assertive for mismatch). The hook IGNORES the server's `matches` and `recomputedCrashPoint` fields by design — REQ-FE-10 is the "no server recomputation trust" requirement, enforced at the source level via grep gates and behaviorally via Test 4. The required **Pitfall 4 fallback** (Test 9) is locked: when `crypto.subtle` is undefined in a non-secure context, the helper throws `TypeError` and the route surfaces the locked copy `"Browser cryptography unavailable. Open the app via http://localhost or HTTPS."` (same string as Plan 08-05's drawer fallback — single source of truth).

## What landed

### Task 1: useRecomputeCrashpoint hook (commit `0c6fe1b`)

- `frontend/src/features/verify/use-recompute-crashpoint.ts` exports `useRecomputeCrashpoint(roundId: string | null, deps?: { fetchVerifyImpl?: ... }): RecomputeState`.
- State shape: `{ status: "idle" | "loading" | "computing" | "match" | "mismatch" | "not-settled" | "not-found" | "error"; verifyResponse; computedCrashPoint; computedHmacHex; computedFirst13Hex; errorMessage; retry }`.
- Effect on `[roundId, version]`:
  1. `roundId === null` → status `idle`, all fields reset.
  2. Fetch via `protectedFetch('/games/rounds/${roundId}/verify')` (or the injected `fetchVerifyImpl`); the fetch returns a tagged union `{ kind: 'ok' | 'not-settled' | 'not-found' | 'error' }`.
  3. `kind === 'not-settled'` → status `not-settled`; `'not-found'` → status `not-found`; `'error'` → status `error` + locked NETWORK_COPY; thrown network error → same as `'error'` branch.
  4. `kind === 'ok'` → store the response, set status `computing`, await `deriveCrashPointWithHmacHex({ serverSeed, clientSeed, nonce: BigInt(response.nonce), instantCrashBucket: getConfig().fairness.instantCrashBucket })`.
  5. **Pitfall 4 try/catch** — if `TypeError` → status `error` + locked CRYPTO_UNAVAILABLE_COPY (single source of truth with Plan 08-05); any other thrown error rethrows.
  6. Compare `derived.crashPoint === response.crashPoint` → status `match` or `mismatch`. Server's `matches`/`recomputedCrashPoint` NEVER read.
- `retry()` bumps a version counter to re-trigger the effect.
- 9 tests all PASS — Tests 1-3 (idle / locked-byte MATCH / tampered MISMATCH), **Test 4** (server claims matches=false + recomputedCrashPoint=1.0 but browser still reports MATCH — proves the server's verdict fields are ignored), Tests 5-7 (not-settled / not-found / network error with locked copy), Test 8 (retry() re-fires), **Test 9** (Pitfall 4 — `crypto.subtle = undefined` → locked CRYPTO_UNAVAILABLE_COPY).

### Task 2: /verify/$roundId route (commit `c12ea70`)

- `frontend/src/routes/verify.$roundId.tsx` declares `createFileRoute("/verify/$roundId")({ ssr: false, component: VerifyRoutePage })`. The component reads `Route.useParams()`, then forwards to an exported `VerifyPage` so tests can render it directly with an injected `useRecomputeImpl`.
- Layout: max-width `min(720px, 100vw - 64px)` centered, py-12. Header: heading `"Verifying Round #{shortId}"` (last 8 chars of the UUID) + back-link to `/`.
- `z.string().uuid().safeParse(roundId)` runs BEFORE the hook is called with the round id — if the param is not a UUID the hook gets `null` (status `idle`) and the route short-circuits to the destructive `NotFoundAlert` without firing the fetch (**Test 5**: mock impl call args all `null`).
- Three Cards when `match`/`mismatch`:
  1. **Inputs (from server)** — HashBlocks for serverSeed + clientSeed; mono rows for nonce + formula (mapped from `formulaVersion` via a constants table; `1 → "bustabit-52bit-instant-101"`).
  2. **Computed in your browser** (subhead "HMAC-SHA-256(serverSeed, clientSeed:nonce)") — HashBlock for full HMAC hex + 52-bit slice (first 13 hex) + the computed crash point in Fira Code tabular `Nx`.
  3. **Reported by server** — server's `crashPoint` in the same Fira Code tabular treatment.
- `VerdictChip` below the cards with EXACT locked copy `"MATCH · Computed crash point equals reported crash point"` (aria-live=polite) or `"MISMATCH · Computed crash point differs from reported"` (aria-live=assertive — UI-SPEC Surface C escalation).
- Loading state: 3 skeleton Cards (curve/inputs/verdict sections), no spinner.
- **NotSettledAlert** (status `not-settled`): default-variant shadcn `Alert` (NOT destructive — UI-SPEC explicitly says this is expected). Title "Round not yet revealed". Body locked copy `"This round has not crashed yet. The serverSeed will be revealed automatically after it settles."` + `Refresh` Button (`window.location.reload`) + `"Go to live game"` Link.
- **NotFoundAlert** (status `not-found` OR invalid UUID): destructive variant. Title `"Round #{shortId} not found."` + Back-to-game Link.
- **ErrorAlert** (status `error`): destructive variant. Title "Couldn't load round data." Body `state.errorMessage` (CRYPTO_UNAVAILABLE or NETWORK locked copies). `Retry` Button calling `state.retry()`.
- **VerificationExplainer** (reused from Plan 08-05 — single source of truth for the locked paragraph) under heading "How this works".
- Recruiter-example panel scaffold under heading "Verify outside the app" with placeholder mono block.
- 6 tests all PASS — Test 1 (locked-byte MATCH renders three cards + chip with EXACT copy + formula name), Test 2 (MISMATCH with `aria-live="assertive"`), Test 3 (not-settled with EXACT copy + Refresh + Go-to-live-game), Test 4 (not-found with back-to-game), Test 5 (invalid UUID → not-found WITHOUT fetch), Test 6 (locked explainer paragraph renders).

## Verification

| Check | Result |
| --- | --- |
| `bunx tsc --noEmit` | exit 0 |
| `bun run test` (full FE suite) | 140 / 140 pass across 22 files (125 prior + 15 new) |
| `bunx vitest run src/features/verify/use-recompute-crashpoint.test.ts` | 9 / 9 pass (incl. REQUIRED Pitfall 4 Test 9) |
| `bunx vitest run src/routes/verify.roundid.test.tsx` | 6 / 6 pass |
| `grep -q 'deriveCrashPointWithHmacHex' src/features/verify/use-recompute-crashpoint.ts` | FOUND |
| `grep -q '@crash/contracts/provably-fair-browser' src/features/verify/use-recompute-crashpoint.ts` | FOUND |
| `! grep -E 'crypto\.subtle\.(importKey\|sign)' src/features/verify/use-recompute-crashpoint.ts` | clean (helper anchor enforced) |
| `! grep -E '@crash/contracts/provably-fair["'"'"']' src/features/verify/use-recompute-crashpoint.ts` | clean (no server-only path) |
| `! grep -E '\.matches\b\|\.recomputedCrashPoint' src/features/verify/use-recompute-crashpoint.ts` | clean (server verdict fields ignored) |
| `grep -q 'createFileRoute' src/routes/verify.$roundId.tsx` | FOUND |
| `grep -q 'ssr: false' src/routes/verify.$roundId.tsx` | FOUND |
| `! grep -E '#[0-9a-fA-F]{3,6}' src/routes/verify.$roundId.tsx` | clean (theme tokens only) |
| `git diff` does not touch `frontend/.env.example` / `frontend/src/lib/config.ts` / `config.test.ts` | confirmed (Plan 08-04 ownership boundary respected) |
| `bun run lint` | 0 errors (pre-existing routeTree.gen.ts unused-directive warning unrelated) |
| routeTree.gen.ts | regenerated by TanStack Router plugin — registers `/verify/$roundId` with proper id/path/fullPath/parentRoute |

## Deviations from Plan

**1. [Rule 3 — Blocking] Drawer "Open full verification" link migration to typed `<Link>` deferred to Plan 08-10 closeout**

- **Found during:** Task 2 closeout.
- **Issue:** Success criteria mention migrating the Plan 08-05 drawer link from `<a href={`/verify/${id}`}>` to `<Link to="/verify/$roundId" params={...}>` now that the route is registered. Migrating triggered failures in `verification-drawer.test.tsx` (5 tests) because TanStack Router's `useLinkProps` reads `routerContext` from the React tree, and the drawer-in-isolation tests don't render inside a `RouterProvider`. The fix would require either wrapping the drawer tests in a memory router (non-trivial — would also need to mock the route tree) or extracting the link into its own component that the drawer tests can pass through. Neither is in this plan's scope.
- **Fix:** Reverted the drawer file to its 08-05 state. The plain `<a href={`/verify/${id}`}>` still navigates to the route correctly (full-page navigation through the browser's URL bar — the route handler runs and the same `useRecomputeCrashpoint` flow fires). The only sacrifice is build-time type-safety on the link string. Success criterion explicitly allowed deferral: "OK to defer to closeout if non-trivial."
- **Files modified:** `frontend/src/components/verification-drawer.tsx` (no-op net change).
- **Commit:** none (final state matches 08-05 commit `cb15f13`).
- **Follow-up:** Plan 08-10 closeout should either wrap the drawer tests in a memory router or extract a `<VerifyRouteLink />` indirection that swallows the router-context dependency.

**2. [Rule 3 — Blocking] Route tests use `(Route as unknown).update()` to bind to a fresh root tree**

- **Found during:** Task 2 test authoring.
- **Issue:** Importing the file-based `Route` directly into a vitest context fails because TanStack Router needs the route to be part of an active route tree with a router instance. Rendering `<VerifyPage roundId={...} />` directly (the pattern hinted in the plan's "render `<VerifyPage />` directly while mocking `Route.useParams`") still needs a router context because the page renders TanStack `<Link>` elements internally for the back-to-game / not-found / not-settled CTAs.
- **Fix:** Use `createRootRoute({ component: <Outlet /> }) + Route.update({ component: ChildPage, getParentRoute: ... }) + createRouter({ routeTree, history: createMemoryHistory(...) }) + <RouterProvider />`. The `(Route as unknown as { update }).update(...)` cast satisfies the TS narrowing since TanStack Router's update method signatures change between point releases. This is a small, well-localized cast and matches the documented test-harness pattern for file-based routes.
- **Files modified:** `frontend/src/routes/verify.roundid.test.tsx`.
- **Commit:** `c12ea70`.

**3. [Path-of-record, not a deviation] routeTree.gen.ts regeneration committed alongside route file**

- The TanStack Router Vite plugin regenerates `frontend/src/routeTree.gen.ts` whenever a route file is added. The regen ran during `bunx tsc --noEmit` (the plugin hooks into the type-check). The regen is a deterministic function of the routes directory, so committing it alongside `routes/verify.$roundId.tsx` in the same atomic commit (`c12ea70`) is the correct discipline — the route file alone would fail in CI where the plugin would regenerate routeTree differently.

No Rule-1, Rule-2, or Rule-4 deviations.

## Pitfall 4 fallback — provably tested (Test 9)

`useRecomputeCrashpoint` wraps `deriveCrashPointWithHmacHex(...)` in `try { ... } catch (err) { if (err instanceof TypeError) { setStatus("error"); setErrorMessage(CRYPTO_UNAVAILABLE_COPY); return; } throw err; }`. The locked copy `"Browser cryptography unavailable. Open the app via http://localhost or HTTPS."` is byte-equal to the copy in Plan 08-05's `use-verify-previous.ts` (single source of truth — both surface the same error to the user across drawer + route).

Test 9 exercises this end-to-end: `Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, get: () => undefined })` triggers a `TypeError: Cannot read properties of undefined (reading 'importKey')` inside the helper → the catch branch fires → `result.current.status === "error"` and `result.current.errorMessage === "Browser cryptography unavailable. Open the app via http://localhost or HTTPS."`. The test restores `crypto.subtle` in its cleanup so subsequent tests are not affected.

## No server-verdict trust (REQ-FE-10) — provably tested (Test 4)

Test 4 mocks the verify endpoint to return `{ ...lockedResponse, matches: false, recomputedCrashPoint: 1.0 }`. The hook NEVER reads either field — `result.current.computedCrashPoint === 2.94` (browser recompute) and `result.current.status === "match"` because `2.94 === response.crashPoint`. If the hook had trusted the server's `matches: false` field, this test would have failed with status `"mismatch"`. The grep gate `! grep -E '\.matches\b|\.recomputedCrashPoint' src/features/verify/use-recompute-crashpoint.ts` is the source-level guard against a future maintainer adding the read; Test 4 is the behavioral guard.

## Unblocks

- **Plan 08-07** (ReplayModal): the verify route demonstrates the deterministic stepper pattern the modal will mirror — same `deriveCrashPointWithHmacHex` helper, same `getConfig().fairness.instantCrashBucket`, same Pitfall 4 fallback. The modal can refactor toward a shared `useRecomputedRound` helper if 08-07 sees value.
- **Plan 08-08** (determinism E2E): the route is a real consumer of `deriveCrashPointWithHmacHex` reachable from a browser navigation — the E2E test can drive `/verify/{settledRoundId}` and assert byte-equality against the server response.
- **Plan 08-09** (README): the recruiter-example panel is mounted with a placeholder waiting for the actual `curl` + `shasum` commands to drop in.
- **Plan 08-10** (closeout): the drawer's `<a>` → typed `<Link>` migration is documented as a follow-up.

## Self-Check: PASSED

- `frontend/src/features/verify/use-recompute-crashpoint.ts` — FOUND
- `frontend/src/features/verify/use-recompute-crashpoint.test.ts` — FOUND
- `frontend/src/routes/verify.$roundId.tsx` — FOUND
- `frontend/src/routes/verify.roundid.test.tsx` — FOUND
- `frontend/src/routeTree.gen.ts` references `verify.$roundId` (13 matches) — FOUND
- Commit `0c6fe1b` (Task 1 feat) — FOUND in `git log`
- Commit `c12ea70` (Task 2 feat) — FOUND in `git log`
- `bunx tsc --noEmit` exit 0 — VERIFIED
- `bun run test` 140/140 green — VERIFIED
- Required Pitfall 4 Test 9 passes — VERIFIED
- Required Test 4 (server matches=false ignored) passes — VERIFIED
- Source grep gates clean (no crypto.subtle inline, no .matches/.recomputedCrashPoint reads, no server-only contracts path) — VERIFIED

## Threat Flags

None — the route adds a new HTTP GET surface that already existed at the server boundary (`/games/rounds/:id/verify` was extended in Plan 08-02 and consumed by the drawer in 08-05). The route's trust posture is INVERSE — it reads only inputs (`serverSeed`, `clientSeed`, `nonce`, `crashPoint`) and runs the algorithm locally, deliberately ignoring the server's stated verdict (`matches`, `recomputedCrashPoint`). Threat T-08-18 / T-08-18b / T-08-18c / T-08-19 / T-08-21 from the plan's threat register are all mitigated (grep gates + Test 4 + Test 9 + UUID safeParse before fetch + grep gate on .matches/.recomputedCrashPoint).
