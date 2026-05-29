# Phase 8: Provably-Fair UX, History & Replay — Research

**Researched:** 2026-05-29
**Domain:** Browser-side cryptography (SubtleCrypto SHA-256 + HMAC-SHA-256), deterministic Canvas-2D replay driver, TanStack Router dynamic-param route, shadcn Sheet/Dialog/ToggleGroup composition over a live game.
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — Verification drawer UX.** Clicking the always-visible Fairness badge opens an **animated side-drawer** sliding in from the right. Drawer shows: current round's pre-round commitment hash (`seedHash`), the previous round's revealed `serverSeed`, the in-browser SHA-256(`serverSeed`) hashed via `crypto.subtle`, a `MATCH ✓` / `MISMATCH ✗` verdict against the previous commitment, a one-paragraph explainer of provably-fair, and a link to `/verify/:roundId` for the current/previous round. Drawer does NOT block live gameplay (game continues animating behind).

**D-02 — Replay UX.** Each history-strip chip gets a **Replay** affordance that opens a **modal** over the game. Modal contains the Canvas curve (REUSING the production renderer — same component, same draw function) plus reconstructed bet/cashout overlays from the round's `bets[]`. The live game continues rendering behind the modal. Closing the modal returns to the live game. Replay does NOT use a separate route.

**D-03 — Replay controls.** Auto-start at **1x (real-time)** to satisfy ROADMAP success criterion 3 ("animating at real-time speed"). Provide **Play/Pause** + speed selector **1x / 2x / 4x**. Replay must remain deterministic at every speed — speed only changes the wall-clock rate at which the renderer reads the same `multiplierAt(growthRate, t)` curve; sampled multiplier values at each underlying simulation tick are byte-identical to the original.

**D-04 — Client-seed derivation (locked by Phase 4).** Deterministic from the previous round's close (`deriveClientSeed(prev.id, prev.crashedAt)`) — already implemented in `services/games/src/application/client-seed.derivation.ts`. Player-contributed client seeds OUT of v1 scope.

**D-05 — Renderer reuse (locked by Phase 7 ADR-025).** Replay MUST reuse the production Canvas renderer (`features/curve/crash-curve` + `draw-curve.ts`) — no separate playback code path. Replay is a different *driver* for the same renderer: instead of feeding it the live multiplier store, it feeds it a deterministic time-stepper that calls `multiplierAt(growthRate, t)` from `@crash/contracts/multiplier` for each frame.

**D-06 — Browser-safe imports.** `crypto.subtle` for SHA-256 in the drawer + on `/verify` (no `node:crypto`). The provably-fair derivation lives in `@crash/contracts` — import via the **browser-safe subpath** established in Phase 7 (`@crash/contracts/multiplier` + any new `/provably-fair` subpath needed) so the root barrel never pulls `node:crypto` into the bundle. Confirm whether a `@crash/contracts/provably-fair` subpath already exists, and if not, add it as the very first plan task.

### Claude's Discretion

- shadcn component choice for the drawer (sheet vs dialog) — RESEARCH recommends `Sheet side="right"` per UI-SPEC grounding.
- Exact animation timings — UI-SPEC already locks `VITE_DRAWER_SLIDE_MS=220` band.
- Replay-modal sizing — UI-SPEC locks `min(960px, 100vw-64px)` × `min(720px, 100vh-64px)` 16:11.
- History-chip Replay affordance — UI-SPEC locks lucide `History` 12px icon on the right edge; whole chip is the click target.
- Tooltip copy, 1-paragraph provably-fair explainer text, README example wording — RESEARCH provides defaults; planner refines.

### Deferred Ideas (OUT OF SCOPE)

- Player-contributed client seeds (stretch only).
- Replay scrubber / timeline drag-to-seek.
- Per-bet visualization in the Replay modal beyond aggregate overlays.
- `/verify/:roundId` shareable social card / OG image — Phase 10 if at all.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-FE-09 | Frontend renders the pre-round hash commitment in an always-visible badge; click opens a verification drawer. | Surface A (Fairness badge) + Surface B (Verification drawer) in UI-SPEC. `seedHash` is already emitted by the games service in `round:snapshot` + `round:started` (verified in `current-round.dto.ts:24`). Browser SHA-256 via `crypto.subtle.digest("SHA-256", ...)` — Mozilla MDN current API. |
| REQ-FE-10 | Frontend has a `/verify/:roundId` route that fetches the verify endpoint and runs the provably-fair algorithm in-browser via `crypto.subtle` — no server recomputation; result is `MATCH ✓` / `MISMATCH ✗`. | Backend `GET /games/rounds/:roundId/verify` exists at `services/games/src/presentation/controllers/rounds.controller.ts:59` returning `{serverSeed, serverSeedHash, clientSeed, nonce, crashPoint, recomputedCrashPoint, matches, previousServerSeed}`. FE must IGNORE the server's `matches/recomputedCrashPoint` fields and re-derive locally via `crypto.subtle.sign("HMAC", ...)` + the Bustabit formula to satisfy "no server recomputation" wording. TanStack Router file-based dynamic-param convention: `routes/verify.$roundId.tsx` accessed via `Route.useParams()`. |
| REQ-REPLAY-01 | System reproduces any past round byte-for-byte from `serverSeed + clientSeed + bets[]` — same multiplier curve, same crash point, same per-tick values. | Renderer is pure given a `(roundStartedAt, serverOffsetMs, growthRate)` triple — already deterministic via `multiplierAt(elapsedMs, growthRate) = Math.exp(growthRate * elapsedMs / 1000)`. The seam to add: a `multiplierSource: () => number` driver injected into `use-raf-curve.ts` so the live driver (existing) and a replay time-stepper driver share `draw-curve.ts`. The E2E test captures samples from one live run, replays the same seeds, asserts byte-equal sampled values. |
| REQ-REPLAY-02 | Frontend has a "Replay" button on each history entry that opens a modal showing the curve animating at real-time speed plus bet/cashout overlays. | Surface D (Replay modal) + Surface E (history chip affordance) in UI-SPEC. Existing `HistoryStrip` (`components/history-strip.tsx`) renders chips as `<button>` already — Phase 8 wires the click to open the Dialog with the chip's `roundId`. Auto-start at 1x per D-03. |
| REQ-REPLAY-03 | Replay reuses the production canvas renderer — no separate code path. | D-05 lock. Achieved by parameterizing `use-raf-curve.ts` with the driver injection seam (see § Architecture Patterns). `draw-curve.ts` stays untouched. The E2E test is the proof. |

</phase_requirements>

## Summary

Phase 8 is **mostly frontend**. The provably-fair algorithm is shipped in `@crash/contracts/src/provably-fair/` (Phase 4 ADR-015) and the backend `/verify` endpoint already returns every field the FE drawer + `/verify/:roundId` route need to recompute and compare. The two interesting technical problems are:

1. **Browser cryptography:** The drawer's "SHA-256(serverSeed)" proof and the `/verify` route's "HMAC-SHA-256(serverSeed, clientSeed:nonce)" derivation must run in the browser via `crypto.subtle` to satisfy REQ-FE-10's "no server recomputation" wording. Two byte-encoding traps exist (see Pitfall 1 + Pitfall 2). The existing `@crash/contracts/src/provably-fair/derive-crash-point.ts` uses `node:crypto` directly and CANNOT be imported in the browser bundle — the planner must add a new browser-safe subpath that re-implements the same algorithm against `crypto.subtle` (async) and exports a Promise-returning `deriveCrashPointAsync`.

2. **Renderer determinism via driver injection (D-05):** `use-raf-curve.ts` currently reads `round.store` + `multiplier.store` directly. To let Replay reuse the same renderer, the seam to add is a `multiplierSource: () => number` driver parameter (plus a `roundProjection: () => {status, crashValue}` for the crash-freeze branch). The live driver wraps the existing store reads; the replay driver wraps `multiplierAt(growthRate, replayElapsedMs)` against a wall-clock + speed multiplier. The crash point is reached deterministically because both `multiplierAt` and `replayElapsedMs` are pure given inputs.

There are **two backend gaps** the additional-context instructions did not flag:

- `@crash/contracts/provably-fair` browser-safe subpath does NOT exist. Only `@crash/contracts/multiplier` was added in Phase 7 (verified in `packages/contracts/package.json` exports). A new subpath is required as **plan 08-01**.
- **No `GET /games/rounds/:id` endpoint exists.** Replay needs `bets[]` for overlays per D-02 + UI-SPEC. The verify endpoint returns seeds + crash point but NOT bets. The cleanest fix is to **extend the verify endpoint's DTO** to include a `bets[]` array (settled-round-only; no PII leakage since playerId is already masked elsewhere). Kong's `~/games/rounds/[^/]+/verify$` route stays unchanged.

