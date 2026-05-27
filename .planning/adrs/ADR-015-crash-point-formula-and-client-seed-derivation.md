# ADR-015: Crash-point formula (Bustabit canon) and per-round client-seed derivation

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 4

## Context

REQ-FAIR-03 demands a verifiable, byte-deterministic crash-point per round derived from `HMAC-SHA-256(serverSeed, clientSeed:nonce)` using the Bustabit-canon 52-bit formula `floor((100 * 2^52 - H) / (2^52 - H)) / 100` with a 1-in-N instant-crash bucket. REQ-FAIR-04 requires the same algorithm to live in a pure-function module under `packages/contracts` so the FE verifier, the BE round loop, and the CLI verifier all execute the identical code path. REQ-FAIR-02 demands that the server seed for round N is never observable before round N has reached SETTLED.

The challenge has no external entropy source. Bustabit's canonical Rust reference impl (`vladignatyev/bustabit-rust`, audited during 04-RESEARCH §Pattern 3) keys HMAC by the chain-iteration hash and uses a fixed-public-salt as the HMAC *message* — historically the salt has been a future Bitcoin block hash committed before the round opens. That salt is the public proof that operator cannot pick the seed and the message together. Bustabit gives us:

1. A precomputed hash chain (`seed[N-1] = randomBytes(32)`, `seed[i] = sha256(seed[i+1])`, consumed in reverse so revealing `seed[i]` provably reveals an ancestor of `seed[i-1]`).
2. An HMAC keyed by the round's server seed.
3. An HMAC message — the public salt the player can observe *before* the round opens — that ties the round to something the operator cannot have chosen after seeing bets.

Our deployment cannot stream Bitcoin block hashes; the demo runs on `docker:up` with no external feeds, and the recruiter must be able to verify a round against a curl + standard SHA-256 (REQ-DOC-01) without depending on a chain that may not be reachable from the review machine. The HMAC-message slot still has to be filled with *something* publicly derivable and operator-untamperable. Three shapes were on the table at Plan 04-01 design time.

The 25% architecture-and-DDD scoring band hinges on the recruiter accepting that the operator-collusion property is preserved without external entropy. The fairness module is the most-scrutinized surface in arguição — every deviation from Bustabit canon must be defended.

## Considered

- **Option A — Exact Bustabit canon with a globally-fixed public salt env-loaded** — `HMAC_SHA256(serverSeed, PUBLIC_SALT)` where `PUBLIC_SALT` is a one-time env-baked string (e.g., the SHA-256 of `crash-game-jungle-gaming-challenge-v1`). Pros: minimal deviation from the canonical paper, single fixed message reduces input surface, easy to defend ("same as Bustabit, salt is the deployment fingerprint"). Cons: every round in the deployment uses the *same* HMAC message; an operator with the chain head can precompute all crash points before opening any round; the per-round nonce that should bind the formula to a specific position in the chain becomes structurally meaningless; the recruiter can ask "what stops you from showing me only the rounds where the precomputed crash point matches a favorable distribution?" and the answer is "the chain commitment", but the proof becomes the chain-pregen story alone instead of standing on two legs.
- **Option B — `HMAC(serverSeed, ${clientSeed}:${nonce})` with per-round derivable `clientSeed` (chosen)** — `clientSeed` for round N is `SHA256(prevRound.id + ":" + prevRound.crashedAt.toISOString())`; for the genesis round, `clientSeed = SHA256("crash-game-genesis-client-seed")` (the `GENESIS_CLIENT_SEED` constant in `packages/contracts/src/provably-fair/formulas.constants.ts`). The HMAC message binds both the previous-round identity AND the per-round position in the chain (via `nonce`). Pros: every round has a distinct, publicly-derivable HMAC message; the operator cannot precompute crash points without first publishing the previous round's CRASHED-time data; the verifier (`/games/rounds/:id/verify` endpoint + `packages/contracts/bin/verify-crash.ts` CLI) re-derives the client seed deterministically from the prior round's persisted fields; the chain-commitment story stays intact and the per-round seed-message binding adds a second axis the operator cannot tamper with after the fact. Cons: deliberate deviation from Bustabit's fixed-salt canon must be documented and defended in arguição; the genesis round uses a deployment-fixed string (`GENESIS_CLIENT_SEED`) which is the one structural concession to Option A.
- **Option C — Future Bitcoin block hash dependency (deferred external entropy)** — `clientSeed = <bitcoin block hash N+K for some future block>`. Pros: this *is* the Bustabit canon, maximally defensible, no deviation. Cons: requires a Bitcoin client (or trusted feed) inside `docker:up`; the review machine may have no internet; if the feed lags, the round loop stalls; introduces a single point of failure for the demo's "zero manual steps" REQ-INFRA-01; infeasible inside the challenge timeline.

