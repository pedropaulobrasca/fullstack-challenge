---
phase: 04-game-core
plan: 01
subsystem: contracts/provably-fair
tags: [provably-fair, hmac-sha256, hash-chain, pure-functions, fast-check]
requires: []
provides:
  - "@crash/contracts → src/provably-fair barrel: deriveCrashPoint, verifyCrashPoint, generateSeedChain, multiplierAt, crashTimeMs, FORMULA_VERSION, NUM_BITS, HEX_CHARS, TWO_POW_52, GENESIS_CLIENT_SEED, DEFAULT_INSTANT_CRASH_BUCKET, SeedChainEntry, DeriveCrashPointInput, VerifyCrashPointResult"
  - "CLI verifier bin: verify-crash (reads JSON on stdin → MATCH/MISMATCH)"
affects:
  - "Unblocks 04-06 (round loop service consumes deriveCrashPoint + crashTimeMs)"
  - "Unblocks 04-08 (verify endpoint re-exports the same pure functions)"
  - "Unblocks Phase 8 frontend /verify route (byte-identical import)"
tech_stack:
  added: ["fast-check@^3.23.0 (devDep aligned with services/wallets)"]
  patterns: ["barrel export per subdir", "node:crypto for HMAC + SHA-256", "fast-check property tests with fixed seed"]
key_files:
  created:
    - packages/contracts/src/provably-fair/formulas.constants.ts
    - packages/contracts/src/provably-fair/types.ts
    - packages/contracts/src/provably-fair/generate-seed-chain.ts
    - packages/contracts/src/provably-fair/derive-crash-point.ts
    - packages/contracts/src/provably-fair/verify-crash-point.ts
    - packages/contracts/src/provably-fair/multiplier.ts
    - packages/contracts/src/provably-fair/index.ts
    - packages/contracts/bin/verify-crash.ts
    - packages/contracts/tests/unit/provably-fair.test.ts
    - packages/contracts/tests/property/derive-crash-point.property.test.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/contracts/package.json
decisions:
  - "Bustabit-canon HMAC formula with per-round clientSeed contribution (ADR-015 deviation rationale)"
  - "Exact-byte lock test pins 2.94 for (serverSeed=0x00..01, clientSeed=test, nonce=0, bucket=101) — Risk R8 mitigation"
  - "fast-check pinned ^3.23.0 for monorepo alignment, not registry head 4.x"
metrics:
  duration_seconds: 275
  completed_at: 2026-05-26T00:33:10Z
  tasks_committed: 2
  test_count: 17
  expect_calls: 34080
  property_runs_total: 11000
---

# Phase 4 Plan 01: Provably-Fair Pure-Function Module Summary

Pure-function provably-fair module shared between `games-service` and the future frontend `/verify` route, anchored to the Bustabit-canon HMAC-SHA-256 52-bit formula with a per-round client-seed contribution. Zero infra imports, zero new runtime dependencies (uses `node:crypto`).

## Artifacts created

| File | Purpose |
|------|---------|
| `formulas.constants.ts` | `FORMULA_VERSION=1`, `NUM_BITS=52`, `HEX_CHARS=13`, `TWO_POW_52`, `GENESIS_CLIENT_SEED`, `DEFAULT_INSTANT_CRASH_BUCKET=101` — all `as const` |
| `types.ts` | `SeedChainEntry`, `DeriveCrashPointInput`, `VerifyCrashPointResult` |
| `generate-seed-chain.ts` | Reverse-iterated hex-sha256 chain; terminal seed at index `length-1` |
| `derive-crash-point.ts` | `HMAC-SHA-256(serverSeed, "${clientSeed}:${nonce}")`, first 13 hex chars → `intH`, instant-crash bucket via `intH % bucket === 0`, formula `floor((100·2^52 − intH)/(2^52 − intH))/100` clamped at 1.00 |
| `verify-crash-point.ts` | Recompute + strict equality, returns `{matches, recomputed}` |
| `multiplier.ts` | `multiplierAt(t,r) = exp(r·t/1000)`, `crashTimeMs(r,c) = round(ln(c)/r·1000)`, both throw on non-positive growth rate |
| `bin/verify-crash.ts` | Bun-executable CLI; reads JSON on stdin, prints `MATCH ${recomputed}` (exit 0) or `MISMATCH expected=… got=…` (exit 1) |

## Exact-byte lock vector

| Input | Value |
|-------|-------|
| serverSeed | `0000000000000000000000000000000000000000000000000000000000000001` |
| clientSeed | `test` |
| nonce | `0` |
| instantCrashBucket | `101` |
| **Recomputed crash point** | **`2.94`** |