**Primary recommendation:** Plan 08-01 = new `@crash/contracts/provably-fair-browser` subpath with `crypto.subtle`-based `deriveCrashPointAsync` + `sha256HexAsync` + `sha256OfHexBytesAsync`. Plan 08-02 = extend `VerifyRoundDto` + `VerifyRoundUseCase` to include `bets[]` (BetSnapshot[]). Plan 08-03 = refactor `use-raf-curve.ts` to accept a `multiplierSource: () => number` driver. Plans 08-04..08-10 = UI surfaces + E2E test + README documentation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fairness badge state (commitment hash, between-rounds dim, recent-MATCH transient) | Browser (Zustand `round.store` + a new `fairness.store` for the verified-MATCH transient) | — | seedHash already arrives in `round:snapshot` / `round:started`; transient verified flag computed in-browser after a hash. Server has no view of "did the client successfully verify." |
| In-browser SHA-256(serverSeed) for the drawer's hash-chain proof | Browser (`crypto.subtle.digest`) | — | The whole point of provably-fair is the verification happens client-side; nothing to do server-side. |
| `/verify/:roundId` HMAC-SHA-256 + Bustabit formula recomputation | Browser (`crypto.subtle.sign` + pure-JS arithmetic) | API (read-only `/games/rounds/:id/verify` for inputs) | REQ-FE-10 explicitly forbids server recomputation. The browser must independently compute and compare. |
| Settled-round `bets[]` lookup for Replay overlays | API (extend `VerifyRoundUseCase` to include `bets[]`) | DB (existing `bets` table, indexed by `round_id`) | Server is the source of truth for what bets settled at what multiplier. FE only renders. |
| Replay multiplier sampling | Browser (deterministic stepper calling `multiplierAt(growthRate, replayElapsedMs)` from `@crash/contracts/multiplier`) | — | Pure math; no network round-trip per frame. |
| Renderer reuse for Replay | Browser (refactored `use-raf-curve.ts` with driver injection) | — | D-05 lock; ADR-025 locked Canvas-2D as the only renderer. |
| `/verify/:roundId` route mount | Frontend Server (SSR shell) | Browser (hydration + crypto computation) | TanStack Start's default SSR. The route also needs `ssr: false` opt-out (matching `routes/index.tsx`) because `crypto.subtle` is browser-only — running the HMAC on the server during SSR would change the round-trip semantics. |
| README recruiter-runnable example | Documentation | — | Pure shell commands (`curl` + `shasum`/`openssl dgst`). Independent of the app. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `crypto.subtle` (Web Crypto API) | Browser-native, Baseline widely available since Jan 2020 | SHA-256 digest (drawer) + HMAC-SHA-256 sign (`/verify` route) | The only correct choice in the browser. No npm dep. Async (`Promise<ArrayBuffer>`) — drawer UX must show a brief Skeleton during the ~5-30ms compute. `[VERIFIED: developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest + /sign]` |
| `@crash/contracts/multiplier` | workspace local | `multiplierAt(elapsedMs, growthRate)` for the replay time-stepper | Already browser-safe (verified `packages/contracts/package.json` exports `"./multiplier"`). Used by `frontend/src/features/curve/local-multiplier.ts`. `[VERIFIED: file inspection]` |
| `@crash/contracts/provably-fair-browser` (NEW — to be created in Plan 08-01) | workspace local | `deriveCrashPointAsync`, `sha256HexAsync`, `sha256OfHexEncodedSeed` | The existing `@crash/contracts/src/provably-fair/derive-crash-point.ts` imports `node:crypto` (verified at file line 1) — root barrel and `./provably-fair` subpath would leak `node:crypto` into the Vite bundle. Plan 08-01 adds a parallel browser implementation under `provably-fair-browser/` exported via `package.json` `"./provably-fair-browser": "./src/provably-fair-browser/index.ts"`. `[VERIFIED: file inspection of packages/contracts/src/provably-fair/derive-crash-point.ts:1 + package.json exports]` |
| shadcn `Sheet` (Radix Dialog under the hood, side="right") | shadcn-ui CLI v4, Radix `@radix-ui/react-dialog ^1.1.15` | Surface B verification drawer | shadcn-canonical; built-in focus trap + Esc-close + scroll-lock; UI-SPEC mandates `side="right"`. `[VERIFIED: npm view @radix-ui/react-dialog version → 1.1.15 + slopcheck OK]` |
| shadcn `Dialog` | already installed (Phase 7 set) | Surface D Replay modal | UI-SPEC reuses dialog. No reinstall. `[VERIFIED: frontend/src/components/ui/dialog.tsx exists]` |
| shadcn `ToggleGroup` (Radix `@radix-ui/react-toggle-group ^1.1.11`) | shadcn-ui CLI v4 | Replay speed selector `1x/2x/4x` (`type="single"`) | UI-SPEC: Tabs imply content swap, ToggleGroup is the semantic primitive for "pick one of N exclusive values." `[VERIFIED: npm view @radix-ui/react-toggle-group version → 1.1.11 + slopcheck OK]` |
| shadcn `Alert` | shadcn-ui CLI v4 | Inline error states inside drawer + `/verify` route + Replay modal | UI-SPEC: "error states are inline `Alert` cards with retry, `role='alert'`." Sonner toasts are reserved for live-game cross-cutting concerns. `[VERIFIED: shadcn registry has alert]` |
| `lucide-react` | `1.17.0` (already installed) | `ShieldCheck`, `CheckCircle2`, `XCircle`, `Copy`, `Check`, `Play`, `Pause`, `ExternalLink`, `History`, `Info` icons | Already the project icon set. UI-SPEC lists all 10 icons added in Phase 8. `[VERIFIED: frontend/package.json line `lucide-react: 1.17.0`]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` + `@testing-library/react` + `jsdom` | already installed (3 / 16 / 26) | Renderer determinism test (REQ-REPLAY-01 byte-match assertion) | Run the live driver + replay driver against a fixture array of `(elapsedMs, expectedMultiplier)` tuples; assert byte-equality. No Playwright needed because the determinism property is a pure-function property, not a browser-DOM property. `[VERIFIED: frontend/package.json devDeps]` |
| `Money` VO (`@crash/shared-kernel`) | workspace local | Bet/payout amounts in Replay overlays | CLAUDE.md mandate: no `number` for any monetary amount. Use `Money.fromSnapshot(snapshot)` as already established in Phase 7 `live-feed.tsx`. `[VERIFIED: CLAUDE.md §Coding standards + frontend uses Money.fromSnapshot in components/feed-row.tsx]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.subtle` (async) | `js-sha256` (sync) npm package (`v0.11.1` `[VERIFIED: npm view]`) | Sync API would eliminate the ~5-30ms drawer Skeleton pulse. But adds ~3KB to the bundle for functionality the browser already ships. **Reject:** crypto.subtle is Baseline-widely-available, and the ~10ms compute pulse actually *helps* UX criterion 1 ("makes 'hashed in YOUR browser' feel concrete"). |
| Async port of `deriveCrashPoint` to `crypto.subtle` | Bundle a pure-JS HMAC + SHA-256 (e.g. `js-sha256` + `js-sha256/hmac`) and keep the API synchronous | Sync = simpler tests; async = native. **Reject async-port in favor of async-port:** consistent with browser idiom + zero new deps. The verify-route can show a Skeleton for ~30ms while it awaits both `importKey` + `sign`. |
| Extending `VerifyRoundDto` with `bets[]` (RESEARCH recommendation) | Adding a new `GET /games/rounds/:id` endpoint that returns the full settled round + bets | Either path requires backend work + Kong route + auth + DTO. Extending the existing endpoint is one-touch — verify is already settled-only, Kong's regex `~/games/rounds/[^/]+/verify$` is unchanged, no new auth surface. **Recommend extend.** |
| Per-frame `multiplierAt` call in the replay stepper | Pre-sampling the curve into an array at modal open + reading by index | Pre-sampling forecloses the 1x/2x/4x speed flexibility (the array would need to be sampled at the finest grid). Pre-sampling is also unneeded — `multiplierAt` is `Math.exp` of a multiplication, sub-microsecond per call. **Reject pre-sampling.** |
| Refactoring `use-raf-curve.ts` to accept a driver | Building a separate `useReplayRafCurve` hook with duplicate rAF + clear/draw discipline | Duplication is the whole anti-pattern D-05 prohibits. The proposed seam is a 4-line diff: add a `multiplierSource?: () => number` optional parameter; default it to the existing store-reading closure. **Recommend refactor.** |

**Installation:**

```bash
bunx shadcn@latest add sheet toggle-group alert
```

