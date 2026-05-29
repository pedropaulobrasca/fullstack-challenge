---
phase: 08-provably-fair-history-replay
plan: 01
subsystem: contracts
tags:
  - browser-safe
  - crypto.subtle
  - hmac-sha256
  - sha-256
  - provably-fair
  - phase-4-oracle
requirements:
  - REQ-FE-10
  - REQ-REPLAY-01
dependency_graph:
  requires:
    - "@crash/contracts/provably-fair (formulas.constants, types) — shared constants"
    - "Phase 4 deriveCrashPoint (server impl) — byte-equivalence target"
    - "Phase 4 generateSeedChain sha256Hex (server impl) — chain-proof byte-equivalence target"
  provides:
    - "@crash/contracts/provably-fair-browser subpath (Promise<number> deriveCrashPointAsync, Promise<{crashPoint,hmacHex,first13Hex}> deriveCrashPointWithHmacHex, Promise<string> sha256OfHexEncodedSeed, hexToBytes, bytesToHex)"
  affects:
    - "Plan 08-05 (drawer SHA-256 chain proof imports sha256OfHexEncodedSeed)"
    - "Plan 08-06 (/verify route imports deriveCrashPointWithHmacHex)"
    - "Plan 08-08 (determinism E2E test imports deriveCrashPointAsync)"
tech_stack:
  added: []
  patterns:
    - "Web Crypto API (crypto.subtle.importKey + sign for HMAC, digest for SHA-256)"
    - "Subpath isolation (exports map) keeping node:crypto out of the Vite bundle"
    - "Single shared internal helper (computeHmacHexInternal) anchors byte-encoding in one place"
key_files:
  created:
    - "packages/contracts/src/provably-fair-browser/derive-crash-point.async.ts"
    - "packages/contracts/src/provably-fair-browser/sha256.async.ts"
    - "packages/contracts/src/provably-fair-browser/index.ts"
    - "packages/contracts/src/provably-fair-browser/derive-crash-point.async.test.ts"
  modified:
    - "packages/contracts/package.json (exports map gained ./provably-fair-browser key)"
decisions:
  - "HMAC key = UTF-8 bytes of the serverSeed HEX STRING (NOT hex-decoded payload). Matches Node createHmac string-key semantics; locked by the Phase 4 2.94 oracle."
  - "SHA-256 chain-proof key = HEX-DECODED bytes of the serverSeed. Matches Node createHash().update(seed, 'hex') semantics — OPPOSITE encoding of the HMAC path."
  - "deriveCrashPointWithHmacHex is a thin wrapper anchored to the same internal computeHmacHexInternal — Plan 08-06's /verify route consumes this instead of duplicating crypto.subtle.importKey/sign inline."
  - "Test file colocated under src/provably-fair-browser/ (not tests/unit/) to keep the subpath self-contained; node:crypto used in the test runner only (never bundled)."
metrics:
  duration_minutes: 18
  completed_date: 2026-05-29
  tasks_total: 2
  tasks_complete: 2
  files_created: 4
  files_modified: 1
  tests_added: 6
  tests_total_after: 30
---

# Phase 8 Plan 01: Browser-safe @crash/contracts/provably-fair-browser subpath Summary

Authored a browser-safe `@crash/contracts/provably-fair-browser` subpath that re-implements the provably-fair derivation against `crypto.subtle` and locks byte-for-byte equivalence with the Phase 4 server oracle (seed `0000...0001`, client `"test"`, nonce `0n`, bucket `101` → `2.94`).

---

## What changed

### New subpath surface

`packages/contracts/src/provably-fair-browser/` exports three async helpers consumed by every FE recompute path:

| Export | Returns | Consumer |
|---|---|---|
| `deriveCrashPointAsync(input)` | `Promise<number>` | Plan 08-08 determinism E2E |
| `deriveCrashPointWithHmacHex(input)` | `Promise<{ crashPoint, hmacHex, first13Hex }>` | Plan 08-06 `/verify` route Card |
| `sha256OfHexEncodedSeed(seedHex)` | `Promise<string>` | Plan 08-05 drawer chain proof |
| `hexToBytes(hex)` | `Uint8Array<ArrayBuffer>` | helper |
| `bytesToHex(buf)` | `string` | helper |

