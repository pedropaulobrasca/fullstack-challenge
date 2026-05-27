---
phase: 04-game-core
plan: 12
subsystem: documentation
tags: [adrs, closeout, requirements-traceability, phase-4-complete]
provides:
  - Five Phase 4 ADRs (014-018) under .planning/adrs/
  - ADR catalogue Phase 4 section in .planning/adrs/README.md
  - STATE.md advanced to Phase 4 complete (4/10 phases done)
  - ROADMAP.md Phase 4 row marked Complete (12/12 plans, 2026-05-26)
  - REQUIREMENTS.md 19 Phase 4 REQ-IDs marked Done with plan citations
  - v1-complete count incremented from 12 to 31 (out of 95)
requires:
  - Plan 04-01 through Plan 04-11 (all Phase 4 implementation plans landed)
  - Plan 04-11 live smoke evidence (32/32 PASS + true-SIGKILL drill PASSED + CLI verifier MATCH)
affects:
  - .planning/STATE.md (Current Position, Performance Metrics, Phase history, Recent activity, footer)
  - .planning/ROADMAP.md (Phases summary checkbox, Progress table row, footer)
  - .planning/REQUIREMENTS.md (5 Phase 4 reqs flipped to [x], traceability table entries, coverage summary, footer)
  - .planning/adrs/README.md (Phase 4 section appended, Future ADRs rewound to 019+)
key-files:
  created:
    - .planning/adrs/ADR-014-bet-as-own-aggregate.md
    - .planning/adrs/ADR-015-crash-point-formula-and-client-seed-derivation.md
    - .planning/adrs/ADR-016-hash-chain-pre-generation-depth.md
    - .planning/adrs/ADR-017-round-loop-recursive-settimeout-and-on-application-bootstrap.md
    - .planning/adrs/ADR-018-money-multiply-rounded-bankers-extension.md
    - .planning/phases/04-game-core/04-12-SUMMARY.md
  modified:
    - .planning/adrs/README.md
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
decisions:
  - "ADR-014: Bet is its own aggregate, references Round via RoundId; Round.bets[] absent by construction; per-bet micro-TX sweep over Round-lock contention"
  - "ADR-015: HMAC(serverSeed, ${clientSeed}:${nonce}) with per-round derivable client seed SHA256(prevRound.id + ':' + prevRound.crashedAt.toISOString()); genesis = SHA256(GENESIS_CLIENT_SEED); deliberate variant from Bustabit fixed-public-salt canon"
  - "ADR-016: 1M hash chain pre-generated at first boot via SeedChainBootstrap.OnApplicationBootstrap; idempotent on restart; immutable one-time commitment over lazy-refill's head-pointer-mutation attack"
  - "ADR-017: Recursive setTimeout + OnApplicationBootstrap over setInterval / worker thread; race-free crashAt scheduling; five-branch recoverInFlightRound; live SIGKILL drill PASSED at P4.11"
  - "ADR-018: Money.multiplyRounded(factor, mode='bankers') shared-kernel extension composing Dinero multiply + transformScale(currencyExponent, halfEven); aggregate is canonical consumer of REQ-DOM-07"
metrics:
  duration: "~2h authoring + closeout"
  completed: 2026-05-26
adr_018_conditional_outcome: authored (Plan 04-03 path b — Money.multiplyRounded extension shipped in Phase 4; REQ-DOM-07 satisfied without deferral)
---

# Phase 4 Plan 12: Phase 4 Closeout — Five ADRs + STATE/ROADMAP/REQUIREMENTS

Close Phase 4: authored five ADRs (014, 015, 016, 017, 018) defending every significant Game Core decision; extended the ADR catalogue README with the Phase 4 section linking all five; advanced STATE.md to Phase 4 complete (4/10 phases done overall); flipped ROADMAP.md Phase 4 row to Complete with 12/12 plans landed; marked the 19 Phase 4 REQ-IDs Done in REQUIREMENTS.md traceability with plan citations; incremented v1-complete count from 12 to 31. Phase 4 is provably complete from both the implementation side (Plan 04-11 32/32 smoke + true-SIGKILL drill + CLI verifier MATCH) and the documentation side (this plan).