(Per UI-SPEC: `dialog` already present from Phase 7. No new npm deps beyond what shadcn's add command pulls — radix toggle-group + radix-dialog peer transitively.)

**Version verification:**

```bash
npm view @radix-ui/react-toggle-group version    # → 1.1.11 [VERIFIED 2026-05-29]
npm view @radix-ui/react-dialog version          # → 1.1.15 [VERIFIED 2026-05-29]
npm view sonner version                          # → 2.0.7  [VERIFIED 2026-05-29; already installed at ^2.0.7]
```

All three pass `slopcheck install -e npm ...` (registry-verified, no SLOP, no SUS).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@radix-ui/react-toggle-group` | npm (v1.1.11) | ~5 years (Radix UI primitives since 2020) | millions/wk via shadcn ecosystem | github.com/radix-ui/primitives | OK | Approved (installed via `shadcn add toggle-group`) |
| `@radix-ui/react-dialog` | npm (v1.1.15) | ~5 years | millions/wk via shadcn ecosystem | github.com/radix-ui/primitives | OK | Approved (already installed; Sheet uses it; Replay Dialog reuses) |
| shadcn registry blocks (`sheet`, `toggle-group`, `alert`) | shadcn official registry (ui.shadcn.com) | mature | — | github.com/shadcn-ui/ui | n/a (source registry) | Approved (UI-SPEC § Registry Safety: "no third-party registry blocks") |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

(slopcheck was run with `-e npm` on the three radix packages and reported `[OK]` for all. The shadcn registry blocks are not npm packages — they generate source files via the shadcn CLI from a vetted official registry.)

## Architecture Patterns

### System Architecture Diagram

```
                    LIVE GAME (Phase 7, untouched behind D-01/D-02 overlay)
                          │
                          │ round:snapshot / round:started includes seedHash
                          ▼
         ┌─────────────────────────────────────────────────┐
         │  round.store (Zustand) — seedHash, roundId, …   │
         └────────────┬──────────────────────┬─────────────┘
                      │                      │
       FAIRNESS BADGE (Surface A)            HISTORY STRIP (Phase 7)
       Click → open Sheet                    Chip click → open Dialog with roundId
                      │                                              │
                      ▼                                              ▼
       ┌─────────────────────────────────┐   ┌──────────────────────────────────────┐
       │ VerificationDrawer (Surface B)  │   │ ReplayModal (Surface D)              │
       │ shadcn Sheet side="right"       │   │ shadcn Dialog                        │
       │                                 │   │                                       │
       │ Fetch /games/rounds/current     │   │ Fetch /games/rounds/{id}/verify      │
       │   (or use current round.store)  │   │   (extended in plan 08-02 to include │
       │ Fetch /games/rounds/{prev}/verify│   │   bets[])                            │
       │                                 │   │                                       │
       │ crypto.subtle.digest("SHA-256", │   │ ReplayDriver (deterministic stepper) │
       │   hex2bytes(serverSeed))        │   │   t = (Date.now()-startWall)*speed   │
       │   → verdict MATCH / MISMATCH    │   │   m = multiplierAt(growthRate, t)    │
       │                                 │   │   stop when m >= crashPoint          │
       │ Link → /verify/:prevRoundId     │   │                                       │
       └────────────┬────────────────────┘   │ <CrashCurve />  ← REUSED from P7     │
                    │                         │   driver = ReplayDriver              │
                    ▼                         │   (D-05 enforced by use-raf-curve    │
   ┌────────────────────────────────────┐    │    accepting multiplierSource)       │
   │ /verify/:roundId route             │    │                                       │
   │ (ssr:false)                        │    │ BetOverlays (from bets[])            │
   │                                    │    └──────────────────────────────────────┘
   │ Fetch /games/rounds/{id}/verify    │
   │                                    │
   │ crypto.subtle.sign("HMAC",         │
   │   importKey("raw",                 │   ┌──────────────────────────────────────┐
   │     utf8(serverSeed))) over        │   │  E2E DETERMINISM TEST (Vitest)        │
   │   utf8("clientSeed:nonce")         │   │                                       │
   │   → 13-hex slice → intH            │   │ 1. Capture: feed a fixture round into │
   │   → Bustabit formula or 1.00       │   │    use-raf-curve LIVE driver, sample  │
   │   → MATCH/MISMATCH vs server's     │   │    multiplierAt at fixed timestamps.  │
   │     crashPoint                     │   │ 2. Replay: feed same seeds into       │
   │                                    │   │    ReplayDriver, sample at same       │
   │ README example: curl + shasum      │   │    timestamps.                        │
   └────────────────────────────────────┘   │ 3. Assert: byte-equal sample arrays.  │
                                            └──────────────────────────────────────┘

   BACKEND (Phase 4 shipped):
     GET /games/rounds/:id/verify → VerifyRoundUseCase
       returns: { roundId, nonce, serverSeed, serverSeedHash, clientSeed,
                  crashPoint, recomputedCrashPoint, matches, formulaVersion,
                  previousServerSeed }
       Plan 08-02 EXTENDS this to add: bets: BetSnapshot[]
```

### Recommended Project Structure

```
packages/contracts/
└── src/
    ├── provably-fair/              # EXISTING (node:crypto) — server-only
    │   ├── derive-crash-point.ts   # uses createHmac → DO NOT import in frontend
    │   ├── verify-crash-point.ts
    │   ├── generate-seed-chain.ts
    │   ├── formulas.constants.ts   # FORMULA_VERSION, HEX_CHARS, TWO_POW_52
    │   ├── multiplier.ts           # already browser-safe (just Math.exp/log)
    │   └── types.ts
    └── provably-fair-browser/      # NEW — Plan 08-01
        ├── derive-crash-point.async.ts   # crypto.subtle.sign + Bustabit formula
        ├── sha256.async.ts                # crypto.subtle.digest helpers
        └── index.ts

  → packages/contracts/package.json exports adds:
    "./provably-fair-browser": "./src/provably-fair-browser/index.ts"

frontend/src/
├── features/
│   ├── curve/                       # EXISTING (Phase 7)
│   │   ├── use-raf-curve.ts        # REFACTOR: add multiplierSource driver param
│   │   ├── draw-curve.ts           # UNTOUCHED
│   │   └── local-multiplier.ts     # UNTOUCHED
│   ├── fairness/                    # NEW
│   │   ├── fairness.store.ts        # Zustand: recentlyVerifiedRoundId + transient flag
│   │   ├── use-verify-previous.ts  # SHA-256(prev.serverSeed) == current.seedHash
│   │   ├── verification-explainer.tsx
│   │   └── verdict-chip.tsx         # CheckCircle2 / XCircle / Skeleton
│   ├── replay/                      # NEW
│   │   ├── use-replay-driver.ts    # deterministic time-stepper hook
│   │   ├── use-replay-controls.ts  # play/pause/speed state
│   │   ├── replay-overlays.tsx     # bet/cashout overlays from bets[]
│   │   └── use-round-detail.ts     # TanStack Query for /games/rounds/:id/verify (+bets)
│   └── verify/                      # NEW
│       └── use-recompute-crashpoint.ts   # crypto.subtle HMAC + Bustabit formula
├── components/
│   ├── fairness-badge.tsx           # Surface A — fills the data-slot="fairness-badge" placeholder
│   ├── verification-drawer.tsx      # Surface B — shadcn Sheet
│   ├── replay-modal.tsx             # Surface D — shadcn Dialog with reused CrashCurve
│   ├── hash-block.tsx               # Mono Data + Copy button
│   └── replay-speed-toggle.tsx      # shadcn ToggleGroup wrapper
└── routes/
    └── verify.$roundId.tsx          # Surface C — TanStack Router dynamic-param route, ssr:false
```

### Pattern 1: Browser-safe contracts subpath (Plan 08-01)

**What:** Mirror `derive-crash-point.ts` in a `provably-fair-browser/` directory that swaps `createHmac` for `crypto.subtle.sign` and is `async`. Keep the Bustabit formula identical.

**When to use:** Any time the frontend needs to recompute a crash point (drawer's commitment proof, `/verify` route's full recomputation, the replay E2E test's seeded-derivation step).

**Example:**

```typescript
// packages/contracts/src/provably-fair-browser/derive-crash-point.async.ts
// Source: byte-equivalent port of src/provably-fair/derive-crash-point.ts; verified against
// services/games/src/application/use-cases/verify-round.use-case.ts:41-46

import { HEX_CHARS, TWO_POW_52 } from "../provably-fair/formulas.constants";
import type { DeriveCrashPointInput } from "../provably-fair/types";

export async function deriveCrashPointAsync(
  input: DeriveCrashPointInput,
): Promise<number> {
  // CRITICAL: backend uses createHmac("sha256", input.serverSeed) where input.serverSeed
  // is a hex string. Node's createHmac with a string key uses UTF-8 encoding of that string
  // as the key bytes. To match byte-for-byte, importKey must receive the same UTF-8 bytes,
  // NOT the hex-decoded 32-byte key.
  const keyBytes = new TextEncoder().encode(input.serverSeed);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const message = `${input.clientSeed}:${input.nonce.toString()}`;
  const messageBytes = new TextEncoder().encode(message);
  const sigBuf = await crypto.subtle.sign("HMAC", key, messageBytes);

  // Hex-encode the signature (toHex() is too new — Array.from fallback for safe browser support)
  const sigArr = Array.from(new Uint8Array(sigBuf));
  const hmacHex = sigArr.map((b) => b.toString(16).padStart(2, "0")).join("");

  const first13 = hmacHex.substring(0, HEX_CHARS);
  const intH = parseInt(first13, 16);

  if (intH % input.instantCrashBucket === 0) return 1.0;

  const crash = Math.floor((100 * TWO_POW_52 - intH) / (TWO_POW_52 - intH)) / 100;
  return Math.max(1.0, crash);
}
```

### Pattern 2: Driver injection seam for `use-raf-curve.ts` (Plan 08-03)

**What:** Add an optional `multiplierSource: () => number` (plus `roundProjection: () => RoundProjection`) parameter. Default to the existing store-reading closures so Phase 7 callers stay zero-diff.

**When to use:** Whenever a feature needs the renderer with a different multiplier source (Replay; potentially a future ghost-line stretch).

**Example (showing the seam, not a full rewrite):**

```typescript
// frontend/src/features/curve/use-raf-curve.ts — refactor sketch (PSEUDOCODE - actual implementation per planner)

export type RafCurveDriver = {
  multiplier: () => number;          // returns current multiplier for this frame
  status: () => RoundStatus;          // returns logical round status
  crashValue: () => number | null;    // returns freeze value when CRASHED
  shouldStop: () => boolean;          // true to cancel the rAF loop
};

const liveDriver: RafCurveDriver = {
  multiplier: () => {
    const round = useRoundStore.getState();
    if (round.status !== "RUNNING" || round.roundStartedAt === null) return 1;
    const offset = useMultiplierStore.getState().serverOffsetMs ?? 0;
    return localMultiplier(round.roundStartedAt, offset);
  },
  status: () => useRoundStore.getState().status,
  crashValue: () => useRoundStore.getState().crashValue,
  shouldStop: () => useRoundStore.getState().status === "CRASHED",
};

export function useRafCurve(
  onFrame?: (frame: CurveFrame) => void,
  driver: RafCurveDriver = liveDriver,   // ← the seam; Phase 7 callers omit, get live
) {
  // ... existing rAF body, but reading driver.multiplier() / driver.status() etc.
  // ... still writes to useMultiplierStore.setRendered for live; the replay caller
  //     passes a driver that does NOT write to the live store.
}
```

The replay driver is then:

```typescript
// frontend/src/features/replay/use-replay-driver.ts
export function makeReplayDriver(args: {
  growthRate: number;
  crashPoint: number;
  speed: 1 | 2 | 4;
  startedAtWall: number;       // performance.now() when replay started
  paused: () => boolean;
}): RafCurveDriver {
  let lastMultiplier = 1;
  let stopped = false;
  return {
    multiplier: () => {
      if (args.paused()) return lastMultiplier;
      const elapsedWall = performance.now() - args.startedAtWall;
      const replayElapsed = elapsedWall * args.speed;
      const m = multiplierAt(replayElapsed, args.growthRate);
      if (m >= args.crashPoint) {
        stopped = true;
        return args.crashPoint;
      }
      lastMultiplier = m;
      return m;
    },
    status: () => (stopped ? "CRASHED" : "RUNNING"),
    crashValue: () => (stopped ? args.crashPoint : null),
    shouldStop: () => stopped,
  };
}
```

This is what makes the E2E byte-match test possible: at any wall-clock timestamp, the replay sampled multiplier equals `multiplierAt(elapsedWall * speed, growthRate)` — pure function, no I/O.

### Pattern 3: TanStack Router dynamic-param route with SSR opt-out

**What:** File `routes/verify.$roundId.tsx` registers `/verify/:roundId`. `Route.useParams()` returns `{roundId: string}`. `ssr: false` matches the existing `routes/index.tsx` pattern (verified at frontend/src/routes/index.tsx:23) so `crypto.subtle` (browser-only) doesn't break SSR.

**When to use:** Any browser-only computation route.

**Example:**

```typescript
// frontend/src/routes/verify.$roundId.tsx
// Source: same SSR-opt-out pattern as frontend/src/routes/index.tsx:22-26
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/verify/$roundId")({
  ssr: false,
  component: VerifyPage,
});

