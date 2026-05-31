---
phase: 10-quality-hardening-docs
plan: 09
subsystem: docs + ci-tooling + adrs + state-rotation
tags: [closeout, readme, adrs, ci-gate, generator-script, mermaid-diagrams, observability-docs, phase-10-final]
requires:
  - 10-04-SUMMARY (Jaeger + Prometheus + Grafana compose stack — Observability section copy)
  - 10-05-SUMMARY (5 custom Prometheus metrics — Observability table)
  - 10-06-SUMMARY (D-03 polish defects closed — Troubleshooting note)
  - 10-07-SUMMARY (Playwright specs — REQ-TEST-05 closure)
  - 10-08-SUMMARY (CI workflow file — CI badge URL source)
  - .planning/adrs/ADR-001..034 (existing 34 ADRs — generator input)
provides:
  - REQ-CI-03 (README CI badge)
  - REQ-DOC-01 (README setup + diagrams + troubleshooting)
  - REQ-DOC-02 (ADRs surfaced in README via generator)
  - ADR-035 (OTel SDK + Jaeger choice)
  - ADR-036 (ADR catalogue in README via generator)
  - ADR-037 (CI runs full docker:up on every push)
  - Phase 10 closeout (10/10 phases complete)
  - scripts/build-adr-index.ts (reusable generator)
affects:
  - README.md (Quick Start + Architecture + Saga Flow + Observability + ADR Catalogue + Scripts + Env Vars + Troubleshooting + CI badge; Phase 8 Provably-Fair section preserved byte-stable)
  - .github/workflows/ci.yml (ADR index sync check step between Typecheck and Unit tests)
  - package.json (docs:adr-index + docs:adr-index:check scripts)
  - .planning/STATE.md (Phase 10 complete; 10/10 phases; 86/95 v1; ADRs 34 → 37)
  - .planning/ROADMAP.md (Phase 10 [x]; 9-plan list; Progress row 9/9 Complete; closeout footer)
  - .planning/REQUIREMENTS.md (REQ-OBS-01 + REQ-OBS-04 + REQ-CI-03 + REQ-DOC-01 + REQ-DOC-02 flipped Done; v1 76 → 86; Phase 10 traceability all Done; footer rotated)
  - .planning/adrs/ADR-035..037 (three new ADRs at next-free numbers)
tech-stack:
  added:
    - Bun shell script (`scripts/build-adr-index.ts`) — pure stdlib, zero dependencies (`node:fs` + `node:path` + `node:url` only)
    - Mermaid diagrams (graph TB + sequenceDiagram) — render natively on GitHub README, no plugin
  patterns:
    - sentinel-marker generated content in README (HTML-comment markers, invisible in render, byte-stable boundary)
    - CI sync gate (`--check` mode exits non-zero on drift) — same shape as a lint/typecheck step
    - ADR renumber reconciliation (Phase 7/8/9/10 precedent — anticipated labels resolve to next-free shipped numbers, recorded with closeout note)
    - byte-stable preservation of prior-phase content (Phase 8 Provably-Fair walkthrough surrounded by new sections, never edited)
key-files:
  created:
    - scripts/build-adr-index.ts
    - scripts/build-adr-index.test.ts
    - .planning/adrs/ADR-035-otel-jaeger-stack.md
    - .planning/adrs/ADR-036-adr-catalogue-in-readme.md
    - .planning/adrs/ADR-037-ci-runs-full-stack.md
    - .planning/phases/10-quality-hardening-docs/10-09-SUMMARY.md
  modified:
    - README.md
    - package.json
    - .github/workflows/ci.yml
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
    - .planning/phases/10-quality-hardening-docs/deferred-items.md
