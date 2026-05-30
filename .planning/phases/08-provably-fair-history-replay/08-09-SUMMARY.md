---
phase: 08-provably-fair-history-replay
plan: 09
subsystem: docs
tags:
  - readme
  - provably-fair
  - recruiter-runnable
  - openssl
  - python3
  - phase-4-oracle
  - byte-encoding
  - pitfall-1
  - pitfall-2
requirements:
  - REQ-FE-10
dependency_graph:
  requires:
    - "Plan 08-01 byte-encoding contract: createHmac string-key (UTF-8) vs createHash hex-decoded — `packages/contracts/src/provably-fair/derive-crash-point.ts` + `generate-seed-chain.ts`"
    - "Plan 08-02 verify endpoint shape (`bets[]`, `growthRate`, the five fields the `jq -r` calls extract)"
    - "Plan 08-08 Phase 4 locked-byte tuple anchor + the 2.94 oracle exercised at the FE determinism layer"
  provides:
    - "README.md `Provably Fair: Verify Outside the App` section — recruiter-runnable shell walkthrough that reproduces 2.94 from the Phase 4 oracle using only openssl + python3 (no docker, no curl, no Node)"
    - "Documented expected output for Step A (`SHA2-256(stdin)= ec4916dd…afa01d`) and Step B (`HMAC = a9aa7f5914337…b8c050b`, `first13 = a9aa7f5914337`, `intH = 2984795937260343`, `crashPoint = 2.94`)"
    - "Empirically-confirmed MISMATCH symptom (`3.02` instead of `2.94`) when the Pitfall 1 byte encoding is reversed via `-macopt hexkey:`"
  affects:
    - "Plan 08-10 (Phase 8 closeout will cite the recruiter walkthrough as the proof artifact for Phase 8 ROADMAP success criterion 5)"
    - "Recruiter arguição (the README section IS the defensible-trust artifact: any reviewer can run it from a fresh shell in ~10 seconds and see 2.94 land without spinning up the stack)"
tech_stack:
  added: []
  patterns:
    - "Three-subsection recruiter doc structure: (a) generic live-round flow with `curl | jq` to extract the five fields, (b) hardcoded worked example so the reviewer can run with zero project state, (c) byte-encoding rationale that grounds the why behind the two different SHA-256 invocations"
    - "Output-prefix normalisation via `awk '{print $NF}'` so the pipeline works against both LibreSSL (`SHA2-256(stdin)= …`) and OpenSSL 3 (`SHA256(stdin)= …`) without branching"
    - "Busybox-aware portability: `python3 binascii.unhexlify` fallback when `xxd -r -p` is unavailable; verified to produce the byte-identical Step A digest"
key_files:
  created: []
  modified:
    - "README.md (new section between ADR catalogue and Roadmap; +116 lines, 0 deletions)"
    - ".planning/STATE.md (Current Position, Plan field, Next action, Last-updated footer rotated to P08-09)"
    - ".planning/ROADMAP.md (08-09 row checked off; Progress table Phase 8 advanced from 0/0 Not started → 9/10 In progress)"
    - ".planning/REQUIREMENTS.md (REQ-FE-10 traceability evidence extended with the P08-09 walkthrough artifact)"
decisions:
  - "Wrote the README section using the exact byte-output I captured from a fresh-shell dry-run (`SHA2-256(stdin)= ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5` for Step A, `HMAC = a9aa7f591433757689bc898f5167109490f954c4d895901f65042c332b8c050b` for Step B) instead of relying on the Plan 08-01 anchor value (`6e340b9c…afa01d`). The 08-01 anchor is the digest of `sha256OfHexEncodedSeed('00')` — a single zero byte — whereas the README's seedHash example hashes the 32-byte hex-decode of `0x0…01` (32 bytes ending in a single `01`). Both digests are correct for their respective inputs; the README ships the one it actually produces."
  - "Inserted the new section between `Architecture Decision Records` (h2 anchor of high-level reasoning artifacts) and `Roadmap` (h2 anchor of phase status). A new top-level h2 fits the existing structure; making it an h3 under Architecture would have hidden it from the README table-of-contents scroll."
  - "Demonstrated the Pitfall 1 failure mode (`3.02` instead of `2.94`) empirically in the dry-run rather than asserting it abstractly. The README's explainer paragraph cites the concrete number so a reviewer who tries the wrong encoding sees the predicted symptom and recognises the bug class instantly."
  - "Used `awk '{print $NF}'` to extract the digest field from the openssl output. Tested against macOS LibreSSL (`SHA2-256(stdin)= <hex>`) — the `$NF` of either prefix is always the digest, so the pipeline is portable without `tr` / `sed` / regex matching on a version-specific prefix."
  - "Recruiter checkpoint (Task 2) self-approved per the prompt's `<dry_run_instruction>` clause. I ran the worked example twice from a fresh shell — once before drafting the README, once again copy-pasting the literal block from the merged README — and both runs landed `crashPoint = 2.94`. The captured outputs are reproduced verbatim in the README under 'Expected output (reproduced verbatim on macOS with LibreSSL 3.x)'."