function VerifyPage() {
  const { roundId } = Route.useParams();
  // ... TanStack Query for /games/rounds/:id/verify
  // ... crypto.subtle HMAC recomputation
  // ... render the three Cards + verdict per UI-SPEC Surface C
}
```

### Anti-Patterns to Avoid

- **Importing from `@crash/contracts` (root barrel) or `@crash/contracts/provably-fair` in the frontend.** Both pull `node:crypto`. Use only `@crash/contracts/multiplier` (existing) and `@crash/contracts/provably-fair-browser` (Plan 08-01). The Phase 7 boot-spike note explicitly recorded "root barrel leaks `node:crypto`" — re-introducing it would re-break the bundle.
- **Trusting the server's `matches` / `recomputedCrashPoint` fields on the `/verify/:roundId` page.** REQ-FE-10 mandates client-side recomputation. The route MUST ignore the server's `matches` boolean and compute its own via `crypto.subtle`. The server's fields are useful only for sanity-checking the implementation during dev.
- **Hex-decoding the serverSeed before HMAC import.** Node's `createHmac("sha256", hexStringSeed)` uses the UTF-8 bytes of the hex string as the key, NOT the hex-decoded 32-byte key. The browser side must match (`new TextEncoder().encode(hexString)`) or every recomputation will MISMATCH. See Pitfall 1.
- **UTF-8-encoding the serverSeed for the drawer's SHA-256(serverSeed) chain proof.** That hash IS hex-decoded in `generateSeedChain.ts:32-34` (`createHash("sha256").update(hexInput, "hex")`). Browser must hex-decode the serverSeed bytes before `crypto.subtle.digest`. The HMAC path and the SHA-256-chain path use DIFFERENT encodings of the same hex string. See Pitfall 2.
- **Pre-sampling the replay curve at modal open.** Locks the per-frame grid; forecloses 1x/2x/4x flexibility; pointless given `multiplierAt` is `Math.exp` (~ns per call).
- **Mounting the drawer / modal inside the `routes/index.tsx` subtree.** Both must mount at `__root.tsx` (or a sibling of `<Outlet />`) so route changes don't unmount them. UI-SPEC §"Critical invariant": "Planner enforces by mounting both at the root level (sibling of `<RouterProvider>`)."
- **Hardcoding `[1, 2, 4]` for speed options.** UI-SPEC mandates `VITE_REPLAY_SPEEDS` env-tunable. Parse to `number[]` in `config.ts`; if every value is `Number.isInteger` and the parsed array literal contains 1, treat 1 as the default.
- **Using a Sonner toast for verify or replay errors.** UI-SPEC mandates inline `Alert` cards — toasts would conflict with the live game's celebrate/crash toasts behind the overlay.
- **Re-running `crypto.subtle` HMAC inside the rAF loop.** crypto.subtle is async; the rAF tick is synchronous. Compute the crash point ONCE on modal open (or even just use the server's `crashPoint` field; the verify route is the only place where re-derivation is the contract).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 / HMAC-SHA-256 in the browser | A pure-JS sha256 implementation | `crypto.subtle.digest` + `crypto.subtle.importKey + sign` | Native Web Crypto is Baseline widely available since Jan 2020; constant-time; hardware-accelerated; zero bundle cost. |
| Focus trap, Esc-close, scroll-lock for the drawer + modal | Custom keyboard handlers and `tabindex` juggling | shadcn `Sheet` + shadcn `Dialog` (Radix Dialog under the hood) | A11y is hard; Radix has been audited. UI-SPEC explicitly says "Do NOT custom-handle focus." |
| Speed selector "pick one of three" | Custom `<div>` with buttons + state | shadcn `ToggleGroup type="single"` (Radix Toggle Group) | Semantic primitive; aria-attributes are correct; keyboard nav (arrow keys) is built-in. |
| Inline error UI | Custom `<div className="text-red-500">` | shadcn `Alert` with `role="alert"` | Screen readers announce; consistent with the design system. |
| Hex-encoding a `Uint8Array` | A custom hex map | `Array.from(...).map(b => b.toString(16).padStart(2, "0")).join("")` | The native `Uint8Array.prototype.toHex()` is 2025-new; fallback is one line and universally supported. |
| Reading dynamic route params | `window.location.pathname.split(...)` | `Route.useParams()` from the file-based route | Type-safe; auto-decoded; SSR-compatible. |
| Backend-side recompute for the `/verify` route | Calling `VerifyRoundUseCase.execute()` again on the server and trusting `matches` | Browser-side `crypto.subtle` HMAC + Bustabit | REQ-FE-10 mandates the client-side path; otherwise the "no server trust" claim collapses. |
| Renderer code duplication for replay | A separate `<ReplayCurve />` component | Refactor `use-raf-curve.ts` to accept a driver (D-05) | Duplication is the whole anti-pattern D-05 prohibits. |

**Key insight:** Phase 8 is a thin shell. The hard problems (crash math, hash chain, formula version, renderer math) are already implemented in `@crash/contracts` and `features/curve/`. The work is (1) one new browser-safe subpath, (2) one driver-injection seam, (3) three UI surfaces, (4) one Vitest determinism test, (5) one README block.

## Common Pitfalls

### Pitfall 1: HMAC key encoding mismatch (Node string-key vs browser raw-bytes)

**What goes wrong:** Browser HMAC verdict shows MISMATCH for every round even though the server's `matches` field is `true`.

**Why it happens:** Node's `createHmac("sha256", input.serverSeed)` interprets a **string** key as UTF-8 bytes by default. So when `serverSeed` is `"0000000000000000000000000000000000000000000000000000000000000001"` (a 64-character hex string), Node uses the **64 UTF-8 bytes** `[0x30, 0x30, ..., 0x30, 0x31]` as the HMAC key. The browser, if it hex-decodes the seed and uses `importKey("raw", hex2bytes(seed))`, will use 32 bytes — a completely different key — and produce a different HMAC.

**How to avoid:** In the browser, encode the serverSeed via `new TextEncoder().encode(serverSeed)` (UTF-8) — NOT `hex2bytes(serverSeed)`. The locked-byte test in `packages/contracts/tests/unit/provably-fair.test.ts:14-22` (serverSeed `"0000...0001"`, clientSeed `"test"`, nonce `0n`, bucket `101` → `2.94`) is the canonical fixture: the browser port must reproduce `2.94` against the same inputs.

**Warning signs:** Browser MISMATCH for every round; server `matches: true` for the same round; verdict flips to MATCH if the browser is fed the server's `recomputedCrashPoint` directly.

### Pitfall 2: SHA-256 chain proof uses HEX-decoded bytes (different from HMAC)

**What goes wrong:** The drawer's "SHA-256(revealedSeed) == previous commitment hash" verdict shows MISMATCH on every round.

**Why it happens:** `generateSeedChain.ts:32-34` defines the chain link as `createHash("sha256").update(hexInput, "hex").digest("hex")` — the second argument `"hex"` tells Node to **hex-decode** the input to 32 bytes before hashing. The browser, if it UTF-8-encodes the serverSeed (matching the HMAC path), will hash the 64 ASCII bytes — completely different digest.

**How to avoid:** For the drawer's hash-chain proof, hex-decode the serverSeed first: `crypto.subtle.digest("SHA-256", hexToBytes(serverSeed))`. The HMAC path (Pitfall 1) and the chain-proof path (Pitfall 2) use OPPOSITE encodings of the same hex string. Plan 08-01 must include both helpers as separate functions with names that make the encoding explicit: e.g. `sha256OfHexEncodedSeed(seedHex)` for the chain proof, and `deriveCrashPointAsync({serverSeed: hexStringTreatedAsUtf8, ...})` with a docstring spelling out the byte-encoding.

**Warning signs:** Drawer MATCH never appears; the computed-hash hex field is the SHA-256 of the ASCII bytes of the hex string, which is recognizably different from the seedHash stored in `round.seedHash`.

### Pitfall 3: Two simultaneous Canvas + rAF loops drain CPU

**What goes wrong:** Opening the Replay modal causes the live game's curve to stutter or drop frames.

**Why it happens:** Both the live `<CrashCurve />` (behind the modal scrim) and the Replay `<CrashCurve />` (inside the modal) mount their own rAF loops + their own Canvas. The blurred scrim does not prevent the live Canvas from drawing.

**How to avoid:** Two options — (a) accept it (rAF is cheap; `Math.exp` + a `lineTo` loop per frame at 60Hz is sub-millisecond on any laptop), or (b) pause the live `useRafCurve` while the modal is open by reading a `useReplayStore.isOpen` flag and skipping the live `writeFrame` call. Option (a) is simpler and matches the UI-SPEC D-02 promise that "live game continues rendering behind." **Recommend (a) with a benchmark probe in the verify-phase step**; if measured CPU climbs > 5%, fall back to (b).

**Warning signs:** Dev-tools Performance panel shows two `requestAnimationFrame` flame stacks; the live curve's 60fps drops to 30fps on the modal-open transition.

### Pitfall 4: `crypto.subtle` not available (non-secure context)

**What goes wrong:** Drawer shows "Couldn't compute hash" Alert and the `/verify` route shows MISMATCH for every round.

**Why it happens:** `crypto.subtle` requires a secure context: HTTPS, OR `http://localhost` / `http://127.0.0.1`. Production-like Docker setups serve via Kong at `http://localhost:8000` — the FE itself runs at `http://localhost:3000` (Vite dev) — both are secure-context-eligible. But if a recruiter accesses via the network IP (e.g., `http://192.168.x.x:3000`), `window.crypto.subtle` is `undefined`.