## One-liner

Five Phase 4 ADRs landed defending Bet-as-own-aggregate locking discipline, Bustabit-canon crash-point formula with per-round derivable client seed, 1M hash chain pre-generation immutability, recursive setTimeout + OnApplicationBootstrap round loop with kill-9 recovery, and Money.multiplyRounded shared-kernel extension for REQ-DOM-07 banker's rounding cashout.

## ADRs Authored

| ADR | Title | Key decision | Alternatives rejected |
| --- | --- | --- | --- |
| [ADR-014](../../adrs/ADR-014-bet-as-own-aggregate.md) | Bet is its own aggregate — not nested inside Round | Bet sibling-of-Round referencing RoundId; per-bet micro-TX sweep | Nested Round.bets[] (Round-lock contention); anemic Bet row (violates REQ-DOM-08) |
| [ADR-015](../../adrs/ADR-015-crash-point-formula-and-client-seed-derivation.md) | Bustabit-canon crash-point formula + per-round client-seed derivation | HMAC(serverSeed, `${clientSeed}:${nonce}`) with clientSeed = SHA256(prevRound.id + ':' + prevRound.crashedAt.toISOString()) | Fixed env-baked public salt (precomputable); Bitcoin block hash dependency (no external feed in docker:up) |
| [ADR-016](../../adrs/ADR-016-hash-chain-pre-generation-depth.md) | Hash chain pre-generation at bootstrap (1M rounds) over lazy | SeedChainBootstrap @ OnApplicationBootstrap generates 1M entries idempotently | Lazy refill (head-pointer-mutation attack); on-demand single seed (not provably-fair) |
| [ADR-017](../../adrs/ADR-017-round-loop-recursive-settimeout-and-on-application-bootstrap.md) | Round loop — recursive setTimeout + OnApplicationBootstrap | Recursive setTimeout with `crashAt - Date.now()` scheduling; OnApplicationBootstrap hook (not OnModuleInit) | setInterval (drift + queue-under-load); worker thread (breaks same-TX outbox) |
| [ADR-018](../../adrs/ADR-018-money-multiply-rounded-bankers-extension.md) | Money.multiplyRounded shared-kernel extension for banker's rounding | New `multiplyRounded(factor, mode = 'bankers')` composes Dinero multiply + transformScale(currencyExponent, halfEven) | Round-at-consumer-boundary (scatters rounding logic); replace Money.multiply (backward-incompatible) |

## ADR-018 Conditional Outcome

**Authored.** Plan 04-03's W3 plan-check resolved the conditional inline: Dinero v2's `multiply` is precision-preserving (does not round to currency exponent), so REQ-DOM-07's banker's rounding requirement led to extending `packages/shared-kernel/src/money/money.ts` with `multiplyRounded(factor, mode)` rather than deferring. The decision is captured in ADR-018; the implementation already shipped in P4.03 (commit history); the 10k×2 fast-check property in `services/games/tests/property/money-rounding.property.test.ts` pins the loss-free invariant.

## STATE / ROADMAP / REQUIREMENTS Diff Highlights

### STATE.md
- Current Position: Phase 4 row reflects 12/12 plans landed, 4/10 phases complete
- Performance Metrics: phases complete 4/10; v1 complete 31/95 (+19); ADRs landed 18 (+5)
- Phase history: Phase 4 row now `12 / 12 plans landed (P4.12 ADRs + closeout)` Status Complete
- Recent activity: prepended a 2026-05-26 P4.12 entry summarizing all five ADRs + closeout
- Footer: timestamped to 2026-05-26 P4.12 closeout