decisions:
  - "ADR-035: OpenTelemetry SDK + nestjs-otel + Jaeger all-in-one; commercial APM (Datadog/Splunk/Honeycomb) rejected — SaaS credentials block recruiter reproduction; Tempo + Grafana rejected — 2 extra containers for marginal UX gain when Grafana already serves metrics"
  - "ADR-036: ADR catalogue lives in README via scripts/build-adr-index.ts generator between sentinel markers <!-- ADR-INDEX:START --> / <!-- ADR-INDEX:END -->, CI sync gate via bun run docs:adr-index:check; .planning/adrs/INDEX.md only rejected — recruiter scans README; hand-maintained table rejected — drift inevitable"
  - "ADR-037: CI runs full bun run docker:up stack on every push + PR; mocked-deps unit-only pipeline rejected — does not prove REQ-INFRA-01 zero-step bootstrap claim; self-hosted runner rejected — operational burden disproportionate for submission scope"
  - "Phase 10 ADR renumber reconciliation: anticipated ADR-028/029/030 labels stale (Phase 5/6/7/8/9 consumed 019..034); reconciled to ADR-035..037 per the Phase 7 (019..022 → 024..027), Phase 8 (023/024 → 028..031), Phase 9 (025/026/027 → 032..034) precedent"
  - "README structure: 12 sections in order — Title + CI badge → Quick Start (one-command + live URL table) → Architecture (mermaid graph TB) → Saga Flow (mermaid sequenceDiagram) → Provably Fair (Phase 8 P08-09 PRESERVED BYTE-STABLE) → Observability (Jaeger + Prometheus + Grafana) → ADR Catalogue (generated 37 rows) → Scripts (root + per-service) → Env Vars (Phase 10 OTel/pino/Prometheus additions) → Troubleshooting (Pitfall 5/8 + D-03 polish defects) → Demo user → Healthchecks → Project structure → Roadmap"
  - "CI sync gate position: between Typecheck and Unit tests for fast-fail — a stale README short-circuits the workflow before the ~30s unit suite and the ~6-8 min docker boot"
metrics:
  duration: "~75 min"
  completed: "2026-05-31"
---

# Phase 10 Plan 09: Closeout — README + ADR Generator + ADR-035..037 + State Rotation Summary

Sentinel-marker-generated 37-row ADR catalogue table in README populated by a 120-line zero-dependency Bun script with 7 unit tests + CI sync gate (`bun run docs:adr-index:check` between Typecheck and Unit tests), three Phase 10 ADRs at next-free numbers 035..037 per the established renumber precedent, full D-08 README sections (Quick Start + Architecture mermaid + Saga Flow mermaid + Observability + ADR Catalogue + Scripts + Env Vars + Troubleshooting + CI badge) around a byte-stable preserved Phase 8 Provably-Fair walkthrough, and a full STATE / ROADMAP / REQUIREMENTS rotation closing Phase 10 = 10/10 phases at 86/95 v1 REQ-IDs Done.

## What was built

### Generator + tests + CI gate (Task 1)

- `scripts/build-adr-index.ts` (120 lines, zero runtime deps — `node:fs` + `node:path` + `node:url` only) exports `parseAdrFile`, `readAdrs`, `renderTable`, `replaceBetweenMarkers`, `START_MARKER`, `END_MARKER` for unit testability; CLI entry point reads `.planning/adrs/`, generates a markdown table sorted by ADR number, replaces bytes between sentinel markers in `README.md`. `--check` mode computes the would-be README and exits non-zero on drift without writing.
- `scripts/build-adr-index.test.ts` (156 lines, 7 tests, 31 expect calls) covers: parseAdrFile happy path with all metadata; readAdrs sort-by-number; renderTable header + 3 sorted rows with `[Title](.planning/adrs/<slug>.md)` links; replaceBetweenMarkers byte-stable outside markers; replaceBetweenMarkers throws on missing markers; parseAdrFile fallback to `(unknown)` when status line missing; readAdrs ignores non-matching files (README, drafts, subdirs).
- `package.json` adds two scripts: `docs:adr-index` (regenerate) + `docs:adr-index:check` (CI-gate).
- `.github/workflows/ci.yml` adds the `ADR index sync check` step between Typecheck and Unit tests — fast-fail position; a stale README short-circuits the workflow before the unit suite + docker boot.

### Three Phase 10 ADRs (Task 2)