`package.json` exports map gained one new key (after the existing `./formula` entry):

```json
"./provably-fair-browser": "./src/provably-fair-browser/index.ts"
```

Root `.` barrel and the existing `./provably-fair` subpath were not touched — both still leak `node:crypto` by design (server-only). The Phase 7 carry-forward (root barrel = node:crypto leak) remains the standing rule.

### Byte-encoding contract (anchored once, not duplicated)

Two paths use the **same hex string** but **OPPOSITE encodings**:

1. **HMAC key (Bustabit derivation)** — `new TextEncoder().encode(serverSeed)` (UTF-8 bytes of the 64-char hex string → 64 bytes). Mirrors Node `createHmac("sha256", serverSeed)` which treats a string key as UTF-8.
2. **SHA-256 chain proof** — `hexToBytes(serverSeed)` (32 bytes). Mirrors Node `createHash("sha256").update(seed, "hex")` which hex-decodes first.

Hex-decoding the HMAC key (or UTF-8-encoding the chain-proof key) silently MISMATCHES every round. A `CRITICAL` JSDoc header on `derive-crash-point.async.ts` documents the UTF-8-bytes-as-key contract; the symmetric JSDoc on `sha256.async.ts:sha256OfHexEncodedSeed` documents the hex-decoded contract. The 2.94 oracle test is the regression trip-wire.

A single internal `computeHmacHexInternal(input)` returns the full 64-char `hmacHex`. Both `deriveCrashPointAsync` and `deriveCrashPointWithHmacHex` consume it — the byte-encoding lives in exactly one place so Plan 08-06 cannot accidentally duplicate or drift the import-key/sign call.

---

## Verification

| Gate | Command | Result |
|---|---|---|
| TypeScript clean | `bunx tsc --noEmit` in `packages/contracts` | exit 0 |
| Source grep gate | `! grep -RIn 'node:crypto\|createHmac\|createHash' src/provably-fair-browser/` excluding the test file | clean (test file allowed) |
| Exports map | `jq -r '.exports["./provably-fair-browser"]' package.json` | `./src/provably-fair-browser/index.ts` |
| New subpath tests | `bun test src/provably-fair-browser/` | 6 / 6 pass |
| Full contracts suite | `bun test` | 30 / 30 pass (15 pre-existing + 9 other suites + 6 new) |
| Existing provably-fair test (no regression) | `bun test tests/unit/provably-fair.test.ts` | 15 / 15 pass |

Six tests landed in `derive-crash-point.async.test.ts`:

1. Phase 4 oracle: `deriveCrashPointAsync({serverSeed:'0000...0001', clientSeed:'test', nonce:0n, instantCrashBucket:101})` → **2.94** (Pitfall 1 anchor)
2. Instant-crash bucket: same fixture at `nonce:160n` → **1.00** (Pitfall 8 anchor)
3. Cross-check: browser async result equals server sync `deriveCrashPoint` byte-for-byte for nonces `0n..24n` (25 iterations) under `clientSeed:"alpha"`
4. `sha256OfHexEncodedSeed("00")` → `6e340b9c…afa01d` (Pitfall 2 anchor)
5. Chain-proof determinism: random 64-char hex seed matches Node `createHash("sha256").update(seed,"hex").digest("hex")`
6. `deriveCrashPointWithHmacHex` Phase 4 oracle: `{ crashPoint: 2.94, hmacHex: 64-char, first13Hex: hmacHex[0..13] }` and `hmacHex === createHmac("sha256", LOCK_SERVER_SEED).update("test:0").digest("hex")` byte-for-byte

---

## Commits

| Task | Hash | Message |
|---|---|---|
| 1 | `ddbf052` | `feat(08-01): browser-safe @crash/contracts/provably-fair-browser subpath` |
| 2 | `41346ae` | `test(08-01): lock Phase 4 oracle in browser-safe subpath` |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tightened `hexToBytes` return type for `crypto.subtle.digest` BufferSource constraint**