**How to avoid:** At app boot, assert `typeof window.crypto?.subtle === "object"` and render a one-time `Alert` warning on the verify drawer and route if not. The README must document the localhost requirement.

**Warning signs:** TypeError "Cannot read properties of undefined (reading 'digest')" in the console.

### Pitfall 5: Replay modal mounted inside `routes/index.tsx` — closes on navigation

**What goes wrong:** Replay modal closes the moment the user navigates (e.g., clicks the "Open full verification" link in the drawer that leads to `/verify/:roundId`).

**Why it happens:** TanStack Router unmounts the previous route's subtree on navigation. Anything inside `routes/index.tsx` (including a modal) gets unmounted.

**How to avoid:** Mount both `<VerificationDrawer />` and `<ReplayModal />` in `routes/__root.tsx` as siblings of `<Outlet />`. They subscribe to a Zustand store (e.g. `useUiStore` with `drawerOpen: boolean`, `replayRoundId: string | null`) so any component can open them without prop-drilling. The Phase 7 root already has `<OidcProvider>`, `<Toaster />`, `<BalancePill />`, `<ConnectionBadge />` mounted there — the same precedent applies. UI-SPEC § Critical invariant locks this.

**Warning signs:** Modal disappears on route change; drawer disappears when the user clicks the verify route link.

### Pitfall 6: oidc-spa silent-renew iframe + Sheet/Dialog z-stack collision

**What goes wrong:** Token silent renewal fails (or fires twice) while the drawer/modal is open.

**Why it happens:** oidc-spa uses a hidden iframe for silent renewal. If the drawer/modal's scrim has a `pointer-events: auto` or sets `inert` on the document tree, the iframe's load can be blocked. Phase 7 already saw shape-shifting issues here.

**How to avoid:** Radix `Sheet` / `Dialog` use `aria-hidden` + `inert` on siblings — but the `<body>` is NOT inerted; oidc-spa's iframe is appended to `<body>` so it stays interactive. Verify by opening the drawer immediately before a known token expiry and confirming `BroadcastChannel` traffic continues. Plan a smoke probe.

**Warning signs:** Token expires mid-drawer; the next API call fires `401`; toast shows "Session expired."

### Pitfall 7: Replay's "byte-for-byte" claim requires sampling at a fixed grid

**What goes wrong:** The determinism E2E test fails sporadically because the live driver and replay driver sample at slightly different wall-clock moments.

**Why it happens:** rAF fires at the browser's vsync; even a 0.5ms drift between two runs produces different sample arrays.

**How to avoid:** The E2E test should NOT sample at rAF callbacks. It should call `multiplierAt(growthRate, t)` directly at a chosen grid of `t` values (e.g. `[0, 16.67, 33.33, ...]` for 60 grid points up to the crash time). Both the "live" and "replay" derivations call the same pure function; the test asserts identical arrays. This is the "underlying simulation grid" wording in D-03 — not "rAF frame samples." The test proves the renderer is deterministic given inputs, NOT that two browser sessions produce identical frame timings (which is physically impossible).

**Warning signs:** The byte-equality assertion passes locally but flakes in CI; sample arrays differ by ±1 element at the end.

### Pitfall 8: 1-in-101 instant-crash bucket can hide MISMATCH in fixtures

