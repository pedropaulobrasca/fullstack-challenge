---
phase: 01-foundation-infra
plan: 08
subsystem: documentation
tags: [adr, documentation, decisions, phase-1]
requires:
  - "RESEARCH 01-RESEARCH.md (Output §1 ADR list, lines 794-805)"
  - "STACK.md §2.1 ORM rationale, §2.2 Money rationale"
  - "SUMMARY.md §8 conflicts resolved"
  - "REQUIREMENTS.md REQ-DOC-03 + REQ-WALL-01 + REQ-DOM-06 + REQ-INFRA-05"
provides:
  - "ADR-001 ORM lock — MikroORM 7 over Prisma/TypeORM/Drizzle"
  - "ADR-002 Money representation — Dinero v2 wrapped in Money VO with locked snapshot shape"
  - "ADR-003 Bun pinning — exact 1.3.11 across .bun-version, packageManager, all Dockerfiles"
  - "ADR-004 Config source-of-truth — per-service zod-parsed defaults.ts + ESLint process.env ban"
  - "ADR-005 Wallet seed strategy — first-login provisioning via REQ-WALL-01 idempotency"
  - "ADR-006 ESLint money-guard plugin location — packages/eslint-plugin with @typescript-eslint/utils RuleCreator"
  - "ADR catalogue index at .planning/adrs/README.md with conventions and future ADR anticipation list"
affects:
  - "Phase 10 REQ-DOC-02 catalogue audit — six entries land now so the audit is light"
  - "Every later phase references the ADR file relevant to its decisions during the live arguição"
tech-stack:
  added: []
  patterns:
    - "Nygard ADR format extended with 'Alternatives Rejected' sub-section that names each rejected option with a one-line reason"
    - "ADR Decision section cites at least one source-of-truth file (STACK.md, SUMMARY.md, RESEARCH.md, REQUIREMENTS.md) for traceability"
    - "ADR README index uses markdown table with relative-path links to each record"
key-files:
  created:
    - ".planning/adrs/ADR-001-orm-mikroorm.md"
    - ".planning/adrs/ADR-002-money-dinero-vo.md"
    - ".planning/adrs/ADR-003-bun-pinning.md"
    - ".planning/adrs/ADR-004-config-source-of-truth.md"
    - ".planning/adrs/ADR-005-wallet-seed-strategy.md"
    - ".planning/adrs/ADR-006-eslint-plugin-location.md"
    - ".planning/adrs/README.md"
  modified: []
decisions:
  - "ADRs use ISO-8601 date of the planning session (2026-05-24) as the Date field, not the implementation date — captures when the decision was made"
  - "ADR-NNN-<slug>.md numbering is global across the project (not per phase) so cross-phase references stay stable"
  - "Every ADR's Decision section cites at least one source-of-truth file to give the recruiter an evidence trail during arguição"
  - "ADR-005 explicitly interprets REQ-DOC-03's 'pre-configured' phrasing as 'wallet auto-provisions on first authenticated POST /wallets via REQ-WALL-01 idempotency' — keeping wallet schema out of Phase 1"
  - "ADR-006 documents the regex-name-only limitation of the ESLint money-guard as an accepted trade-off rather than chasing full type-flow analysis"
metrics:
  duration_minutes: 12
  completed_at: 2026-05-24
---

# Phase 1 Plan 8: ADR Catalogue Summary

Wrote the full Phase 1 ADR catalogue — six Architecture Decision Records plus an index — into `.planning/adrs/`. The roadmap anticipated four ADRs (001-004); RESEARCH §8 surfaced two more (005 wallet seed strategy, 006 ESLint plugin location) and this plan ships all six together so the catalogue is complete before Phase 1 verification. Phase 10 will audit against REQ-DOC-02; that audit is now light for Phase 1's share.

## One-line summary per ADR