metrics:
  duration_minutes: 7
  completed_date: 2026-05-30
  tasks_total: 2
  tasks_complete: 2
  files_created: 0
  files_modified: 1
---

# Phase 8 Plan 09: Recruiter-Runnable Provably-Fair Verification Walkthrough Summary

**README.md gains a `Provably Fair: Verify Outside the App` section with a `curl` + `jq` + `openssl` + `python3` walkthrough that reproduces the Phase 4 oracle's `2.94` crashpoint from a fresh shell — no docker, no live round, no Node — so the recruiter can verify a round in ~10 seconds without trusting the server.**

---

## Performance

- **Duration:** ~7 min
- **Completed:** 2026-05-30
- **Tasks:** 2 of 2 (Task 1 implementation; Task 2 dry-run checkpoint self-approved per prompt)
- **Files modified:** 1 source (README.md) + 3 planning (STATE / ROADMAP / REQUIREMENTS)

---

## Accomplishments

- A recruiter-runnable shell walkthrough now exists in `README.md` that reproduces the Phase 4 oracle's `crashPoint = 2.94` end-to-end from the locked-byte tuple, using only `openssl` and `python3`.
- The two byte-encoding semantics — `createHmac("sha256", serverSeed)` consumes the seed as the UTF-8 of the 64-char hex string; `createHash("sha256").update(seed, "hex")` hex-decodes first — are both documented and demonstrated, with the empirically-confirmed `3.02` failure mode if the encodings are swapped.
- The generic live-round flow uses `curl $BASE/games/rounds/$ROUND_ID/verify | jq` to extract the five fields the verify endpoint exposes (`serverSeed`, `serverSeedHash`, `clientSeed`, `nonce`, `crashPoint`) — directly consuming the DTO that Plan 08-02 shipped.
- Portability is explicit: macOS LibreSSL `SHA2-256(stdin)= ` vs OpenSSL 3 `SHA256(stdin)= ` prefixes are both handled via `awk '{print $NF}'`; busybox shells without `xxd` get a `python3 binascii.unhexlify` fallback that I verified produces the byte-identical Step A digest.
- Phase 8 ROADMAP success criterion 5 ("README documents the provably-fair algorithm with a curl + third-party SHA-256 example so a recruiter can verify a round outside the app") is now satisfied as a recruiter-readable artifact, not just an implementation-readable test.

---

## Task Commits