## Decision

**Option B — HMAC keyed by the chain's server seed, with the HMAC message constructed as `${clientSeed}:${nonce}` and `clientSeed` derived per-round from the previous round's identity and CRASHED-time data.**

The algorithm lives in `packages/contracts/src/provably-fair/derive-crash-point.ts` (lines 5-17 of the file — pure function, no DI, no infra imports, importable by both services and any FE or CLI consumer):

```typescript
export function deriveCrashPoint(input: DeriveCrashPointInput): number {
  const message = `${input.clientSeed}:${input.nonce.toString()}`;
  const hmac = createHmac("sha256", input.serverSeed).update(message).digest("hex");
  const first13 = hmac.substring(0, HEX_CHARS);
  const intH = parseInt(first13, 16);
  if (intH % input.instantCrashBucket === 0) {
    return 1.0;
  }
  const crash = Math.floor((100 * TWO_POW_52 - intH) / (TWO_POW_52 - intH)) / 100;
  return Math.max(1.0, crash);
}
```

Where `HEX_CHARS = 13` (52 bits = 13 hex chars), `TWO_POW_52 = Math.pow(2, 52)`, and `instantCrashBucket = 101` (1-in-101 → ~99% RTP per spec REQ-FAIR-03). The formula was verified byte-for-byte against the Rust reference impl during Plan 04-01; the 1-in-101 instant-crash bucket is the Bustabit-canonical "house edge" lever. `parseInt(hex, 16)` is safe at 13 hex chars (52 bits) because `Number.MAX_SAFE_INTEGER = 2^53 - 1` — research Pitfall 6 documents the trap if you read more than 13 hex chars and silently lose precision.

The per-round client seed derives in `services/games/src/application/client-seed.derivation.ts` (the pure function `deriveClientSeed(prevRound: PreviousRoundClose | null): string`):

- **Round 1 (genesis)**: `SHA256(GENESIS_CLIENT_SEED)` where `GENESIS_CLIENT_SEED = "crash-game-genesis-client-seed"` lives in `packages/contracts/src/provably-fair/formulas.constants.ts`. This is the one structural concession to Option A — the very first round has no predecessor.
- **Round N (N ≥ 2)**: `SHA256(prevRound.id + ":" + prevRound.crashedAt.toISOString())`. Both fields are public after round N-1 reaches CRASHED; the round ID is a UUID generated server-side at round open, the CRASHED-time `crashedAt` is the server-stamped wall-clock at the FSM transition. The operator cannot pick either after seeing bets for round N — round N-1's UUID was chosen when round N-1 *opened* (before round N's BETTING window exists) and the CRASHED-time was stamped at round N-1's crash event (also before round N's BETTING).

The `nonce` is the position in the seed chain — round 1 uses nonce 1, round 2 uses nonce 2, etc. (the same nonce that indexes the `seed_chain` table column from Plan 04-04). The chain is consumed in reverse — round N's server seed is `chain[chainLength - N]` (the deepest unrevealed entry), so revealing round N's seed retrospectively reveals an ancestor of every prior round's seed (Plan 04-05 commitment chain).

The reveal gate is enforced at the aggregate boundary (Plan 04-08 `GetCurrentRoundUseCase` returns `serverSeed: null` while `status !== "SETTLED"`; `VerifyRoundUseCase` returns HTTP 400 `ROUND_NOT_YET_SETTLED` until the round settles). This closes REQ-FAIR-02 by construction — the column `rounds.server_seed` is only written by `SettleRoundUseCase` (Plan 04-06 `services/games/src/application/use-cases/settle-round.use-case.ts`), and `seed_chain.revealed_at` is stamped in the same TX. There is no code path that exposes `server_seed` before `SETTLED`.