- **ADR-001 — ORM selection — MikroORM 7**: locked over Prisma, TypeORM, and Drizzle for DDD-native Identity Map + Unit of Work + Data Mapper; cites STACK.md §2.1 and the 25% DDD scoring band as the deciding factors.
- **ADR-002 — Money representation — Dinero.js v2 wrapped in local VO**: locked over raw `bigint` cents and `decimal.js`; snapshot shape `{ amount: string, currency, scale }` locked for JSON safety; rounding-mode lock deferred to Phase 4 ADR-011.
- **ADR-003 — Bun + NestJS pinning strategy**: exact `1.3.11` pin across `.bun-version`, `packageManager`, and every `oven/bun:1.3.11-alpine` Dockerfile; explicit `emitDecoratorMetadata` + `experimentalDecorators` per service tsconfig (no inheritance); driven by the 1.3.10 NestJS controller regression ([#27526](https://github.com/oven-sh/bun/issues/27526)).
- **ADR-004 — Configuration source-of-truth shape**: per-service `.env.example` + typed `config/defaults.ts` parsed by zod at boot; ESLint `no-restricted-properties` bans `process.env` outside `**/src/config/**/*.ts` and `mikro-orm.config.ts`.
- **ADR-005 — Wallet seed strategy — first-login provisioning**: Option C over Option A (one-shot SQL seed) and Option B (boot seeder); leverages REQ-WALL-01 idempotent `POST /wallets`; recruiter sees the wallet after one login click; manual `curl` flow documented in README for API-only recruiters; reversible (Phase 3 can layer in Option B if UX feedback demands).
- **ADR-006 — ESLint money-guard plugin location**: workspace package `packages/eslint-plugin` consumed from root flat config; rules authored with `@typescript-eslint/utils` `ESLintUtils.RuleCreator`; fixture-driven tests with `@typescript-eslint/rule-tester`; regex-name-only limitation documented as accepted trade-off.

## Cross-references between ADRs

- **ADR-002 (Money VO) is enforced by ADR-006 (ESLint rule)** — the rule's whole purpose is to ban `number` on money-named identifiers so the VO from ADR-002 is the only sanctioned monetary path.
- **ADR-005 (wallet seed) depends on ADR-004 (config source-of-truth)** — the 1000.00 CRD initial balance flows from `INITIAL_BALANCE_CENTS` in the typed `defaults.ts`, not a hardcoded constant.
- **ADR-003 (Bun pinning) supports ADR-001 (MikroORM)** — the explicit `emitDecoratorMetadata: true` per-service tsconfig flag is what lets MikroORM 7's decorator-driven entity mapping survive a future Bun re-interpretation of decorator semantics.
- **ADR-004 (config) supports ADR-002 (Money)** — the `CURRENCY_CODE`, `CURRENCY_BASE`, `CURRENCY_EXPONENT` env keys feed the `CRD` currency descriptor that the Money VO depends on.
- **ADR-001 (MikroORM) enables ADR-002 (Money VO)** — Embeddables map the Money VO directly to `BIGINT` columns with lossless `bigint` round-trips, which is the precondition for REQ-DOM-03.
- **ADR-006 (ESLint plugin location) and ADR-004 (config ESLint ban) share the same plugin infrastructure** — the `no-restricted-properties` ban for `process.env` is a future addition to the same `@crash/eslint-plugin` package.

## Deviations from Plan

None — plan executed exactly as written. The Decision sections of every ADR cite at least one source-of-truth file (STACK.md, SUMMARY.md, RESEARCH 01-RESEARCH.md, REQUIREMENTS.md) per the plan's acceptance criteria. All seven required sections are present in every ADR (`# ADR-NNN`, `**Status**`, `**Date**`, `**Phase**`, `## Context`, `## Considered`, `## Decision`, `## Consequences`) plus the `## Alternatives Rejected` sub-section that the plan called the "differentiator move."

## Confirmation: no AI fingerprints in any ADR

`grep -lE "Co-Authored-By|Generated by Claude|Generated by AI" .planning/adrs/` returns nothing. ADR prose is human-style declarative, no first-person AI phrasing, no emojis, no boilerplate "as an AI language model" disclaimers. Commit messages follow the project's `docs(NN-NN): ...` convention used throughout the repository.

## Commits

- `3995365` — `docs(01-08): add ADR-001..004 for ORM, money, Bun pinning, and config`
- `2509f93` — `docs(01-08): add ADR-005, ADR-006, and ADR catalogue index`

## Self-Check: PASSED

- `.planning/adrs/ADR-001-orm-mikroorm.md` — FOUND
- `.planning/adrs/ADR-002-money-dinero-vo.md` — FOUND
- `.planning/adrs/ADR-003-bun-pinning.md` — FOUND
- `.planning/adrs/ADR-004-config-source-of-truth.md` — FOUND
- `.planning/adrs/ADR-005-wallet-seed-strategy.md` — FOUND
- `.planning/adrs/ADR-006-eslint-plugin-location.md` — FOUND
- `.planning/adrs/README.md` — FOUND
- Commit `3995365` — FOUND
- Commit `2509f93` — FOUND