1. **Task 1: Add the 'Provably Fair: Verify Outside the App' section to README.md** — `7d5a086` (docs)
2. **Task 2: Recruiter dry-run** — no separate commit (verification step; self-approved per the prompt's `<dry_run_instruction>` clause after running the worked example twice from a fresh shell and matching the documented expected output byte-for-byte).

Planning rotation will land as a separate `docs(08-09): summary + STATE/ROADMAP/REQUIREMENTS rotation` commit per project convention (Plans 08-05 / 08-06 / 08-07 / 08-08 precedent).

---

## What changed

### `README.md`

A new h2 section (`## Provably Fair: Verify Outside the App`) inserted between the ADR catalogue and the Roadmap section. Six subsections:

1. **Opening paragraph** — frames the section as the third-party-tool re-derivation that proves nobody is reading a number off the server. Cross-links to the in-app `/verify/:roundId` route and the Fairness drawer (the same algorithm in the browser via `crypto.subtle`).
2. **Why this matters** — one paragraph on the SHA-256 chain commitment + the Bustabit reduction with 1-in-101 instant-crash bucket. The *trust me* vs *verify me* distinction.
3. **Verify any settled round** — generic shell block parameterised on `$ROUND_ID` and `$BASE`. Uses `curl -s | jq -r` to extract the five fields, then runs Steps A (reproduce `serverSeedHash` via `xxd -r -p | openssl dgst -sha256`) and B (reproduce `crashPoint` via `openssl dgst -sha256 -hmac` + the Bustabit Python compute). Echoes the reported values for side-by-side comparison.
4. **Worked example (no live stack required)** — hardcodes the Phase 4 oracle tuple (`serverSeed=0x0…01`, `clientSeed="test"`, `nonce=0`). Reproduces the same Steps A/B. Includes a fenced block titled **Expected output (reproduced verbatim on macOS with LibreSSL 3.x)** carrying the exact captured output from my dry-run.
5. **Why two encodings of the same hex string?** — the byte-encoding explainer. Documents Pitfall 1 (HMAC key = UTF-8 of hex string, `-hmac "$KEY"`) and Pitfall 2 (chain proof hex-decodes via `xxd -r -p` before SHA-256), names the file paths in `packages/contracts/src/provably-fair/` that own each contract, and calls out the `3.02` MISMATCH symptom when the encodings are reversed.
6. **Portability notes** — macOS `brew install jq` + LibreSSL prefix note; Debian/Ubuntu `apt-get install -y jq openssl xxd`; Fedora/RHEL `dnf install jq openssl vim-common`; busybox `python3 binascii.unhexlify` fallback; explicit warning against `-macopt hexkey:` which silently mismatches.

The section is purely additive — `git diff --stat` reports `116 ++++` / `0 -`. Every existing README block (Quickstart, env table, Demo user, Healthchecks, Project structure, ADR catalogue, Roadmap) is byte-unchanged.

### Captured dry-run output (recruiter checkpoint evidence)

```
--- Step A: seedHash commitment (hex-decoded server seed) ---
SHA2-256(stdin)= ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5
--- Step B: HMAC with the hex string as the UTF-8 key ---
HMAC      = a9aa7f591433757689bc898f5167109490f954c4d895901f65042c332b8c050b
first13   = a9aa7f5914337
intH      = 2984795937260343
crashPoint = 2.94
```

Last line is `2.94`, matching `LOCKED_ROUND.expectedCrashPoint` from `frontend/src/features/replay/__fixtures__/locked-round.fixture.ts` and the `tests/unit/provably-fair.test.ts` Phase 4 oracle in `packages/contracts`. Ran twice — once before drafting the section, once again copy-pasting the literal block from the merged README — both runs identical.

### Pitfall-1 demo (also captured during the dry-run, not shown in README — referenced abstractly)

Wrongly hex-decoding the HMAC key via `-macopt hexkey:$SERVER_SEED` produces:

```
WRONG HMAC = abe0eb5eb9192c3b2209b71f0758691ff82fd1f11070f36e341a608350fcbc93
WRONG crashPoint = 3.02
```

The README cites the `3.02` number in the explainer paragraph so a reader who tries the wrong path sees the predicted symptom and recognises the bug class.

### Busybox-fallback validation (also captured)

```
SHA2-256(stdin)= ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5
```

Byte-identical to the `xxd -r -p` path, confirming the `python3 binascii.unhexlify` fallback in the portability notes works.

---

## Verification

| Check | Command | Result |
|---|---|---|
| Acceptance gate: section heading | `grep -q 'Provably Fair: Verify Outside the App' README.md` | exit 0 |
| Acceptance gate: Pitfall 2 hex-decode | `grep -q 'xxd -r -p' README.md` | exit 0 |
| Acceptance gate: Pitfall 1 raw-key HMAC | `grep -q 'openssl dgst -sha256 -hmac' README.md` | exit 0 |
| Acceptance gate: Bustabit compute | `grep -q 'python3 -c' README.md` | exit 0 |
| Acceptance gate: locked-byte fixture | `grep -q '0000000000000000000000000000000000000000000000000000000000000001' README.md` | exit 0 |
| Acceptance gate: expected outcome | `grep -q '2.94' README.md` | exit 0 |
| Acceptance gate: byte-encoding explainer | `grep -q "Why two encodings" README.md` | exit 0 |
| Existing content preserved | `git diff --stat README.md` | `116 ++++` / `0 -` |
| Recruiter dry-run (fresh shell, copy-paste from merged README) | manual paste-and-run | `crashPoint = 2.94` (matches documented expected output) |

All 7 grep gates from Task 1's acceptance criteria pass.

---

## Decisions Made

- **Insertion point:** between `Architecture Decision Records` and `Roadmap` (h2 sibling). A new top-level h2 keeps the verification flow at the same scroll-level as the other high-leverage docs (env table, healthchecks, ADR catalogue) instead of hiding it under a more specific parent.
- **Anchor digest:** captured `ec4916dd…afa01d` from the dry-run rather than re-using the Plan 08-01 anchor `6e340b9c…afa01d`. The two are correct for different inputs — 08-01 hashes a single zero byte (`sha256OfHexEncodedSeed("00")`), the README hashes the 32-byte hex-decode of the full `0x0…01` seed. Documenting the value I actually produced is more defensible than asserting a value from a sibling fixture.
- **Pitfall demonstration:** ran the wrong-encoding HMAC empirically (`3.02`) so the README's explainer paragraph cites a concrete failure mode instead of a hand-wavy "this might break". Recruiters who try the wrong path see the predicted symptom.
- **Output-prefix normalisation:** chose `awk '{print $NF}'` over `tr` / `cut` / `sed` because `$NF` is the last whitespace-separated field regardless of whether openssl prints `SHA2-256(stdin)= <hex>` (LibreSSL) or `SHA256(stdin)= <hex>` (OpenSSL 3) or `(stdin)= <hex>` (legacy openssl 1). One-token portability against three prefix forms.
- **No new commands, no new files:** the walkthrough uses tools that ship with every macOS/Linux base image (`openssl`, `python3`, `xxd`, `awk`, `jq`). No `bun install`, no project script, no docker dependency.

---

## Deviations from Plan

None — plan executed exactly as written.

The plan's acceptance criteria all pass and the recruiter dry-run produced the expected `crashPoint = 2.94`. No Rule 1/2/3 fixes were needed; the byte semantics in `derive-crash-point.ts` + `generate-seed-chain.ts` were already correct, and the README's portability requirements (macOS LibreSSL, busybox fallback) were resolvable by adding the `awk '{print $NF}'` filter + the `python3 binascii.unhexlify` fallback inside Task 1 as planned.

---

## Issues Encountered

None.

---

## Threat Flags

None — the README addition introduces no network surface, no auth path, no schema change, no file access. The locked-byte fixture is the documented public test seed (`0000…0001`), never a production round.

---

## Self-Check: PASSED

- `README.md` contains the new `Provably Fair: Verify Outside the App` section — verified via grep (all 7 acceptance gates exit 0).
- `git log --oneline | grep 7d5a086` returns the Task 1 commit — verified.
- `git diff --stat` for the Task 1 commit shows `116 ++++` / `0 -` — purely additive, no existing content removed.
- Recruiter dry-run executed twice from a fresh shell against the literal copy-paste block, both runs landed `crashPoint = 2.94` matching the documented expected output byte-for-byte.
- `.planning/STATE.md` Current Position rotated from `P08-08` to `P08-09 complete (9/10)`, Next action advanced to "08-10 closeout only", Last-updated footer rotated.
- `.planning/ROADMAP.md` 08-09 row checked off; Progress table Phase 8 row advanced from `0/0 Not started` to `9/10 In progress`.
- `.planning/REQUIREMENTS.md` REQ-FE-10 traceability evidence extended with the P08-09 walkthrough artifact (the requirement was already `[x] Done` from P08-06; this plan is supplemental documentation per the plan's frontmatter `requirements: [REQ-FE-10]`).

---

## Next Phase Readiness

- **08-10 (Phase 8 closeout)** is the only Plan 8 item remaining: ADR-028..031 (Bustabit-canon byte-encoding double-rail, FairnessBadge state-machine, ReplayDriver speed↔time decoupling, /verify recompute-vs-trust posture), STATE/ROADMAP/REQUIREMENTS rotation, plus the deferred 08-06 drawer `<a>` → typed `<Link>` migration and the T-08-23 dual-rAF smoke check from 08-07.
- Phase 7 `verify-phase` / `ui-review` remain pending from before Phase 8 started (carried forward).
- **Phase 8 ROADMAP success criterion 5** ("README documents the provably-fair algorithm with a curl + third-party SHA-256 example so a recruiter can verify a round outside the app") is closed with this plan and ready to be cited in the 08-10 closeout's success-criterion attestation.

---

*Phase: 08-provably-fair-history-replay*
*Completed: 2026-05-30*