**What goes wrong:** The E2E fixture round has `crashPoint: 1.00` because `intH % 101 === 0` — the test passes trivially without exercising the formula.

**Why it happens:** The instant-crash bucket bypasses the formula. A fixture that happens to land on a multiple-of-101 nonce will return 1.00 from both paths regardless of arithmetic correctness.

**How to avoid:** Use the locked-byte fixture from `packages/contracts/tests/unit/provably-fair.test.ts:11-22`: serverSeed `"0000000000000000000000000000000000000000000000000000000000000001"`, clientSeed `"test"`, nonce `0n`, bucket `101` → expected `2.94`. This is the known-good non-instant-crash anchor. Add a second fixture from the same test file (nonce `160n` → `1.00`) as the instant-crash sanity check.

## Code Examples

### SHA-256 in the browser (drawer's chain proof)

```typescript
// frontend/src/features/fairness/use-verify-previous.ts (sketch)
// Source: MDN SubtleCrypto.digest + the chain-link semantics from
// packages/contracts/src/provably-fair/generate-seed-chain.ts:32-34

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex string must have even length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256OfHexEncodedSeed(seedHex: string): Promise<string> {
  // Mirrors generate-seed-chain.ts: createHash("sha256").update(seed, "hex").digest("hex")
  const digestBuf = await crypto.subtle.digest("SHA-256", hexToBytes(seedHex));
  return bytesToHex(digestBuf);
}

// Usage in the drawer:
const computed = await sha256OfHexEncodedSeed(previousRound.serverSeed);
const matches = computed === previousRound.seedHash;
```

### HMAC-SHA-256 + Bustabit formula in the browser (`/verify` route)

(See § Pattern 1 for the full `deriveCrashPointAsync` implementation.)

### Replay time-stepper driver

```typescript
// frontend/src/features/replay/use-replay-driver.ts (sketch)
// Source: contracts multiplier.ts pure function + D-03 speed semantics

import { multiplierAt } from "@crash/contracts/multiplier";

export type ReplayDriverState = {
  startedAtWall: number;
  speed: 1 | 2 | 4;
  paused: boolean;
  growthRate: number;
  crashPoint: number;
};

export function sampleReplayMultiplier(
  state: ReplayDriverState,
  now: number = performance.now(),
): number {
  if (state.paused) return 1; // (or last value — caller tracks for pause UX)
  const elapsedWall = now - state.startedAtWall;
  const replayElapsed = elapsedWall * state.speed;
  const m = multiplierAt(replayElapsed, state.growthRate);
  return Math.min(m, state.crashPoint);
}

// Determinism property (E2E test):
// For any (state.growthRate, state.crashPoint, elapsedMs),
//   sampleReplayMultiplier({...state, paused: false, startedAtWall: 0}, elapsedMs * state.speed)
//   === sampleReplayMultiplier({...state, speed: 1, paused: false, startedAtWall: 0}, elapsedMs)
// because both reduce to multiplierAt(elapsedMs * state.speed, state.growthRate).
```

### README recruiter example (shell-runnable)

```bash
# Verify any settled round without trusting the app
ROUND_ID=<paste-from-history-strip>

curl -s http://localhost:8000/games/rounds/$ROUND_ID/verify > round.json

SERVER_SEED=$(jq -r .serverSeed round.json)
SEED_HASH=$(jq -r .serverSeedHash round.json)

# Reproduce the seedHash commitment:
# generate-seed-chain.ts hashes the HEX-DECODED seed bytes (note: -hex flag form may vary by openssl)
echo -n "$SERVER_SEED" | xxd -r -p | openssl dgst -sha256

# Expected output: SHA256(...)= <SEED_HASH>
echo "Reported seedHash: $SEED_HASH"

# Reproduce the crashPoint via the Bustabit formula:
CLIENT_SEED=$(jq -r .clientSeed round.json)
NONCE=$(jq -r .nonce round.json)

# HMAC-SHA-256 over "clientSeed:nonce" using the UTF-8 bytes of the hex serverSeed as the key:
HMAC=$(echo -n "$CLIENT_SEED:$NONCE" | openssl dgst -sha256 -hmac "$SERVER_SEED" -hex | awk '{print $2}')
HEX13=${HMAC:0:13}
INT_H=$(printf '%d' "0x$HEX13")

# Bustabit formula: floor((100 * 2^52 - H) / (2^52 - H)) / 100
python3 -c "
H=$INT_H; E=2**52
if H % 101 == 0:
    print('crashPoint = 1.00')
else:
    print('crashPoint =', max(1.0, ((100*E - H)//(E - H))/100))
"
echo "Reported crashPoint: $(jq -r .crashPoint round.json)"
```

(Planner refines exact shell + adds Linux/macOS portability notes; the structure above is shell-runnable and demonstrates both proofs.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `crypto-js` npm package for browser SHA-256 / HMAC | Native `crypto.subtle` | Baseline widely available since Jan 2020 | Zero bundle cost; constant-time; hardware-accelerated. `crypto-js` is now considered legacy. |
| Polyfilling `Uint8Array.prototype.toHex()` | Native browser method (2025-new) OR `Array.from + padStart` fallback | 2025 | The fallback is one line; the native method is not yet universally available across all browsers as of May 2026 — RESEARCH recommends the fallback for the FE bundle. `[CITED: developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest mentioning toHex()]` |
| Separate replay rendering pipeline | Driver injection into the production renderer | This challenge (D-05) | Forces single source of truth for the curve math; renders the deterministic-replay E2E test trivial to write. |

**Deprecated/outdated:**

- `crypto-js`: superseded by `crypto.subtle` for any modern browser target. Do not add.
- Hand-rolled OIDC silent-renew coordination: oidc-spa's BroadcastChannel is library-internal (ADR-027) — Phase 8's drawer/modal must not add a second renew path.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node's `createHmac("sha256", hexStringSeed).update(message)` uses the UTF-8 bytes of the hex string as the HMAC key (rather than hex-decoded bytes). | Pitfall 1 + Pattern 1 + Code Examples | If wrong, Plan 08-01's browser port must hex-decode the seed before `importKey`, and the README's `openssl dgst -hmac "$SERVER_SEED"` line will be wrong. **Mitigation:** the locked-byte test (`expect(value).toBe(2.94)` for seed `"0000...0001"`, client `"test"`, nonce `0n`) is the authoritative oracle. Plan 08-01 must reproduce 2.94 in the browser as its first acceptance test — that single check resolves A1 either way. `[ASSUMED based on Node.js crypto.createHmac documented behavior with string keys; verified mechanically by the planner via the existing 2.94 fixture]` |
| A2 | The `crypto.subtle.subtle` async path adds ~5-30ms latency for the drawer SHA-256, which is acceptable UX per UI-SPEC ("makes 'hashed in YOUR browser' feel concrete"). | Summary + Alternatives + Pitfall 4 | If the latency is significantly higher on low-end hardware (>200ms), the drawer's Skeleton-to-verdict UX flickers. **Mitigation:** UI-SPEC already specifies Skeleton during compute; the skeleton's 1.4s pulse cycle absorbs any reasonable latency. `[ASSUMED based on general Web Crypto benchmarks; verify on the dev box during phase execution]` |
| A3 | Mounting `<VerificationDrawer />` + `<ReplayModal />` in `__root.tsx` (as siblings of `<Outlet />`) does not break oidc-spa's iframe-based silent renewal. | Pitfall 5 + Pitfall 6 | If wrong, silent renewal would fail while the drawer is open; the user would be logged out mid-verification. **Mitigation:** Radix Dialog `aria-hidden`/`inert` apply to sibling subtrees but NOT to `<body>` directly; oidc-spa appends its iframe to `<body>`. Plan 08-XX adds a smoke probe: open drawer, wait past silent-renew window, confirm `getAccessToken()` returns a fresh token. `[ASSUMED based on Radix Dialog documented behavior; verify in phase execution]` |
| A4 | The renderer driver-injection refactor (Plan 08-03) is a non-breaking change for Phase 7 callers (default parameter retains live behavior). | Pattern 2 + Don't Hand-Roll | If the seam requires API changes Phase 7 callers depended on (e.g., the `onFrame` callback signature), existing 07-06 + 07-08 tests would break. **Mitigation:** Plan 08-03 includes a regression suite run; the change is purely additive (optional driver param). `[ASSUMED based on file inspection of use-raf-curve.ts:13 — current signature is onFrame-only]` |
| A5 | Backend planner can safely extend `VerifyRoundDto` to include `bets: BetSnapshot[]` without affecting other consumers. | Summary + Architectural Map | If a consumer (CLI verifier, Phase 4 integration tests) does `dto.strict()` parses against the existing shape, the extra field would fail validation. **Mitigation:** `verifyRoundSchema` already uses `.strict()` (file inspection of `verify-round.dto.ts:17`); planner must update consumers. `bin/verify-crash.ts` (CLI) reads only specific fields — adding `bets[]` is non-breaking for it. `[ASSUMED based on file inspection; resolved by the planner enumerating all consumers in Plan 08-02]` |
| A6 | The replay E2E byte-match assertion runs in Vitest jsdom without needing Playwright. | § Validation Architecture | If `crypto.subtle` is unavailable in jsdom (it's polyfilled in `@vitest/web-worker`-adjacent setups but base jsdom lacks it), the test needs a different environment. **Mitigation:** node:crypto provides byte-equivalent SHA-256/HMAC for *anchor checks* in the test; the renderer determinism property itself is pure-math (`multiplierAt`) and needs no crypto. The crypto fact-check (e.g., "browser HMAC matches server HMAC") can be a separate test that imports `crypto.subtle` if it exists or skips. `[ASSUMED based on jsdom capabilities; verify by running a single `crypto.subtle.digest` smoke during phase execution]` |
| A7 | `VITE_REPLAY_SPEEDS=1,2,4` (parsed to `number[]`) does not violate `@crash/no-number-for-money` since these are dimensionless multipliers, not monetary. | UI-SPEC inheritance | If the ESLint rule's pattern catches them (it shouldn't — the rule matches `/amount|balance|bet|payout|price|wager/i`), Plan 08-XX would need a narrow `eslint-disable`. **Mitigation:** the rule regex is documented in CLAUDE.md; `speed`/`replaySpeed` is not in the regex. No disable needed. `[VERIFIED: CLAUDE.md §Coding standards / Money]` |

**Total assumptions: 7.** Most are byte-level encoding details that the existing Phase 4 locked-byte fixture (`2.94` for seed `0000...0001`) will resolve in a single 5-minute browser test during Plan 08-01.

## Open Questions

1. **Should the drawer's MATCH/MISMATCH verdict for the previous round be cached so it doesn't re-compute on every drawer-open?**
   - What we know: SHA-256 of a 64-char hex string is ~5-15ms in the browser.
   - What's unclear: whether caching the verdict per-roundId in a Zustand store is over-engineering, OR whether the Skeleton flash on every drawer-open feels janky.
   - Recommendation: cache in a `fairness.store.ts` with a `Map<roundId, "MATCH" | "MISMATCH">`. The store is also where the Surface A "transient checkmark after recent verified MATCH" lives (UI-SPEC §Surface A states). Two birds.

2. **Should the `/verify/:roundId` route trust the server's `previousServerSeed` field, or independently fetch the previous round's `/verify` to chain-verify two rounds?**
   - What we know: UI-SPEC Surface C does NOT require chained verification — only HMAC + Bustabit recomputation for the round itself.
   - What's unclear: whether deeper chain-verification (showing "this round's seedHash chains correctly to the prior reveal") adds defensibility for the recruiter's arguição.
   - Recommendation: scope-conservative — implement Surface C exactly as UI-SPEC describes (single-round HMAC + Bustabit + verdict). The drawer (Surface B) already does the chain-link proof for the previous round. Don't duplicate.

3. **What is the canonical `bets[]` shape that the extended `VerifyRoundDto` should expose?**
   - What we know: `CurrentRoundBetView` (current-round.dto.ts:1-17) has `{betId, playerIdMasked, amount, status, cashedOutMultiplier, payout}` — looks correct for Replay overlays.
   - What's unclear: whether the Replay needs a `placedAt` timestamp (to anchor when the bet appears in the curve) — Replay UI-SPEC says "appear at their `t` anchor" but the placedAt is during BETTING (`t < 0` from the round's start), so all bets effectively appear at `t = 0`. Cashouts need `cashedOutMultiplier` which `CurrentRoundBetView` already has.
   - Recommendation: use `CurrentRoundBetView` shape verbatim. No new schema. Plan 08-02 lifts that schema into a shared place and reuses it.

