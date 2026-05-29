# Phase 8: Provably-Fair UX, History & Replay - Context

**Gathered:** 2026-05-29
**Status:** Ready for planning

<domain>
## Phase Boundary

A player can prove every past round was fair by hashing the revealed seed in their own browser (no server trust) and can replay any historical round byte-for-byte using the same Canvas renderer the live game uses. Delivers REQ-FE-09, REQ-FE-10, REQ-REPLAY-01, REQ-REPLAY-02, REQ-REPLAY-03.

In scope: the always-visible Fairness badge in the game header (Phase 7 reserved the space), the verification side-drawer triggered by clicking the badge, the `/verify/:roundId` route running the provably-fair algorithm fully client-side via `crypto.subtle`, a Replay button on every history strip chip opening a modal that animates the past round on the SAME Canvas renderer used live, and a deterministic-replay E2E test asserting byte-match against captured live samples plus README documentation with a curl + third-party SHA-256 example.

Out of scope: auto-bet / auto-cashout / leaderboard (Phase 9), CI/observability/Playwright E2E for the LIVE loop (Phase 10 — note however that REQ-REPLAY E2E lives in this phase because it asserts renderer determinism).

</domain>

<decisions>
## Implementation Decisions

### Verification drawer UX
- **D-01:** Clicking the always-visible Fairness badge opens an **animated side-drawer** sliding in from the right. Drawer shows: current round's pre-round commitment hash (the `seedHash`), the previous round's revealed `serverSeed`, the in-browser SHA-256(`serverSeed`) hashed via `crypto.subtle`, a `MATCH ✓` / `MISMATCH ✗` verdict against the previous commitment, a one-paragraph explanation of provably-fair, and a link to `/verify/:roundId` for the current/previous round. Drawer does NOT block live gameplay (game continues animating behind).

### Replay UX
- **D-02:** Each history-strip chip gets a **Replay** affordance that opens a **modal** over the game. Modal contains the Canvas curve (REUSING the production renderer — same component, same draw function) plus reconstructed bet/cashout overlays from the round's `bets[]`. The live game continues rendering behind the modal. Closing the modal returns to the live game. Replay does NOT use a separate route.

### Replay controls
- **D-03:** Auto-start at **1x (real-time)** to satisfy ROADMAP success criterion 3 ("animating at real-time speed"). Provide **Play/Pause** + speed selector **1x / 2x / 4x**. Replay must remain deterministic at every speed — speed only changes the wall-clock rate at which the renderer reads the same `multiplierAt(growthRate, t)` curve; the sampled multiplier values at each underlying simulation tick are byte-identical to the original.

### Client-seed derivation strategy (locked by Phase 4 — recorded here, not re-litigated)
- **D-04:** Deterministic from the previous round's close (`deriveClientSeed(prev.id, prev.crashedAt)`) — already implemented in Phase 4 `services/games/src/application/client-seed.derivation.ts`. Player-contributed client seeds are explicitly OUT of v1 scope. This decision is what the Phase 8 verification drawer relies on: the previous round's revealed `serverSeed` + its known `clientSeed` + its `nonce` reproduce the crash point exactly.

### Renderer reuse (locked by Phase 7 ADR-025)
- **D-05:** Replay MUST reuse the production Canvas renderer (`features/game/crash-curve` + `draw-curve.ts`) — no separate playback code path. Replay is a different *driver* for the same renderer: instead of feeding it the live multiplier store, it feeds it a deterministic time-stepper that calls `multiplierAt(growthRate, t)` from `@crash/contracts/multiplier` for each frame. This is what makes the deterministic-replay E2E test possible (criterion 4).

### Browser-safe imports
- **D-06:** `crypto.subtle` for SHA-256 in the drawer + on `/verify` (no `node:crypto`). The provably-fair derivation lives in `@crash/contracts` — import via the **browser-safe subpath** established in Phase 7 (`@crash/contracts/multiplier` + any new `/provably-fair` subpath needed) so the root barrel never pulls `node:crypto` into the bundle. Confirm whether a `@crash/contracts/provably-fair` subpath already exists, and if not, add it as the very first plan task.