This literal is pinned in `tests/unit/provably-fair.test.ts` with the comment "EXACT-BYTE LOCK". Any silent Bun-crypto regression or constant drift fails this test loudly.

Instant-crash sanity vector: same seeds with `nonce=160` triggers `intH % 101 === 0` and returns exactly `1.00`.

## Test results

```
17 pass / 0 fail / 34080 expect() calls
Ran 17 tests across 2 files in 140ms
```

- Unit suite (`tests/unit/provably-fair.test.ts`): 13 tests — exact-byte lock, instant-crash bucket, chain integrity, nonce indexing, verifyCrashPoint match/mismatch, multiplierAt + crashTimeMs round-trip and guards.
- Property suite (`tests/property/derive-crash-point.property.test.ts`): 1000 runs of full input determinism + 10 000 runs of `parseInt(first13,16)` finiteness (Pitfall 6 / Risk R6 mitigation). Total 11 000 property iterations. Completed in well under the 30 s timeout.

## CLI verifier example invocation

```bash
echo '{"serverSeed":"0000000000000000000000000000000000000000000000000000000000000001","clientSeed":"test","nonce":"0","instantCrashBucket":101,"expectedCrashPoint":2.94}' \
  | bun packages/contracts/bin/verify-crash.ts
# → MATCH 2.94   (exit 0)

echo '{"serverSeed":"0000000000000000000000000000000000000000000000000000000000000001","clientSeed":"test","nonce":"0","instantCrashBucket":101,"expectedCrashPoint":9.99}' \
  | bun packages/contracts/bin/verify-crash.ts
# → MISMATCH expected=9.99 got=2.94   (exit 1)
```

## Decisions

1. **Bustabit-canon formula with HMAC-keyed-by-serverSeed over `${clientSeed}:${nonce}`** — locks the per-round client-seed contribution (ADR-015 rationale: substitutes for Bustabit's future-Bitcoin-block-hash global seed without losing anti-collusion). The 52-bit extraction and `floor((100·e − H)/(e − H))/100` derivation are byte-equivalent to the vladignatyev/bustabit-rust reference.
2. **Exact-byte lock test as a Risk R8 tripwire** — any cross-version Bun crypto drift fails CI loudly.
3. **`fast-check` pinned to `^3.23.0`** for monorepo alignment (services/wallets precedent), not the registry head 4.x.
4. **CLI uses `Bun.stdin.text()` and `#!/usr/bin/env bun` shebang** — no transpile step, ships as TS.
5. **Generate-seed-chain hashes hex input** (`.update(input, "hex")`) to match the Bustabit Rust reference's hex-iterated chain convention.

## Deviations from Plan

None of substance. One minor scope note: `bun install` reconciled the workspace lockfile and also surfaced devDep edits made concurrently by parallel waves (04-02, 04-07). I deliberately did NOT stage `bun.lock` or any `services/games/*` change — those land in their own plan's commit. My commits touch only `packages/contracts/*` exactly per the plan's "Touch ONLY" rule.

## Commits

| Hash | Message |
|------|---------|
| `914fd30` | feat(04-01): pure-function provably-fair module with Bustabit-canon HMAC formula |
| `50cb92f` | test(04-01): provably-fair unit + 1000-run determinism property + CLI verifier |

## Self-Check: PASSED

- `packages/contracts/src/provably-fair/formulas.constants.ts` — FOUND
- `packages/contracts/src/provably-fair/types.ts` — FOUND
- `packages/contracts/src/provably-fair/generate-seed-chain.ts` — FOUND
- `packages/contracts/src/provably-fair/derive-crash-point.ts` — FOUND
- `packages/contracts/src/provably-fair/verify-crash-point.ts` — FOUND
- `packages/contracts/src/provably-fair/multiplier.ts` — FOUND
- `packages/contracts/src/provably-fair/index.ts` — FOUND
- `packages/contracts/bin/verify-crash.ts` — FOUND
- `packages/contracts/tests/unit/provably-fair.test.ts` — FOUND
- `packages/contracts/tests/property/derive-crash-point.property.test.ts` — FOUND
- Commit `914fd30` — FOUND in git log
- Commit `50cb92f` — FOUND in git log
- `bunx tsc --noEmit` from packages/contracts — clean
- `grep -rE "@crash|@nestjs|@mikro-orm" packages/contracts/src/provably-fair/` — returns nothing
- 17/17 tests pass