4. **What `growthRate` does Replay use — the env value at replay time, or the value the round was actually computed with?**
   - What we know: `VITE_GROWTH_RATE=0.06` and the backend uses `GROWTH_RATE=0.06`. They're synchronized today; the contract claims byte-equivalence relies on it.
   - What's unclear: if a future deploy changes the growth rate, replaying old rounds with the new rate produces a different curve.
   - Recommendation: extend `VerifyRoundDto` to include `growthRate` (Plan 08-02 alongside `bets[]`). The Replay reads the round's own growth rate, not the env config's. Defends against future ops changes.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Backend (extending VerifyRoundUseCase + DTO) | ✓ | 1.3.11+ (per `.bun-version`) | — |
| Node.js (for `node:crypto` byte-anchor test) | Plan 08-01 acceptance: must reproduce the `2.94` fixture in the browser | ✓ | bundled with Bun | — |
| Vitest + jsdom | Plan 08-09 determinism E2E + per-feature unit tests | ✓ | 3.x + 26.x | — |
| `crypto.subtle` (browser SubtleCrypto) | Drawer + `/verify` route | ✓ (when served from localhost or HTTPS) | Web standard | Show inline Alert if `typeof window.crypto?.subtle !== "object"` |
| `openssl` (for README example) | README recruiter-runnable proof | ✓ on macOS / Linux | varies | Document `shasum -a 256` as the SHA-256 fallback; `python3` for the integer arithmetic |
| `jq` (for README example) | Parsing `/verify` JSON in shell | ✓ on macOS / Linux | varies | README says "install jq or substitute with grep + sed" |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none material.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (already installed; 65/65 frontend tests green per STATE.md) |
| Config file | `frontend/vite.config.ts` (Vitest reads it via the plugin) |
| Quick run command | `cd frontend && bunx vitest run --reporter=verbose <test-file>` |
| Full suite command | `cd frontend && bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-FE-09 | Fairness badge renders with seedHash; opens drawer on click | unit (React Testing Library) | `bunx vitest run src/components/fairness-badge.test.tsx` | ❌ Wave 0 (Plan 08-XX creates) |
| REQ-FE-09 | Drawer fetches previous round + computes SHA-256 in browser + shows verdict | unit (jsdom + crypto.subtle smoke) | `bunx vitest run src/features/fairness/use-verify-previous.test.ts` | ❌ Wave 0 |
| REQ-FE-09 | Hash-block Copy button shows ephemeral "Copied" inline swap | unit (RTL) | `bunx vitest run src/components/hash-block.test.tsx` | ❌ Wave 0 |
| REQ-FE-10 | `/verify/:roundId` route renders three Cards + verdict | unit (RTL with route harness) | `bunx vitest run src/routes/verify.roundid.test.tsx` | ❌ Wave 0 |
| REQ-FE-10 | Browser HMAC recomputation reproduces the locked `2.94` fixture | unit (pure) | `bunx vitest run packages/contracts/src/provably-fair-browser/derive-crash-point.async.test.ts` | ❌ Wave 0 (Plan 08-01) |
| REQ-FE-10 | Verify route shows "seed not yet revealed" Alert for non-SETTLED roundId | unit (RTL + mock fetch) | (same file as above) | ❌ Wave 0 |
| REQ-REPLAY-01 | `multiplierAt(t, growthRate)` is deterministic across calls; sampleReplayMultiplier matches the live driver's sampled value at the same `t` | unit (pure-fn) | `bunx vitest run src/features/replay/use-replay-driver.test.ts` | ❌ Wave 0 |
| REQ-REPLAY-01 | E2E byte-match: capture a live round's samples at a fixed grid, replay with same seeds, assert identical sample arrays | unit (pure, no browser needed — both paths reduce to `multiplierAt`) | `bunx vitest run src/features/replay/determinism.test.ts` | ❌ Wave 0 |
| REQ-REPLAY-02 | Clicking a history chip opens the Replay modal with the chip's roundId | unit (RTL) | `bunx vitest run src/components/history-strip.test.tsx` (extend existing) | ❌ Wave 0 (extend existing 07-07 test) |
| REQ-REPLAY-02 | Replay modal auto-plays at 1x on open; Play/Pause + speed toggle work | unit (RTL with fake timers) | `bunx vitest run src/components/replay-modal.test.tsx` | ❌ Wave 0 |
| REQ-REPLAY-03 | `use-raf-curve.ts` invokes injected driver instead of the live store when driver is passed | unit (mock driver, fake rAF) | `bunx vitest run src/features/curve/use-raf-curve.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bunx vitest run <single-test-file>` (the most recently authored file; ~2-5s)
- **Per wave merge:** `bun run test` (full frontend suite; ~15-20s based on STATE.md indicating 65/65 in <30s historically)
- **Phase gate:** Full suite green + the determinism test in particular flagged green before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `packages/contracts/src/provably-fair-browser/derive-crash-point.async.test.ts` — covers REQ-FE-10 byte-locked fixture
- [ ] `frontend/src/features/fairness/use-verify-previous.test.ts` — covers REQ-FE-09 drawer SHA-256 path
- [ ] `frontend/src/components/fairness-badge.test.tsx` — covers REQ-FE-09 badge UI
- [ ] `frontend/src/components/hash-block.test.tsx` — covers REQ-FE-09 + REQ-FE-10 Copy UX
- [ ] `frontend/src/components/verification-drawer.test.tsx` — covers REQ-FE-09 drawer assembly + Alert states
- [ ] `frontend/src/components/replay-modal.test.tsx` — covers REQ-REPLAY-02 modal + speed selector + auto-play
- [ ] `frontend/src/features/replay/use-replay-driver.test.ts` — covers REQ-REPLAY-01 driver math
- [ ] `frontend/src/features/replay/determinism.test.ts` — covers REQ-REPLAY-01 byte-match E2E (the centerpiece)
- [ ] `frontend/src/features/curve/use-raf-curve.test.ts` — covers REQ-REPLAY-03 driver injection (regression for Phase 7 default behavior + new replay path)
- [ ] `frontend/src/routes/verify.roundid.test.tsx` — covers REQ-FE-10 route assembly + verdict + error states

## Security Domain

> Required when `security_enforcement` is enabled (absent = enabled). Phase 8 is largely read-only and operates on already-public data (verify endpoint is public-readable post-settle), so the surface is small but real.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | oidc-spa silent renewal continues during drawer/modal (Pitfall 6); no new auth surface. |
| V3 Session Management | no (no new session state in this phase) | — |
| V4 Access Control | yes (lightly) | `/games/rounds/:id/verify` is currently authenticated by JWT (read GameModule). The route returns serverSeed of SETTLED rounds only (verify-round.use-case.ts:37-39 rejects non-SETTLED with `ROUND_NOT_YET_SETTLED`). Plan 08-02's bets[] extension must mask `playerId` (already done in `CurrentRoundBetView.playerIdMasked`). |
| V5 Input Validation | yes | `routeIdParamSchema = z.string().uuid()` at controller; FE must also validate the route param via zod before issuing the fetch to avoid crafted-URL fetch errors. |
| V6 Cryptography | yes | Use `crypto.subtle` (Web Crypto) — never hand-roll. Plan 08-01 documents the byte-encoding contract explicitly so a future maintainer doesn't accidentally hex-decode the HMAC key and break verification silently. |

### Known Threat Patterns for {browser SubtleCrypto + Settled-only data}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Premature seed reveal (current/RUNNING round) | Information Disclosure | Backend already enforces: `VerifyRoundUseCase` throws `ROUND_NOT_YET_SETTLED` for non-SETTLED; `GetCurrentRoundUseCase` nullifies `serverSeed` when not SETTLED. FE assumes this contract holds and renders the "previous round" path in the drawer accordingly. |
| Player-id correlation across rounds in replay overlays | Information Disclosure | `playerIdMasked` (already implemented in `mask-player-id.ts`) prevents cross-round linkability of bystander players. The player's own bet is un-masked only on the user's private channel — Replay overlay is the masked path. |
| Malicious roundId path injection (`/verify/../../etc/passwd`) | Tampering | `z.string().uuid()` at both FE route guard and backend controller. UUIDs cannot encode path traversal. |
| Crafted JSON in the verify response (e.g., `crashPoint: NaN`) | Tampering | FE zod parse with `.strict()` matching `verifyRoundSchema`; reject + show Alert if malformed. |
| Crashing the browser via giant seed-chain visualization | DoS | The drawer shows only the current + previous round (2 entries). No N-deep chain rendering. |
| Silent-renew interference from drawer/modal (Pitfall 6) | Denial of Service (auth) | Mount overlays in `__root.tsx` siblings of `<Outlet />`; Radix `inert` does not affect `<body>`. Smoke probe in the verify-phase step. |

## Sources

### Primary (HIGH confidence)

- `packages/contracts/src/provably-fair/derive-crash-point.ts` — backend algorithm source (`createHmac("sha256", input.serverSeed)`)
- `packages/contracts/src/provably-fair/generate-seed-chain.ts` — chain SHA-256 with hex-decoded input
- `packages/contracts/src/provably-fair/formulas.constants.ts` — `FORMULA_VERSION = 1`, `HEX_CHARS = 13`, `TWO_POW_52 = 4503599627370496`
- `packages/contracts/tests/unit/provably-fair.test.ts:14-22` — locked-byte fixture (seed `"0000...0001"`, client `"test"`, nonce `0n` → `2.94`)
- `packages/contracts/package.json` — current exports (`.`, `./ws`, `./multiplier`, `./formula`); browser-safe subpath `./provably-fair-browser` MISSING (to be added)
- `services/games/src/presentation/controllers/rounds.controller.ts:59-67` — verify endpoint surface
- `services/games/src/application/use-cases/verify-round.use-case.ts` — endpoint payload shape (NO `bets[]` today)
- `services/games/src/presentation/dtos/verify-round.dto.ts` — strict zod schema (extending is non-breaking; consumers do `.strict()` parses)
- `services/games/src/presentation/dtos/current-round.dto.ts:5-13` — `CurrentRoundBetView` shape to reuse for Replay
- `services/games/src/application/client-seed.derivation.ts` — D-04 confirmed deterministic seed
- `services/games/src/domain/bet.repository.ts:6-8` — `findActiveByRound` only; Plan 08-02 may need `findByRound` (no status filter) on the repo
- `docker/kong/kong.yml` — Kong routes confirmed; `~/games/rounds/[^/]+/verify$` accommodates the existing verify endpoint without change
- `frontend/src/features/curve/use-raf-curve.ts` — current renderer driver; refactor surface line-by-line documented
- `frontend/src/features/curve/draw-curve.ts` — pure draw function (UNTOUCHED)
- `frontend/src/components/crash-curve.tsx` — Canvas host; reuses through driver seam
- `frontend/src/components/history-strip.tsx` — existing chip render; click handler to be added
- `frontend/src/lib/config.ts` — typed config (3 new env vars to add)
- `frontend/.env.example` — env surface (3 new vars to land here)
- `frontend/package.json` — dep set (`@crash/contracts`, shadcn, lucide, sonner already; sheet/toggle-group/alert components to add via shadcn CLI; no new npm deps)
- `frontend/src/routes/__root.tsx` — mount point for drawer + modal (Pitfall 5)
- `frontend/src/routes/index.tsx:23` — `ssr: false` precedent for `/verify/:roundId`
- `frontend/components.json` — shadcn config (style: new-york, lucide icon set)
- `.planning/research/STACK.md` — overall stack rationale + locked tools
- `.planning/research/ARCHITECTURE.md` — provably-fair architecture, message catalog, multiplier sync canon
- MDN `SubtleCrypto.digest` and `SubtleCrypto.sign` documentation — current crypto.subtle API + secure context requirement
- `.planning/phases/08-provably-fair-history-replay/08-CONTEXT.md` — locked user decisions D-01..D-06
- `.planning/phases/08-provably-fair-history-replay/08-UI-SPEC.md` — design contract surfaces A..E + copywriting

### Secondary (MEDIUM confidence)

- TanStack Router file-based routing convention `verify.$roundId.tsx` + `Route.useParams()` — pattern verified via official docs partial fetch + WebFetch synthesis
- shadcn-ui CLI `add sheet toggle-group alert` syntax — UI-SPEC § Cross-References, slopcheck-passed
- `Uint8Array.prototype.toHex()` is 2025-new — recommend fallback (`Array.from + padStart`)

### Tertiary (LOW confidence)

- Exact wall-clock latency of `crypto.subtle` on low-end hardware (A2 — verify during phase execution)
- oidc-spa silent renew compatibility with Radix Dialog (A3 — verify during phase execution via the planned smoke probe)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — every package is already installed or installable via shadcn CLI; npm + slopcheck verified.
- Architecture: HIGH — the seam (driver injection in `use-raf-curve.ts`) is precisely defined and the byte-encoding traps (Pitfalls 1 + 2) are anchored to the existing 2.94 locked-byte fixture.
- Pitfalls: HIGH — Pitfalls 1 and 2 are the load-bearing risks; both have a deterministic acceptance test (the 2.94 fixture) that resolves them in 5 minutes during Plan 08-01 execution.
- Backend gaps (missing `bets[]`, missing browser-safe subpath): HIGH (file-inspection-verified)

**Research date:** 2026-05-29
**Valid until:** 2026-06-28 (~30 days; provably-fair canon is stable, crypto.subtle is baseline-mature, the renderer seam is contained to this codebase).