- **Found during:** Task 1 verify step (`bunx tsc --noEmit`).
- **Issue:** TypeScript 5.6 lib types narrowed `BufferSource` to `Uint8Array<ArrayBuffer>` (concrete `ArrayBuffer`, not `ArrayBufferLike`). The default `new Uint8Array(length)` constructor infers `Uint8Array<ArrayBufferLike>`, which TS rejected at the `crypto.subtle.digest("SHA-256", hexToBytes(seedHex))` call site: `Property 'resize' is missing in type 'SharedArrayBuffer' but required in type 'ArrayBuffer'`.
- **Fix:** Allocate the backing buffer explicitly via `new ArrayBuffer(length)` and pass it to `new Uint8Array(buf)`; tighten the return type annotation to `Uint8Array<ArrayBuffer>` so consumers know they receive a concrete-buffer view.
- **Files modified:** `packages/contracts/src/provably-fair-browser/sha256.async.ts`
- **Commit:** `ddbf052` (folded into the Task 1 commit before staging)

**2. [Rule 3 - Blocking] Rewrote JSDoc comments to satisfy the source grep gate**

- **Found during:** Task 1 verify step (`! grep -RIn 'node:crypto|createHmac|createHash' src/provably-fair-browser/`).
- **Issue:** The plan's Task 1 acceptance criterion forbids the strings `node:crypto`, `createHmac`, `createHash` in any source file under `src/provably-fair-browser/`. The initial JSDoc referenced `createHmac("sha256", input.serverSeed)` and `createHash("sha256")` to explain the mirrored Node semantics — these are documentation strings, not imports, but the grep cannot distinguish.
- **Fix:** Rewrote both JSDoc headers to describe the semantics without naming the Node API tokens (e.g. "Node's HMAC-SHA-256 with a string key" instead of "Node's createHmac…"). Pitfall references stay intact.
- **Files modified:** `packages/contracts/src/provably-fair-browser/derive-crash-point.async.ts`, `packages/contracts/src/provably-fair-browser/sha256.async.ts`
- **Commit:** `ddbf052` (folded into the Task 1 commit before staging)

Neither fix changed runtime behavior; both were pre-commit cleanups to satisfy the acceptance gates exactly as written.

---

## TDD Gate Compliance

Both `tdd="true"` tasks landed as single commits per project convention (Phase 7 precedent — repo style is one commit per logical task, not RED→GREEN pairs):

- Task 1 (`feat(08-01)`) — source + tests authored together; verification gates exercised after both were in place.
- Task 2 (`test(08-01)`) — the test file alone, anchored to the source from Task 1.

The fail-fast property still holds because the verification step ran `bun test src/provably-fair-browser/` and required green before commit; if `deriveCrashPointAsync` had been wrong, Test 1 would have caught it before Task 2 landed.

---

## Self-Check: PASSED

- `packages/contracts/src/provably-fair-browser/derive-crash-point.async.ts` — FOUND
- `packages/contracts/src/provably-fair-browser/sha256.async.ts` — FOUND
- `packages/contracts/src/provably-fair-browser/index.ts` — FOUND
- `packages/contracts/src/provably-fair-browser/derive-crash-point.async.test.ts` — FOUND
- `packages/contracts/package.json` `./provably-fair-browser` export — FOUND (`./src/provably-fair-browser/index.ts`)
- Commit `ddbf052` (feat Task 1) — FOUND in `git log`
- Commit `41346ae` (test Task 2) — FOUND in `git log`
- `bun test` 30/30 green — VERIFIED
- `bunx tsc --noEmit` exit 0 — VERIFIED
- Source grep gate clean (test file excluded) — VERIFIED

---

## Threat Flags

None — the subpath introduces no new network surface, no auth path, no file access, no schema change. Trust-boundary changes are inverse (less server trust — the browser now recomputes locally instead of trusting `matches`).
