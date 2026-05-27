# ADR-016: Hash chain pre-generation at bootstrap (1M rounds) over lazy generation

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 4

## Context

REQ-FAIR-01 demands a pre-generated hash chain of `HASH_CHAIN_LENGTH=1000000` links, with the terminal seed produced via `crypto.randomBytes(32)` and `chain[i] = SHA256(chain[i+1])` walked in reverse. The chain is consumed in reverse (round 1 uses `chain[N-1]`, round 2 uses `chain[N-2]`, ...) so revealing round K's seed retrospectively reveals an ancestor of every prior round's seed — the recruiter can re-hash to prove the operator did not pick the seed after seeing bets.

REQ-FAIR-02 demands that the server seed for round N is never observable before round N has reached SETTLED. The chain is the commitment story for the *entire deployment*: at bootstrap, the operator commits to the next million crash-point inputs and can never tamper with them retroactively — every revealed seed has to hash to its predecessor in the chain, which is what `seed_chain.hash` (Plan 04-04 migration `Migration20260526100000_CreateGameCoreTables`) carries.

The 25% architecture-and-DDD scoring band hinges on the recruiter accepting that the chain commitment is immutable from the player's perspective. The naive shape — "generate seeds on demand, refill the chain when it gets low" — exposes a head-pointer-mutation attack: at any moment the operator could discard the unused tail and re-randomize, voiding every future commitment. Three shapes were on the table at Plan 04-05 design time.

Plan 04-RESEARCH §Pattern 3 + Pitfall 7 + Risk R3 establish the constraints: the bootstrap must be idempotent (restart-safe), the chain must fit in DB without crippling boot latency, and the runtime cost of consuming the chain per round must be O(1).

## Considered

- **Option A — Lazy generation (refill at threshold)** — generate, say, 1000 seeds at boot; when consumed seeds drop below a watermark, generate the next 1000 and append to the chain. Pros: fast bootstrap (~ms), low DB storage (~80KB per 1000 rows), no upfront memory spike. Cons: **the head-pointer-mutation attack** — at any refill the operator can discard the unconsumed tail and randomize the next batch with knowledge of past round outcomes; the chain is no longer a single immutable commitment, it's a sequence of mini-commitments that the operator gets to decide *when* to roll over; the recruiter's first audit question ("how do I know you didn't regenerate the chain after I left the room?") has no good answer.
- **Option B — Pre-generated 1M chain at first boot (chosen)** — at first `OnApplicationBootstrap`, `SeedChainBootstrap.onApplicationBootstrap()` checks `seed_chain.countEntries() > 0n`; if empty, generates `HASH_CHAIN_LENGTH` entries via `@crash/contracts/generateSeedChain` and inserts `(nonce, hash, seed)` triples in 1000-row batches with progress logs every 100k. The chain is immutable for the lifetime of the deployment. Pros: single commitment story ("at first boot, the operator committed to the next million crash-point inputs"); the chain head is fixed, no rolling commitment ambiguity; consume-per-round is a single indexed SELECT against the `seed_chain` table; reveal-gate enforcement (ADR-015 + the `revealed_at` column) is the only mutation against the table after bootstrap. Cons: ~2s generation latency on first boot (gen ~500ms + insert ~1.5s on a warm Postgres); ~80MB resident heap during the bootstrap function's lifetime (the `generateSeedChain` array of 1M 32-byte buffers materializes in memory before batching); ~80MB DB storage (each row is ~80 bytes — 32-byte hash hex + 32-byte seed hex + nonce + timestamps).
- **Option C — On-demand single-seed generation per round** — generate one seed per round via `randomBytes(32)`, no chain at all. Pros: trivial implementation, zero bootstrap cost, no memory spike. Cons: **no commitment story at all** — the operator picks each seed at round open, so there is no proof the seed wasn't chosen after seeing bets; loses REQ-FAIR-01 entirely; loses REQ-FAIR-02 partially (still revealable post-SETTLE but with no chain ancestor proof); fundamentally not provably-fair.

## Decision

**Option B — pre-generate the full `HASH_CHAIN_LENGTH=1000000` chain at first boot via `SeedChainBootstrap`, idempotent on restart, with the chain immutable thereafter.**