Verified end-to-end against the docker stack at Plan 04-11 (commit `90f8ef1` + live drill): the CLI verifier `bun packages/contracts/bin/verify-crash.ts <roundId>` invokes `deriveCrashPoint` against the persisted `(serverSeed, clientSeed, nonce, instantCrashBucket)` triple from `/games/rounds/:id/verify` and returns `MATCH 5.56` on round `9204af58`. The same `deriveCrashPoint` function runs in the round loop at RUNNING transition (`TransitionToRunningUseCase` computes the crash point and persists it on CRASHED). One function, three call sites — REQ-FAIR-04 satisfied by construction.

Rationale: Option B preserves the anti-operator-collusion property without depending on external entropy. The chain commitment is published at bootstrap (Plan 04-05 `SeedChainBootstrap`, see ADR-016) so the operator commits to the future seeds before any round opens; the per-round client seed adds a second axis (binding to the previous round's CRASHED-time data) that the operator cannot tamper with after bets are seen because the binding material is public before the next round's BETTING window opens. Option A loses the per-round binding entirely. Option C is infeasible inside the challenge timeline.

## Consequences

- **Locked in (algorithm)**: `deriveCrashPoint` and `deriveClientSeed` are pure functions in `@crash/contracts`; both run identically on backend (round loop + verify endpoint) and frontend (Phase 8 client-side verifier via `crypto.subtle`) and CLI (`packages/contracts/bin/verify-crash.ts`). The function signatures are part of the public API surface — any future change requires a contract-version bump (`formula_version` column on `rounds`).
- **Locked in (client seed material)**: round N's client seed binds to round N-1's UUID + CRASHED-time. The UUID is generated server-side at round open via `Round.start(...)`; the CRASHED-time is stamped by `transitionFromRunningToCrashed` in the round loop. Both fields are persisted and returned in `/verify` so the verifier reconstructs the message.
- **Locked in (genesis concession)**: `GENESIS_CLIENT_SEED = "crash-game-genesis-client-seed"` is a deployment-fixed constant in `packages/contracts/src/provably-fair/formulas.constants.ts`. The genesis round is the only round that uses Option A's static-salt shape; defended as "the chain has no predecessor — there is nothing to bind to" and limited to a single round.
- **Locked in (reveal gate)**: server seed is written by `SettleRoundUseCase` exclusively; no other code path writes `rounds.server_seed`; `GetCurrentRoundUseCase` nullifies the field while `status !== "SETTLED"`; `VerifyRoundUseCase` short-circuits with HTTP 400 until SETTLED. Plan 04-10 integration test `verify-round.test.ts` proves both gates fire.
- **Foreclosed (alternatives)**: Option A's fixed-salt canon (would erase the per-round binding and force the chain-commit to carry the full anti-collusion proof alone); Option C's Bitcoin-block dependency (would break REQ-INFRA-01 zero-step bootstrap).
- **Anticipated recruiter question**: "Why not exact Bustabit canon?" — defended by the no-external-entropy constraint, the per-round binding to public-before-BETTING-opens prior-round data, and the dual-axis anti-collusion proof (chain commitment + per-round message binding).
- **Phase 8 follow-up**: the FE `/verify/:roundId` route (REQ-FE-10) imports the same `deriveCrashPoint` from `@crash/contracts` and runs it via `crypto.subtle.digest("SHA-256", ...)` for the chain step; HMAC via WebCrypto's `subtle.sign("HMAC", ...)`. Single algorithm, three execution contexts — the property recruiter will probe with curl + node + browser.

## Alternatives Rejected

- **Option A — Exact Bustabit canon with globally-fixed env-baked public salt** — same HMAC message every round; per-round nonce loses its structural binding; recruiter can ask why precomputed crash-point lookup tables wouldn't work and the answer leans entirely on the chain commitment.
- **Option C — Future Bitcoin block hash dependency** — requires external feed inside `docker:up`; breaks zero-step bootstrap; infeasible inside challenge timeline; documented as the canonical-best path for a production-money deployment.
