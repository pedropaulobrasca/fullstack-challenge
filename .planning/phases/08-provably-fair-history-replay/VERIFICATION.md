---
phase: 08-provably-fair-history-replay
verified: 2026-05-30T01:05:00Z
status: human_needed
score: 5/5 must-haves verified (programmatic) + 4 manual smoke gates
overrides_applied: 0
human_verification:
  - test: "Fairness badge live UX during BETTING/RUNNING + click → drawer hashes prev seed via crypto.subtle and shows MATCH ✓"
    expected: "Badge visible in __root.tsx header throughout the round lifecycle; pulsing accent dot during commitmentLive; click opens shadcn Sheet (right); previousRoundId pulls from history.entries[0]; sha256OfHexEncodedSeed(seed) returns digest equal to serverSeedHash; VerdictChip shows MATCH within drawer.slideMs (no jank). Pitfall 4 fallback: served from non-secure origin → CRYPTO_UNAVAILABLE Alert."
    why_human: "Animated UI, real-time round transitions (BETTING→RUNNING→CRASHED), crypto.subtle availability gated on secure context — cannot be observed by static grep. Requires running app + at least one settled round in history."
  - test: "/verify/:roundId route with a live UUID — fetch → recompute → MATCH/MISMATCH within ~200ms"
    expected: "Navigating to /verify/<settled-uuid>: Inputs card renders serverSeed/clientSeed/nonce/formula from server; Computed-in-your-browser card renders HMAC hex + 13-hex slice + crashPoint.toFixed(2); VerdictChip is MATCH for honest rounds. The server `matches`/`recomputedCrashPoint` fields are NOT consumed by the hook (already confirmed via grep)."
    why_human: "Requires running games service + Kong route + a settled round UUID; status transitions (loading→computing→match) are time-dependent."
  - test: "History chip → Replay modal animates same canvas renderer at real-time speed"
    expected: "Click any history-chip → ReplayModal opens with <CrashCurve driver={makeReplayDriver(...)} />; the curve animates from 1x upward, freezes at the round's crashPoint; speed 1x/2x/4x toggle scales replay; bets[] overlay lists every bet with cashout multiplier + Money payout; same emerald→cyan glow as live game; no separate render path."
    why_human: "Visual fidelity of canvas animation, real-time speed correctness, frame rate, no glitches under playback — all require browsing + watching frames."
  - test: "Backend rebuild required for live verify flow — games service must run new VerifyRoundDto (Plan 08-02)"
    expected: "Plan 08-02 extended VerifyRoundDto with clientSeed, nonce, formulaVersion, previousServerSeed, bets[], growthRate. Run `docker compose build games && docker compose up -d games` before the FE verify route and ReplayModal can fetch a complete round. Without rebuild, the existing games image returns an older response shape and the new browser-side derivation hook will not find clientSeed/nonce."
    why_human: "Cannot verify by reading source — needs container restart. Document as a deploy step so recruiter does not see a stale response shape."
---

# Phase 8: Provably-Fair UX, History & Replay — Verification Report