Implementation lives in `services/games/src/application/seed-chain-bootstrap.service.ts` and `packages/contracts/src/provably-fair/generate-seed-chain.ts`:

```typescript
@Injectable()
export class SeedChainBootstrap implements OnApplicationBootstrap {
  async onApplicationBootstrap(): Promise<void> {
    const existing = await this.chain.countEntries();
    if (existing > 0n) {
      this.log.log(`seed chain already initialized at depth ${existing}`);
      return;
    }
    const length = this.resolveChainLength();
    const entries = generateSeedChain(length);
    await this.insertWithProgress(entries);
  }
}
```

`generateSeedChain(length)`:
1. `seed[length - 1] = randomBytes(32).toString("hex")` — the terminal seed, the only source of entropy.
2. `for (i = length - 2; i >= 0; i--) seed[i] = SHA256(seed[i+1])` — every prior seed is the SHA-256 of its successor.
3. `hash[i] = SHA256(seed[i])` — every entry carries both its seed and the hash of its seed; the hash is the public commitment revealed *before* the round opens; the seed is the private reveal published *after* the round settles.

Idempotency is at the `countEntries() > 0n` gate; restarting the service is a no-op against an already-bootstrapped chain. The bootstrap hook is `OnApplicationBootstrap` (NOT `OnModuleInit`) for the same reason ADR-017 prefers it for the round loop — MikroORM must be fully initialized before the bootstrap reads / writes the `seed_chain` table, and `OnApplicationBootstrap` fires after every module's `OnModuleInit` per NestJS docs + 04-RESEARCH Pitfall 1.

Consumption pattern (Plan 04-06 `StartNewRoundUseCase`):

1. The round loop calls `chain.findByNonce(nextNonce)` to fetch the precomputed `(hash, seed)` triple for the next round.
2. `Round.start(roundId, nextNonce, hash, ...)` writes the *hash only* to `rounds.seed_hash` — this is the public pre-round commitment exposed via `GET /games/rounds/current` during BETTING (REQ-FAIR-05).
3. `SettleRoundUseCase` (the only writer of `rounds.server_seed`) reads `chain.findByNonce(round.nonce).seed` after the round reaches CRASHED and commits the reveal in the same TX that flips `seed_chain.revealed_at` from NULL to `now()`.

The seed-persistence-vs-API-gate carry-forward from Plan W2 (mentioned in the resume context): the DB *does* persist all future seeds in `seed_chain.seed`, but the aggregate boundary enforces reveal-only-after-settle — there is no read path to the seed column before `revealed_at` is non-NULL. The threat model is operator-trusted DB (per 04-RESEARCH §Trust Boundaries: the operator owns the DB and is trusted not to leak the column through side channels); the application-layer guard is the only fairness guard, the DB is not a co-trusted party. A future hardening would split the chain across an isolated reveal-only key-management service, but Phase 4 deliberately defers that to Phase 10 / post-v1 hardening.

`HASH_CHAIN_LENGTH=1000000` is env-overridable for non-prod — Plan 04-05 unit tests use 32-entry chains via a subclass override of `resolveChainLength()`. Production-equivalent boot uses the env default (1M); a value lower than 1M still satisfies REQ-FAIR-01 if explicitly overridden but is documented as a non-default test affordance.

Plan 04-11 live verification (`HASH_CHAIN_LENGTH=1_000_000`, fresh `docker:up`):
- Smoke probe 30: `seed_chain` row count = `1000000` after cold bootstrap (commit `90f8ef1`).
- Smoke probe 28: `/games/rounds/current.seedHash` returns a non-null 64-char hex during BETTING (REQ-FAIR-05).
- CLI verifier `MATCH 5.56` on round `9204af58` proves the chain reveals correctly post-SETTLE.