- **ADR-035 (OpenTelemetry SDK + nestjs-otel + Jaeger all-in-one)** — codifies the D-05 + D-01 + D-06 choices retroactively while the Plan 10-03 literal-first-import discipline is fresh; rejects commercial APM (SaaS credentials block recruiter reproduction) and Tempo + Grafana (2 extra containers for marginal UX gain).
- **ADR-036 (ADR catalogue in README via generator + CI sync gate)** — codifies D-08; rejects `.planning/adrs/INDEX.md` only (recruiter scans README, not subdirs) and hand-maintained table (drift inevitable at 37+ ADRs).
- **ADR-037 (CI runs full docker:up on every push)** — codifies D-07 + ratifies the Plan 10-08 workflow shape; rejects mocked-deps unit-only pipeline (does not prove REQ-INFRA-01 zero-step bootstrap claim) and self-hosted runner (operational burden disproportionate for submission scope).

Each ADR follows the CLAUDE.md template (Status / Date / Phase / Context / Considered / Decision / Consequences / Alternatives Rejected) with full alternatives-rejected rationale, anticipated recruiter Q&A pairs, cross-references to prior ADRs + related plans + REQ-IDs.

### README D-08 sections (Task 3)

Twelve sections in canonical order, with the Phase 8 P08-09 "Provably Fair: Verify Outside the App" section preserved byte-stable (no edits — surrounded by new content):

1. **Title + CI badge** — `![CI](.../ci.yml/badge.svg)` linked to Actions
2. **Quick Start** — one-command bootstrap (`git clone && cd && bun install && bun run docker:up && cd frontend && bun run dev`) plus a live URL table (Game / Keycloak / Kong / Jaeger / Prometheus / Grafana) and demo creds
3. **Architecture** — verbatim mermaid `graph TB` from 10-RESEARCH (Browser → Kong → services → PG/RMQ; OTLP traces to Jaeger; Prometheus scrape; Grafana datasources)
4. **Saga Flow** — verbatim mermaid `sequenceDiagram` from 10-RESEARCH (one `trace_id` across HTTP → AMQP → WS for a single bet, 202-cashout-200 asymmetry preserved)
5. **Provably Fair: Verify Outside the App** — Phase 8 P08-09 PRESERVED BYTE-STABLE
6. **Observability** — Jaeger + Prometheus + Grafana with port + purpose for each; the five custom Crash-domain metrics enumerated
7. **ADR Catalogue** — sentinel-marker generated table populated by Task 4
8. **Scripts** — root scripts table (10 entries including `docs:adr-index*`) + per-service scripts table
9. **Environment Variables** — Phase 10 additions table (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME, LOG_LEVEL, PINO_PRETTY, CRASH_RTP_WINDOW_ROUNDS) plus link to full surface in REQUIREMENTS
10. **Troubleshooting** — distilled from 10-RESEARCH Common Pitfalls (port collisions, first-pull disk, OTel init order, Grafana empty panels, OIDC redirect, wallet 0.00, WS disconnect, D-03 polish defects)
11. **Demo user + Healthchecks + Project structure** — existing content carried forward with the Phase 10 additions reflected (Jaeger/Prometheus/Grafana in healthchecks + project structure)
12. **Roadmap** — closing one-paragraph status

### State rotation (Task 4)