### ROADMAP.md
- Phases summary: `Phase 1: Foundation & Infra` flipped to `[x]` (catch-up — Progress table already had it Complete); Phase 4 stays `[x]`
- Progress table: Phase 4 row `12/12 | Complete | 2026-05-26`
- Footer: timestamped to 2026-05-26 P4.12 closeout

### REQUIREMENTS.md
- Phase 4 reqs flipped to `[x]`: REQ-DOM-04, REQ-DOM-07, REQ-DOM-08, REQ-GAME-08, REQ-FAIR-03, REQ-TEST-02 (the six Phase 4 reqs still showing `[ ]` at plan start; the other 13 were already flipped by prior plans)
- Traceability table: 6 rows changed from `Pending` to `Done (P4.XX — citation)` for the still-pending Phase 4 entries
- Coverage summary: v1 complete bumped from 12/95 to 31/95 with full Phase 4 REQ-ID enumeration
- Footer: timestamped to 2026-05-26 P4.12 closeout

### v1-complete delta

`12/95 → 31/95` (+19): the 19 Phase 4 REQ-IDs listed in the plan frontmatter, all marked Done with plan citations in the traceability table.

## ADR Catalogue README Update

`.planning/adrs/README.md`:
- Appended `## Phase 4 — Game Core` section with a 5-row table listing ADR-014 through ADR-018 (title, phase, status, summary) matching the Phase 3 section's formatting
- Updated the `## Future ADRs` section: removed Phase 4's entry from the anticipated list (was: "Phase 4: round FSM transition policy; provably-fair hash chain length; multiply rounding mode for cashout payouts; bet-is-its-own-aggregate vs nested-in-Round; recursive setTimeout round loop vs setInterval / worker thread") and rewound the lead-in from "Subsequent phases append ADR-014+" to "Subsequent phases append ADR-019+"

## Deviations from Plan

None. Plan executed as written. ADR-018 was already pre-determined as conditional-resolved during Plan 04-03's W3 fix; this plan documents that resolution rather than re-deciding it.

## Phase 4 Provably Complete

- **12/12 plans landed** (P4.01 through P4.12)
- **5 ADRs** (014-018) authored with full Context / Considered / Decision / Consequences / Alternatives Rejected sections
- **32/32 smoke probes** PASS against live docker stack at P4.11
- **8 integration tests** (22 sub-tests) across the Phase 4 surface
- **118+4 unit/property tests** green (48,023 expect()) at the games service
- **24/24 contracts tests** green (34,096 expect())
- **CLI verifier byte-matches** settled rounds (`MATCH 5.56` on round 9204af58)
- **True-SIGKILL drill PASSED** (round 2b9d685e killed mid-RUN → restart → settled, zero orphans)
- **19/19 Phase 4 REQ-IDs** marked Done in REQUIREMENTS.md traceability
- **All five Phase 4 ROADMAP success criteria** observably true end-to-end

## Self-Check: PASSED

- FOUND: .planning/adrs/ADR-014-bet-as-own-aggregate.md (commit 94e9256)
- FOUND: .planning/adrs/ADR-015-crash-point-formula-and-client-seed-derivation.md (commit 4a12a66)
- FOUND: .planning/adrs/ADR-016-hash-chain-pre-generation-depth.md (commit 10fd614)
- FOUND: .planning/adrs/ADR-017-round-loop-recursive-settimeout-and-on-application-bootstrap.md (commit 583af42)
- FOUND: .planning/adrs/ADR-018-money-multiply-rounded-bankers-extension.md (commit 9b50fe3)
- FOUND: `grep "31 / 95" .planning/STATE.md .planning/REQUIREMENTS.md` returns both files
- FOUND: `grep "12/12" .planning/ROADMAP.md` returns Phase 4 Complete row
- FOUND: `grep "4 / 10" .planning/STATE.md` returns Performance Metrics row
- FOUND: ADR-014..018 entries in `.planning/adrs/README.md` Phase 4 section