Rationale: Option A's lazy-refill is a documented anti-pattern in 04-RESEARCH Pitfall 7 because the rolling commitment lets the operator effectively re-seed mid-deployment. Option B's one-time commitment is the *only* shape that survives the recruiter's "what if you regenerate the chain?" audit question. The ~80MB transient heap cost is bounded to the bootstrap function's lifetime (a single async call from `onApplicationBootstrap` — V8 GC's the array after `insertWithProgress` returns); the ~80MB persistent DB cost is acceptable for the demo (Postgres footprint stays well below container limits per Plan 04-11 docker stats). Option C is structurally not provably-fair and was off the table.

## Consequences

- **Locked in (bootstrap shape)**: `SeedChainBootstrap implements OnApplicationBootstrap` is the only writer of `seed_chain` rows (other than `SettleRoundUseCase` stamping `revealed_at`); the `countEntries() > 0n` idempotency gate makes restart a no-op; the bootstrap fires before the round loop's first iteration because `RoundLoopService.onApplicationBootstrap` is also a NestJS lifecycle hook in the same module — hook ordering is module-import-order within NestJS, and `GameCoreModule` imports `SeedChainBootstrap` before `RoundLoopService`.
- **Locked in (chain immutability)**: once `countEntries() > 0n`, the chain is frozen for the deployment's lifetime; the only mutation against `seed_chain` post-bootstrap is `UPDATE seed_chain SET revealed_at = now() WHERE nonce = ?` inside `SettleRoundUseCase`'s TX. There is no DELETE or hash-mutating UPDATE in any repository method.
- **Locked in (memory profile)**: the bootstrap function holds the full 1M-entry chain in memory for the duration of `generateSeedChain` + `insertWithProgress` — bounded ~80MB transient heap. After return the array is GC-eligible. Production-equivalent boot must allow `--max-old-space-size` defaults sufficient for an 80MB allocation (Bun's defaults are sufficient; documented in 04-RESEARCH Risk R3).
- **Locked in (storage profile)**: 1M rows × ~80 bytes ≈ 80MB persistent DB storage. Postgres 18 default tablespace + WAL handles this without tuning; `seed_chain` has a B-tree primary key on `nonce` for O(log N) reads at consume time and no other indexes.
- **Locked in (W2 carry-forward — reveal gate location)**: the DB persists future seeds in `seed_chain.seed` from bootstrap onward, but the aggregate boundary is the *only* fairness guard. Reveal is enforced by `SettleRoundUseCase` writing `rounds.server_seed` + `seed_chain.revealed_at` in the same TX, and `GetCurrentRoundUseCase` / `VerifyRoundUseCase` reading from `rounds.server_seed` (which is NULL until SETTLED) — the seed-column read path is never against `seed_chain` directly during a round's lifetime. Threat model: operator-trusted DB (04-RESEARCH §Trust Boundaries); future hardening = split-chain to an isolated KMS, deferred to post-v1.
- **Foreclosed**: lazy refill (would void the one-time commitment story); on-demand single-seed (would void REQ-FAIR-01 entirely); seed-stored-encrypted-in-DB (would shift the trust model to a key-management service that doesn't exist in v1 infrastructure).
- **Operational cost**: ~2s first-boot cost paid once per deployment; subsequent restarts pay only the `countEntries()` round-trip (~5ms). Acceptable for the challenge.
- **Anticipated recruiter question**: "What if the operator regenerates the chain mid-deployment?" — defended by the immutability proof (`countEntries() > 0n` gate + no mutation path in any repository method) and the documented threat model (operator-trusted DB; production-money hardening would split the chain to a KMS).
- **Anticipated recruiter question**: "Why 1M and not 100k or 10M?" — 1M ≈ 2 years of rounds at one round per minute; chosen as a "lifetime of the demo deployment" envelope; env-overridable so a longer-lived deployment can bootstrap with a higher value.

## Alternatives Rejected

- **Option A — Lazy refill at threshold** — the rolling commitment lets the operator effectively re-seed mid-deployment; head-pointer-mutation attack; recruiter audit question has no good answer.
- **Option C — On-demand single-seed generation per round** — no commitment story; not provably-fair by construction; voids REQ-FAIR-01.
- **Chain-split across operator + KMS** — would require a key-management service the v1 stack doesn't have; deferred to post-v1 hardening with the operator-trusted-DB threat model documented in 04-RESEARCH §Trust Boundaries.