**Phase Goal:** A player can prove every past round was fair by hashing the revealed seed in their own browser — no server trust required — and can replay any historical round byte-for-byte using the same canvas renderer the live game uses.
**Verified:** 2026-05-30
**Status:** human_needed (5/5 programmatic + 4 manual smoke gates)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (5 ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                          | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Always-visible Fairness badge during BETTING; click opens drawer that hashes prev round's revealed seed via `crypto.subtle` and shows MATCH ✓                                                  | ✓ VERIFIED | `frontend/src/components/fairness-badge.tsx` mounted in `__root.tsx` header (sibling of `<Outlet />`, never unmounts on route change). `verification-drawer.tsx` calls `useVerifyPrevious(previousRoundId)` which: fetches `/games/rounds/{id}/verify`, calls `sha256OfHexEncodedSeed(response.serverSeed)`, compares to `response.serverSeedHash`, sets verdict MATCH/MISMATCH; Pitfall 4 TypeError → `CRYPTO_UNAVAILABLE` Alert.       |
| 2   | `/verify/:roundId` route runs the provably-fair algorithm client-side via `crypto.subtle` and displays MATCH/MISMATCH — no server recomputation                                                | ✓ VERIFIED | `frontend/src/routes/verify.$roundId.tsx` mounts `VerifyPage`. `useRecomputeCrashpoint` calls `deriveCrashPointWithHmacHex({serverSeed, clientSeed, nonce, instantCrashBucket})` (browser HMAC-SHA-256 via `crypto.subtle.importKey`+`sign`). Compares `derived.crashPoint === response.crashPoint`. **Grep confirms zero references to server's `matches` or `recomputedCrashPoint` fields in the hook** — the client recomputes independently. |
| 3   | History chips have Replay button; modal animates the past round's curve at real-time speed using the SAME canvas renderer; bet/cashout overlays reconstructed from `bets[]`                    | ✓ VERIFIED | `history-strip.tsx` button `onClick={() => openReplay(entry.roundId)}` + lucide History icon + "Click to replay" tooltip. `replay-modal.tsx` mounts `<CrashCurve driver={driver} ariaLabel="Replay curve" />` — same `frontend/src/components/crash-curve.tsx` used by the live game. `makeReplayDriver({growthRate, crashPoint, speed, paused})` from `replay-driver.ts` plugs into `useRafCurve` via the same `RafCurveDriver` seam. `<ReplayOverlays bets={data.bets} />` renders cashout overlays with `Money.fromSnapshot(bet.amount)`. |
| 4   | Determinism E2E test reproduces the captured locked-round fixture and asserts byte-match against rendered multiplier values                                                                    | ✓ VERIFIED | `frontend/src/features/replay/determinism.test.ts` (5 tests, all pass): Test 1 anchors Phase 4 oracle (seed `0…01`, client `test`, nonce 0, bucket 101) → `crashPoint = 2.94` with `node:crypto.createHmac` sync fallback when `crypto.subtle` is unavailable (no `skipIf`). Test 2 deep-equals `multiplierAt(t, growthRate)` (live) vs `sampleReplayMultiplier(state, t)` (replay) across a 60-step × 16.6ms grid. Test 3 locks `sample(speed=k, t) === sample(speed=1, k*t)`. Test 5 enforces freeze at crashPoint past `crashTimeMs`. |
| 5   | README documents the algorithm with `curl` + third-party SHA-256 example so a recruiter can verify outside the app                                                                             | ✓ VERIFIED | `README.md` § "Provably Fair: Verify Outside the App" (lines 141–260) — step-A seed-hash commitment via `xxd -r -p | openssl dgst -sha256`, step-B HMAC-SHA-256 via `openssl dgst -sha256 -hmac "$SERVER_SEED"`, step-C python3 bustabit formula → `crashPoint = 2.94`. Includes the locked Phase 4 oracle tuple, Pitfall 1 + 2 byte-encoding explanation, MISMATCH-mode walkthrough (3.02), macOS/Linux toolchain notes.                  |

**Score:** 5/5 truths verified (programmatic) — all gated by human smoke checks for visual/real-time aspects.

### Required Artifacts

| Artifact                                                                                              | Expected                                                  | Status     | Details                                                                                       |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| `packages/contracts/src/provably-fair-browser/index.ts`                                               | Browser-safe subpath export                               | ✓ VERIFIED | Exports `deriveCrashPointAsync`, `deriveCrashPointWithHmacHex`, `sha256OfHexEncodedSeed`.    |
| `packages/contracts/src/provably-fair-browser/derive-crash-point.async.ts`                            | `crypto.subtle` HMAC-SHA-256 derivation                   | ✓ VERIFIED | `TextEncoder` + `importKey` + `sign` — Pitfall 1 (UTF-8 key) header documents byte contract. |
| `packages/contracts/src/provably-fair-browser/sha256.async.ts`                                        | Hex-decode + SHA-256 chain                                | ✓ VERIFIED | Pitfall 2 (chain proof hex-decoded) compatible with server `createHash().update(seed,"hex")`. |
| `frontend/src/components/fairness-badge.tsx`                                                          | Always-visible Fairness badge                             | ✓ VERIFIED | Mounted in `__root.tsx` AppHeader; sibling of `<Outlet />`.                                  |
| `frontend/src/components/verification-drawer.tsx`                                                     | Shadcn Sheet that hashes prev seed                        | ✓ VERIFIED | Sheet side="right"; `useVerifyPrevious` hook; cache via `fairness.store.verdicts`.            |
| `frontend/src/features/fairness/use-verify-previous.ts`                                               | Fetch + sha256 in browser                                 | ✓ VERIFIED | Status FSM idle→loading→computing→match/mismatch/error; CRYPTO_UNAVAILABLE catch.            |
| `frontend/src/features/fairness/fairness.store.ts`                                                    | Drawer + verdict cache                                    | ✓ VERIFIED | Zustand store with `verdicts: Map<roundId, "MATCH"\|"MISMATCH">`.                            |
| `frontend/src/routes/verify.$roundId.tsx`                                                             | `/verify/:roundId` route                                  | ✓ VERIFIED | `createFileRoute("/verify/$roundId")`; `ssr: false`; uuid-validated.                          |
| `frontend/src/features/verify/use-recompute-crashpoint.ts`                                            | Browser-side crashPoint derivation                        | ✓ VERIFIED | Calls `deriveCrashPointWithHmacHex`; never reads `matches` / `recomputedCrashPoint`.        |
| `frontend/src/components/replay-modal.tsx`                                                            | Replay modal mounting `<CrashCurve />`                     | ✓ VERIFIED | Mounted in `__root.tsx`; gated by `replay.store.roundId !== null`.                            |
| `frontend/src/features/replay/replay-driver.ts`                                                       | Driver injection for replay                               | ✓ VERIFIED | `makeReplayDriver` returns `RafCurveDriver` (same seam as live).                              |
| `frontend/src/features/replay/replay-overlays.tsx`                                                    | Bets[] cashout overlays                                   | ✓ VERIFIED | Renders each bet with `Money.fromSnapshot` payout + cashedOutMultiplier.                      |
| `frontend/src/features/replay/use-round-detail.ts`                                                    | Fetches `/games/rounds/:id/verify` w/ TanStack Query     | ✓ VERIFIED | Reuses `protectedFetch`; mapped errors not-settled/not-found/network.                         |
| `frontend/src/features/replay/__fixtures__/locked-round.fixture.ts`                                   | Phase 4 oracle fixture                                    | ✓ VERIFIED | seed `0…01`, client "test", nonce 0n, bucket 101 → crashPoint 2.94, growthRate 0.06.        |
| `frontend/src/features/replay/determinism.test.ts`                                                    | E2E byte-match proof                                      | ✓ VERIFIED | 5/5 pass (run by verifier).                                                                   |
| `services/games/src/presentation/dtos/verify-round.dto.ts`                                            | Extended DTO (clientSeed, nonce, formulaVersion, bets[], growthRate) | ✓ VERIFIED | strict zod schema; includes all browser-side derivation inputs.                                |
| `services/games/src/application/use-cases/verify-round.use-case.ts`                                   | Returns full VerifyRoundView                              | ✓ VERIFIED | 8 unit tests pass.                                                                            |
| `README.md` § Provably Fair                                                                           | curl/openssl/python3 recruiter walkthrough               | ✓ VERIFIED | Lines 141–260; locked Phase 4 oracle, both Pitfall 1/2 byte contracts documented.            |
| `.planning/adrs/ADR-028..031`                                                                         | Four Phase 8 ADRs                                         | ✓ VERIFIED | client-seed-deterministic, replay-reuses-canvas, browser-safe-subpath, replay-speed-selector. |

### Key Link Verification

| From                                                                | To                                                                | Via                                                                                       | Status                                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `FairnessBadge`                                                     | `fairness.store.openDrawer`                                       | `onClick={openDrawer}`                                                                    | WIRED                                                                                             |
| `VerificationDrawer`                                                | `useVerifyPrevious`                                               | `verify.previousServerSeed`, `verify.computedHash`, verdict via `pickVerdict(verify)`     | WIRED                                                                                             |
| `useVerifyPrevious`                                                 | `/games/rounds/:id/verify`                                        | `protectedFetch` + `defaultFetchVerify`                                                   | WIRED                                                                                             |
| `useVerifyPrevious`                                                 | `crypto.subtle` (browser SHA-256)                                 | `sha256OfHexEncodedSeed(response.serverSeed)`                                             | WIRED                                                                                             |
| `/verify/$roundId` page                                             | `useRecomputeCrashpoint`                                          | `state = useRecomputeImpl(validRoundId)`                                                  | WIRED                                                                                             |
| `useRecomputeCrashpoint`                                            | `deriveCrashPointWithHmacHex`                                     | imported from `@crash/contracts/provably-fair-browser`                                    | WIRED (server `matches`/`recomputedCrashPoint` NOT consumed — grep verified)                      |
| `HistoryStrip` chip                                                 | `replay.store.openReplay`                                         | `onClick={() => openReplay(entry.roundId)}`                                               | WIRED                                                                                             |
| `ReplayModal`                                                       | `<CrashCurve driver={driver} />`                                  | `<CrashCurve driver={makeReplayDriver(...)} />`                                           | WIRED — same component as live game                                                               |
| `makeReplayDriver`                                                  | `RafCurveDriver` seam                                             | returns `{multiplier, status, crashValue, shouldStop}` consumed by `useRafCurve`          | WIRED                                                                                             |
| `ReplayModal` (data)                                                | `useRoundDetail`                                                  | TanStack Query against `/games/rounds/:id/verify`                                         | WIRED                                                                                             |
| `ReplayOverlays`                                                    | `bets[]` from `useRoundDetail`                                    | `<ReplayOverlays bets={data.bets} />`                                                     | WIRED                                                                                             |
| `frontend` ↔ `@crash/contracts/provably-fair-browser` package subpath | browser-safe subpath export                                       | ESM subpath in `packages/contracts/package.json` (browser-only — no `node:crypto`)      | WIRED                                                                                             |

### Data-Flow Trace (Level 4)

| Artifact                              | Data Variable                       | Source                                                                              | Produces Real Data | Status     |
| ------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- | ------------------ | ---------- |
| `VerificationDrawer`                  | `verify.previousServerSeed/computedHash` | `useVerifyPrevious` → `defaultFetchVerify` → `/games/rounds/:id/verify` + `crypto.subtle` | Yes (server + browser) | ✓ FLOWING |
| `VerifyPage` (`/verify/$roundId`)     | `state.verifyResponse` + `state.computedCrashPoint/Hmac/First13` | `useRecomputeCrashpoint` → fetch + `deriveCrashPointWithHmacHex` | Yes                 | ✓ FLOWING |
| `ReplayModal` + `<CrashCurve />`      | `frame.multiplier`                  | `useRafCurve(renderFrame, driver)` → `makeReplayDriver({growthRate, crashPoint,...})` (data from `useRoundDetail`) | Yes                 | ✓ FLOWING |
| `ReplayOverlays`                      | `bets[]`                            | `useRoundDetail` → API verify response                                              | Yes                 | ✓ FLOWING |
| `FairnessBadge`                       | `mostRecentChip` + `commitmentLive` | `history.store.entries[0]` + `round.store.status` (WS-hydrated from Phase 7)        | Yes                 | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior                                                                       | Command                                                                                                  | Result                                              | Status  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------- |
| All frontend unit + component + integration tests pass                          | `cd frontend && bun run test`                                                                            | `28 files, 169 tests passed (169)` in 2.39s          | ✓ PASS |
| Determinism byte-match test (REQ-REPLAY-01)                                    | `cd frontend && bun run test src/features/replay/determinism.test.ts`                                    | `5/5 pass` (live `multiplierAt` ≡ `sampleReplayMultiplier`, oracle 2.94 locked) | ✓ PASS |
| Frontend TypeScript checks                                                      | `cd frontend && bunx tsc --noEmit`                                                                       | exit 0, zero output                                  | ✓ PASS |
| Frontend ESLint                                                                 | `cd frontend && bun run lint`                                                                            | `0 errors, 1 warning` (unrelated `routeTree.gen.ts` unused-disable) | ✓ PASS |
| Contracts tests (incl. browser-safe subpath)                                    | `cd packages/contracts && bun test`                                                                      | `4 files, 30 tests passed, 34130 expect()`           | ✓ PASS |
| Backend `verify-round.use-case.test.ts`                                        | `cd services/games && bun test tests/unit/verify-round.use-case.test.ts`                                 | `1 file, 8 tests passed, 34 expect()`                | ✓ PASS |
| Live FE verify drawer + replay modal end-to-end on running stack                | manual browser smoke                                                                                     | (deferred — see Human Verification)                  | ? SKIP |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared in Phase 8 plans or summaries; Phase 8 does not declare probes.

| Probe | Command | Result            | Status   |
| ----- | ------- | ----------------- | -------- |
| —     | —       | none configured   | N/A      |

### Requirements Coverage

| Requirement   | Source Plan(s)        | Description                                                                       | Status      | Evidence                                                                                                                                |
| ------------- | --------------------- | --------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-FE-09     | 08-04, 08-05          | Pre-round hash commitment badge + verification drawer (in-browser hash)           | ✓ SATISFIED | `FairnessBadge` in `__root.tsx`; `VerificationDrawer` runs `sha256OfHexEncodedSeed` via crypto.subtle.                                  |
| REQ-FE-10     | 08-06                 | `/verify/:roundId` runs algorithm via `crypto.subtle` — no server recomputation   | ✓ SATISFIED | `useRecomputeCrashpoint` calls `deriveCrashPointWithHmacHex`; grep confirms zero reads of server `matches`/`recomputedCrashPoint`.       |
| REQ-REPLAY-01 | 08-08                 | Byte-for-byte reproduction from `serverSeed + clientSeed + bets[]`                | ✓ SATISFIED | `determinism.test.ts` 5/5 — Phase 4 oracle anchored, live/replay multiplier byte-match, speed-time equivalence, freeze cap.            |
| REQ-REPLAY-02 | 08-07                 | Replay button on each history entry → modal                                       | ✓ SATISFIED | `history-strip.tsx` chip with `openReplay` + History icon + tooltip; `replay-modal.tsx` mounted at `__root`.                            |
| REQ-REPLAY-03 | 08-07                 | Replay reuses production canvas renderer                                          | ✓ SATISFIED | `<CrashCurve driver={makeReplayDriver(...)}>` — same component, driver-injection seam; `draw-curve.ts` byte-unchanged.                |

No orphaned requirements: REQUIREMENTS.md maps exactly 5 IDs to Phase 8, all claimed by Phase 8 plans, all satisfied.

### Anti-Patterns Found

| File                                                            | Line | Pattern                                                                                                     | Severity      | Impact                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/routes/verify.$roundId.tsx`                       | 91   | Hardcoded placeholder text: `# README example will land in Plan 08-09 — see README.md`                       | ⚠️ Warning    | Plan 08-09 DID land the README walkthrough, but the in-app `data-region="verify-recruiter-example"` `<pre>` block still shows this stale "will land" text. A recruiter using the route sees a TODO-feel placeholder instead of the actual curl example (or a clean inline link to README). Cosmetic, not a behavior gap. |
| `frontend/src/components/verification-drawer.tsx`               | 76   | Synthetic commitment hash placeholder: `commitment-for-${currentRoundId}` rendered when `currentRoundId !== null` | ℹ️ Info       | The drawer shows the literal string `commitment-for-<uuid>` as the "Commitment hash" for the current (live) round. The real commitment hash for the current round is `serverSeedHash` and is only known after settlement; this placeholder is intentional for the BETTING-phase UI but reads as fake to a recruiter. Recommend either label clarification ("commitment hash will be revealed when the round settles") or pulling the actual `serverSeedHash` from the round-state WS payload if it is broadcast pre-settlement. |
| (all other Phase 8 files)                                       | —    | Debt markers (`TBD`/`FIXME`/`XXX`) scan                                                                     | clean         | No debt markers in the Phase 8 file set.                                                                                                                                                                                                                                                                                |

### Human Verification Required

See `human_verification:` block in YAML frontmatter. Four manual smoke gates:

1. **Fairness badge + drawer end-to-end** — visual + crypto.subtle + Pitfall 4 fallback.
2. **`/verify/:roundId` live UX** — server fetch + browser HMAC + verdict rendering speed.
3. **History chip → ReplayModal canvas animation** — visual fidelity, 1x/2x/4x speed, overlays.
4. **Backend rebuild gate** — `docker compose build games && docker compose up -d games` must run before the new VerifyRoundDto fields (clientSeed, nonce, formulaVersion, bets[], growthRate) are served. Without rebuild, the replay & verify flows fail at the data layer despite all FE code being correct.

### Gaps Summary

No gaps blocking the phase goal. All five ROADMAP success criteria are satisfied by the codebase and exercised by passing automated tests (`169/169` frontend, `5/5` determinism, `8/8` verify-round backend, `30/30` contracts incl. browser subpath, tsc clean, lint clean). All five Phase 8 REQ-IDs (REQ-FE-09, REQ-FE-10, REQ-REPLAY-01/02/03) trace to concrete implementations with end-to-end wiring. ADR-028..031 recorded the four Phase 8 decisions. Money discipline is intact (`MoneySnapshot` + `Money.fromSnapshot` in overlays — no raw `number` for amounts). No hardcoded business constants (growthRate flows from server response, instantCrashBucket from `getConfig().fairness`, replay speeds from `getConfig().replay.speeds`).

Two cosmetic findings (both above) are recorded as warnings, not blockers:
- The `<pre>` recruiter-example placeholder in `verify.$roundId.tsx` should either be replaced with the real walkthrough (or a clean link to `README.md` § "Provably Fair: Verify Outside the App") before phase code-review.
- The `commitment-for-<uuid>` synthetic string in `verification-drawer.tsx` is intentional for the BETTING-phase view but should carry a clarifying label so it does not read as a stub.

Out-of-scope items (correctly NOT shipped): Phase 9 auto features (auto-cashout, auto-bet, stop-loss/stop-win, leaderboard) and Phase 10 Playwright LIVE-loop E2E. Phase 8 stays inside its boundary.

Final verdict: **Programmatic PASS (5/5)** with **four manual smoke gates** to be cleared by the developer before submission. Status set to `human_needed`.

---

_Verified: 2026-05-30T01:05:00Z_
_Verifier: gsd-verifier_