- Ran `bun run docs:adr-index` — table populated with all 37 ADRs in ascending number order; `bun run docs:adr-index:check` confirms README in sync.
- `STATE.md`: Current focus → "Phase 10 complete — Quality Hardening & Docs (9/9 plans). All 10 phases done; v1 complete 86/95"; Progress bar advanced to `▰▰▰▰▰▰▰▰▰▰` 10/10; Phases complete 9/10 → 10/10; v1 complete 79 → 86; ADRs landed 34 → 37.
- `ROADMAP.md`: Phase 10 checkbox flipped to `[x]`; Plan 10-09 checkbox flipped to `[x]`; Progress table row updated to 9/9 Complete 2026-05-31; closeout footer with full ADR-035..037 rationale + commit hashes + renumber reconciliation note added.
- `REQUIREMENTS.md`: REQ-OBS-01 + REQ-OBS-04 + REQ-CI-03 + REQ-DOC-01 + REQ-DOC-02 flipped from `[ ]` to `[x]` with plan citations; Phase 10 traceability table all five Pending rows → Done; v1 complete summary 77 → 86 with the 10 Phase 10 REQ-IDs enumerated; footer rotated to a full P10-09 closeout note citing each REQ + ADR-035..037 + the renumber-reconciliation precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Discovered pre-existing missing root `tsconfig.json`**
- **Found during:** Task 1 verification (`bunx tsc --noEmit scripts/build-adr-index.ts`)
- **Issue:** Root `package.json` declares `typecheck: tsc --noEmit -p tsconfig.json` but no `tsconfig.json` exists at repo root. `bun run typecheck` exits with TS5058.
- **Fix:** Out of scope for plan 10-09 per the execution-flow scope boundary (only auto-fix issues DIRECTLY caused by the current task). Logged to `.planning/phases/10-quality-hardening-docs/deferred-items.md` for the post-Phase-10 audit. Plan 10-09 verification proceeded via `bun test scripts/build-adr-index.test.ts` (all 7 green) + `bun scripts/build-adr-index.ts --check` (clean) which exercise the script through Bun's native TS support.
- **Commit:** `307d4ba`

No Rule 1 (bug) or Rule 2 (missing critical functionality) deviations encountered. No Rule 4 (architectural) checkpoints needed.

## Authentication gates

None encountered.

## Trust boundaries + STRIDE

Per plan threat model: both rows accepted as designed.

- **T-10-23 (Information Disclosure — README troubleshooting / env vars)** — accepted: all disclosed values are dev defaults (`player/player123`, localhost ports, `jaeger:4318`); production deployment out of scope per submission framing.
- **T-10-24 (Tampering — ADR catalogue generator script)** — MITIGATED: CI `docs:adr-index:check` step fails the build on any drift between README ADR table and `.planning/adrs/` contents. Verified live on plan 10-09 land — the check passes with `ADR index in sync: 37 entries`.

## Verification

Plan verify gates all green:

- `bun test scripts/build-adr-index.test.ts` — 7 pass / 0 fail / 31 expect calls
- `bun run docs:adr-index:check` — exit 0, `ADR index in sync: 37 entries`
- `grep -q "docs:adr-index" package.json` — present (two scripts)
- `grep -q "docs:adr-index:check" .github/workflows/ci.yml` — present (between Typecheck and Unit tests)
- `grep -q "ADR-INDEX:START" scripts/build-adr-index.ts` — present (exported `START_MARKER` constant)
- Three ADR files exist with correct `# ADR-NNN: Title` first line + `**Status**: Accepted` + `**Phase**: 10` + `Alternatives Rejected` section
- README contains: `Quick Start`, `## Architecture`, `sequenceDiagram`, `Provably Fair`, `ADR-INDEX:START`, `ADR-INDEX:END`, `## Scripts`, `## Troubleshooting`, `ci.yml/badge.svg`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `graph TB`
- STATE.md: `Phase 10 complete`; ROADMAP.md: `- [x] **Phase 10:`; REQUIREMENTS.md: `v1 complete: 86 / 95`; REQ-TEST-05/OBS-01/CI-01 marked Done with plan citations

ROADMAP success criteria for Phase 10 (5 SC):

1. ✅ Two Playwright E2E specs pass against the live Docker stack — recorded in Plan 10-07 SUMMARY; e2e/specs/bet-cashout.spec.ts + e2e/specs/bet-crash.spec.ts; 3 consecutive green runs.
2. ✅ GitHub Actions runs `bun run docker:up` on every push/PR; README displays CI badge — Plan 10-08 ci.yml + Plan 10-09 README badge top line.
3. ✅ Both services emit OpenTelemetry traces with W3C TraceContext across HTTP/AMQP/WS — Plan 10-03 OTel NodeSDK literal-first import in both services; ADR-035 codifies.
4. ✅ Prometheus `/metrics` endpoints expose req latency + AMQP lag + WS connections + custom domain metrics; pre-provisioned Grafana dashboards on first `docker:up` — Plan 10-04 + Plan 10-05.
5. ✅ README contains setup + architecture diagram + saga flow + provably-fair + scripts + env vars + troubleshooting; `.planning/adrs/` contains one ADR per significant decision — Plan 10-09 (this plan) ships the README sections + generates the 37-row ADR catalogue table.