### Claude's discretion
- shadcn component choice for the drawer (sheet vs dialog), exact animation timings, replay-modal sizing, history-chip Replay affordance (icon-only on hover vs always-visible mini button), tooltip copy, the exact 1-paragraph provably-fair explainer text, README example wording.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` §"Phase 8: Provably-Fair UX, History & Replay" — goal, 5 success criteria, anticipated ADRs (numbering reconciled to ADR-028+ during planning — ADR-019..027 already taken)
- `.planning/REQUIREMENTS.md` — REQ-FE-09, REQ-FE-10, REQ-REPLAY-01, REQ-REPLAY-02, REQ-REPLAY-03 + "Open Configuration Values"

### Backend provably-fair contract (already shipped — FE consumes)
- `packages/contracts/` — provably-fair algorithm (`deriveCrashPoint`, `multiplierAt`, `FORMULA_VERSION`, hash chain derivation, Bustabit-canon formula). Confirm/create a `@crash/contracts/provably-fair` browser-safe subpath analogous to Phase 7's `@crash/contracts/multiplier`. ADR-015 (formula canon).
- `services/games/src/presentation/controllers/rounds.controller.ts` — `GET /games/rounds/:roundId/verify` endpoint (already in P4.08); `GET /games/rounds/:roundId` for the full settled round shape used by Replay.
- `services/games/src/application/use-cases/verify-round.use-case.ts` — what the verify endpoint returns (server seed revealed only after settle, per REQ-FAIR-02).
- `services/games/src/application/client-seed.derivation.ts` — the locked client-seed derivation (D-04).
- `.planning/adrs/ADR-015-*` (provably-fair formula), prior FAIR ADRs from Phase 4.

### Phase 7 carry-over (renderer + design)
- `frontend/src/features/game/` — `crash-curve.tsx` + `draw-curve.ts` + `use-raf-curve.ts` + `local-multiplier.ts` — the production renderer Replay MUST reuse (D-05). Decoupling the renderer from the live stores via a feeder interface may be needed.
- `.planning/adrs/ADR-025-canvas-2d-crash-curve.md` (renderer choice locked).
- `.planning/phases/07-frontend-vertical-slice/07-UI-SPEC.md` — header reserved space for the Fairness badge; dark-casino tokens to theme the drawer + modal.
- `.planning/phases/07-frontend-vertical-slice/07-09-SUMMARY.md` — ADR catalogue (next free = ADR-028).
- `CLAUDE.md` §Frontend — Canvas discipline + Money VO + no hardcoded business constants.

### README documentation target
- `README.md` — Phase 8 success criterion 5 requires a recruiter-runnable `curl` + third-party SHA-256 example proving fairness outside the app. Plan must touch README.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Production Canvas renderer (Phase 7)** is the single source of truth — Replay must reuse it. `draw-curve.ts` is pure (frame-state in, draw out); `use-raf-curve.ts` drives it from `useMultiplierStore`. For replay, drive the same `draw-curve` from a deterministic time-stepper instead of the live store. Refactor the renderer's input boundary to accept either driver without duplicating the draw code.
- **Provably-fair algorithm in `@crash/contracts`** — already pure, already used by the backend, already in the Phase 7 client bundle via the `multiplier` subpath. Add a `provably-fair` subpath if not yet exposed, to keep `node:crypto` out of the bundle.
- **Backend verify endpoint** ships the seed + nonce + crash point for any settled round; nothing new server-side needed for REQ-FE-10.
- **History strip (Phase 7)** already renders 20 chips with `roundId` keys — Replay button hangs off each chip.
- **Header badge slot (Phase 7)** already reserves space (UI-SPEC + index.tsx placeholder). Phase 8 fills it in.

### Established Patterns
- All FE business values via the typed `getConfig()` module — replay speeds (`1x / 2x / 4x`) and any frame-sampling rate for the determinism test should be env-tunable, not hardcoded.
- `Money` VO for bet/payout in replay overlays (never `number`).
- shadcn Sheet (drawer) + Dialog (modal) are already in the UI-SPEC component set.

### Integration Points
- Frontend route addition: `routes/verify.$roundId.tsx` (TanStack Router file-based) — runs verification via `crypto.subtle` against the verify-endpoint response.
- A history-chip Replay click opens the modal with the round's `serverSeed/clientSeed/nonce/bets[]` fetched on demand (REST GET `/games/rounds/:id` or the verify endpoint payload — confirm which carries `bets[]`).
- Drawer mounts in `__root.tsx` or inside the header so it can overlay any route without unmounting the game.

</code_context>

<specifics>
## Specific Ideas

- Verification drawer copy must include a one-paragraph plain-English explainer of provably-fair (what the commitment proves, why the player can trust it without trusting the server). Wording at researcher/planner discretion but should match the senior-tone of the rest of the UI.
- Replay determinism E2E (criterion 4): capture a live round's per-tick multiplier samples to a fixture during a single live run, then in CI feed the same `serverSeed + clientSeed + nonce` into the replay renderer and assert byte-equality. This is the centerpiece "proof" of the phase.
- README example uses `curl` against `localhost:8000/games/rounds/:id/verify` plus a `shasum -a 256` (or `echo … | openssl dgst -sha256`) to prove the seed hash matches the prior commitment — runnable from any recruiter's shell with no app context.

</specifics>

<deferred>
## Deferred Ideas

- Player-contributed client seeds (stretch only, not v1).
- Replay scrubber / timeline drag-to-seek (D-03 ships 1x/2x/4x play-pause only; scrubber is stretch).
- Per-bet visualization in the Replay modal beyond aggregate overlays (e.g. per-player highlight) — not in scope.
- `/verify/:roundId` shareable social card / OG image — Phase 10 if at all.

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 8-Provably-Fair, History & Replay*
*Context gathered: 2026-05-29*
