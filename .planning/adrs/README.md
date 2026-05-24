# Architecture Decision Records — Crash Game

Every significant architectural decision is captured as an ADR following the template in `CLAUDE.md`. ADRs are append-only — supersession is recorded in the new ADR's Status field, never by editing or deleting an existing record. Phase 10 audits the full catalogue against REQ-DOC-02.

Each ADR records the constraints that drove the decision, the alternatives that were considered, the chosen option with rationale linked to source-of-truth research files (STACK.md, SUMMARY.md, PITFALLS.md, phase-N RESEARCH.md), the consequences that the decision locks in, and the alternatives explicitly rejected with one-line "why not" reasons.

## Phase 1 — Foundation & Infra

| ADR | Title | Phase | Status | Summary |
|-----|-------|-------|--------|---------|
| [ADR-001](./ADR-001-orm-mikroorm.md) | ORM selection — MikroORM 7 | 1 | Accepted | MikroORM 7 chosen over Prisma, TypeORM, and Drizzle for DDD-native Identity Map + Unit of Work + Data Mapper. |
| [ADR-002](./ADR-002-money-dinero-vo.md) | Money representation — Dinero.js v2 wrapped in local VO | 1 | Accepted | Dinero.js v2 (stable, March 2026) wrapped in a project-local `Money` VO; snapshot shape `{ amount: string, currency, scale }` locked for JSON safety. |
| [ADR-003](./ADR-003-bun-pinning.md) | Bun + NestJS pinning strategy | 1 | Accepted | Exact pin `Bun 1.3.11` across `.bun-version`, `packageManager`, and every `oven/bun:1.3.11-alpine` Dockerfile; explicit decorator flags in every tsconfig. |
| [ADR-004](./ADR-004-config-source-of-truth.md) | Configuration source-of-truth shape | 1 | Accepted | Per-service `.env.example` + typed `config/defaults.ts` parsed by zod; ESLint `no-restricted-properties` bans `process.env` outside the config module. |
| [ADR-005](./ADR-005-wallet-seed-strategy.md) | Wallet seed strategy — first-login provisioning | 1 | Accepted | Option C (first-login `POST /wallets` via REQ-WALL-01 idempotency) over one-shot SQL seed (Option A) or boot seeder (Option B); recruiter sees the wallet after one login click. |
| [ADR-006](./ADR-006-eslint-plugin-location.md) | ESLint money-guard plugin location and authoring approach | 1 | Accepted | Workspace package `packages/eslint-plugin` consumed from root flat config; rules authored with `@typescript-eslint/utils` `ESLintUtils.RuleCreator` and fixture-driven tests. |

## Conventions

- **Filename**: `ADR-NNN-<kebab-slug>.md` where NNN is a zero-padded three-digit sequence number. ADRs are numbered globally across the project (not per phase).
- **Status values**: `Accepted` (current), `Superseded by ADR-XXX` (the new ADR replaces this one and records the supersession in its own Context), `Deprecated` (no replacement, decision no longer applies).
- **Date**: ISO-8601 date of the decision (the planning or execution session when the choice was made), not the implementation date.
- **Phase**: the phase number that owns the decision; cross-phase decisions are recorded in the phase that resolves them.
- **Sections**: Context (problem and constraints), Considered (options with brief pros/cons), Decision (chosen option with rationale and citations), Consequences (what is locked in, what is foreclosed), Alternatives Rejected (one line per rejected option).

## Future ADRs

Subsequent phases append ADR-007+ as decisions land. The anticipated catalogue is enumerated in `.planning/ROADMAP.md` under each phase's "Key decisions to make" list. Examples:

- Phase 2: outbox/inbox table schema and polling-vs-LISTEN/NOTIFY trade-off.
- Phase 3: wallet aggregate persistence shape; transaction-row representation for credits and debits.
- Phase 4: round FSM transition policy; provably-fair hash chain length; `multiply` rounding mode for cashout payouts (ADR-011).
- Phase 5: saga state-machine persistence; compensation policy for insufficient-funds and timeout cases.
- Phase 6: WebSocket room granularity; tick-rate and reconciliation policy.
- Phase 7: frontend routing and auth-loader pattern; canvas renderer life-cycle.
- Phase 8: replay UI scope and storage shape.
- Phase 9: leaderboard projection store and window granularity.
- Phase 10: CI gating strategy and observability dashboard ownership.