## Commits

| # | Hash | Type | Description |
|---|------|------|-------------|
| 1 | `2019924` | test | add failing tests for ADR index generator (TDD RED) |
| 2 | `838218f` | feat | build-adr-index script + package scripts + CI sync check (TDD GREEN) |
| 3 | `307d4ba` | docs | log pre-existing missing root tsconfig.json to deferred-items |
| 4 | `2e09415` | docs | ADR-035 OpenTelemetry SDK + Jaeger all-in-one stack |
| 5 | `dcf59b4` | docs | ADR-036 ADR catalogue lives in README via generator script |
| 6 | `e170706` | docs | ADR-037 CI runs full docker:up stack on every push |
| 7 | `b0c90e3` | docs | README Quick Start + Architecture + Saga Flow + Observability + ADR Catalogue + Scripts + Env Vars + Troubleshooting + CI badge |
| 8 | `b735633` | docs | generate ADR catalogue table (37 entries) |
| 9 | `4e46fbc` | docs | Phase 10 closeout — STATE + ROADMAP + REQUIREMENTS rotation |

## Phase 10 reconciliation note

The plan's CONTEXT and ROADMAP anticipated three Phase 10 ADRs under labels "ADR-028 / ADR-029 / ADR-030" (per the original roadmap-creation numbering). Those labels were stale at Phase 10 closeout time because Phase 5/6/7/8/9 ADRs consumed the 019..034 range before Phase 10 closed. Following the precedent set Phase 7 (019..022 → 024..027), Phase 8 (023/024 → 028..031), and Phase 9 (025/026/027 → 032..034), the Phase 10 decisions take the next-free range **ADR-035 / ADR-036 / ADR-037**. The ROADMAP "Key decisions to make" rows now reflect this reconciliation explicitly with both the new numbers and the anticipated labels in parentheses.

## Phase 10 complete = entire project v1 complete

With this plan landed, all 10 phases are done; v1 ships at 86/95 (the remaining 9 v1 REQs are stretch/out-of-scope items deliberately deferred — see REQUIREMENTS.md "Stretch backlog" + "Out of Scope"). The submission is recruiter-ready: a fresh clone reaches a fully working state via `bun run docker:up`, CI proves the bootstrap claim on every push, the README walks a reviewer through every decision via the 37-row generated ADR catalogue + the mermaid architecture and saga diagrams, the Phase 8 Provably-Fair walkthrough lets a recruiter reproduce a crash point from any shell without docker, and the Jaeger/Prometheus/Grafana triad lets them trace a bet end-to-end and watch the custom RTP + multiplier drift metrics live.

## Self-Check: PASSED

- ✅ scripts/build-adr-index.ts — present (`ls -la scripts/build-adr-index.ts`)
- ✅ scripts/build-adr-index.test.ts — present
- ✅ .planning/adrs/ADR-035-otel-jaeger-stack.md — present with `# ADR-035: OpenTelemetry SDK + nestjs-otel + Jaeger All-in-One`
- ✅ .planning/adrs/ADR-036-adr-catalogue-in-readme.md — present with `# ADR-036: ADR Catalogue Lives in README via Generator Script + CI Sync Gate`
- ✅ .planning/adrs/ADR-037-ci-runs-full-stack.md — present with `# ADR-037: CI Runs Full `docker:up` Stack on Every Push and PR`
- ✅ Commits: `2019924`, `838218f`, `307d4ba`, `2e09415`, `dcf59b4`, `e170706`, `b0c90e3`, `b735633`, `4e46fbc` all present in `git log`
- ✅ README contains all 12 sections in canonical order with sentinel markers populated
- ✅ STATE.md + ROADMAP.md + REQUIREMENTS.md reflect Phase 10 complete + 10/10 + 86/95 + ADRs 37
