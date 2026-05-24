# CLAUDE.md — Crash Game Project Guide

Read this first. It tells you how to work on this codebase and which artifacts to consult.

---

## Project

**Crash Game** — Multiplayer real-time casino game submitted as the Jungle Gaming fullstack technical challenge. Two NestJS services (`games`, `wallets`) on Bun, RabbitMQ saga, Keycloak OIDC, PostgreSQL with MikroORM 7, TanStack Start frontend with Socket.IO 4.8 over WebSocket. Provably fair via Bustabit-style HMAC-SHA-256 hash chain. Money is bigint cents wrapped in a `Money` value object (Dinero v2). Outbox / Inbox hand-rolled. Light CQRS (no event sourcing). Server-authoritative multiplier, client interpolation.

**Core value**: Demonstrate senior-level engineering — correctness, fairness, real-time discipline, deep reasoning — over a generic AI-assisted submission. Every decision must be defensible during the recruiter's live arguição.

---

## Authoritative artifacts (read before any work)

| Concern | File |
|---------|------|
| Project context, constraints, requirements | `.planning/PROJECT.md` |
| Full v1 requirements with REQ-IDs and config defaults | `.planning/REQUIREMENTS.md` |
| Phase structure with traceability | `.planning/ROADMAP.md` |
| Project memory (current phase, blockers, todos) | `.planning/STATE.md` |
| Workflow config (mode, granularity, parallelization) | `.planning/config.json` |
| Locked stack + versions + rationale | `.planning/research/STACK.md` |
| Bounded contexts, sagas, outbox, WS design | `.planning/research/ARCHITECTURE.md` |
| Feature universe + UX patterns | `.planning/research/FEATURES.md` |
| Critical mistakes to prevent | `.planning/research/PITFALLS.md` |
| Reconciled high-level summary | `.planning/research/SUMMARY.md` |
| Architecture Decision Records | `.planning/adrs/ADR-*.md` (created during phases) |

---

## GSD workflow (mandatory)

This project uses the **Get-Shit-Done** workflow with `interactive` mode + `standard` granularity + `parallelization=true`. The roadmap is 10 horizontal-layer phases.

Per phase, run the workflow:

1. `/gsd:discuss-phase N` — gather context, clarify approach
2. `/gsd:plan-phase N` — produce `PLAN.md` with task breakdown + dependency graph + goal-backward verification
3. `/gsd:execute-phase N` — execute plans with atomic commits (or `/gsd:execute-plan` per individual plan)
4. `/gsd:verify-phase N` — goal-backward verification (does the code actually deliver the phase goal?)
5. `/gsd:code-review` — review every changed source file
6. `/gsd:secure-phase N` if security-relevant (Phase 3, 5, 6)
7. `/gsd:ui-review` if UI-relevant (Phase 7, 8, 9)

**Current focus**: Phase 1 (Foundation & Infra). Next action: `/gsd:plan-phase 1`.

---

## Coding standards (NON-NEGOTIABLE)

### Money
- **NEVER** use `number` for any monetary amount — backend, frontend, wire format. Use the `Money` VO from `packages/shared-kernel` (wraps Dinero v2 with bigint cents).
- Postgres columns for money are `BIGINT` (cents) or `NUMERIC(20,2)`. Never `FLOAT` or `REAL`.
- ESLint custom rule (added in Phase 1) bans `number` on symbols matching `/amount|balance|bet|payout|price|wager/i`. Do not disable it.

### Domain layer
- **Zero infrastructure imports in `domain/`.** No `@nestjs/*` decorators, no `mikro-orm/*` decorators, no `socket.io`, no `axios`, no `pg`. The domain knows only itself + value objects + domain events.
- **Rich aggregates** with behavior methods (`round.acceptBet(bet)`, `bet.cashOut(multiplier)`, `wallet.debit(amount)`) — never anemic ORM rows passed around by services.
- **Value objects throw on invalid construction.** No `Money.zero` for "invalid amount" — throw a domain error.
- **One aggregate per transaction.** Cross-aggregate consistency uses sagas with outbox/inbox, never multi-aggregate TX.

### Configuration
- **No hardcoded business constants** (initial balance, betting window, growth rate, etc.). All come from env via `config/defaults.ts` (typed re-export of `.env.example`).
- See `.planning/REQUIREMENTS.md` § "Open Configuration Values" for the full env list.

### Tests
- Bun test runner for unit + e2e. `fast-check` for property tests on Money / FSM. Playwright for E2E browser flows.
- Property tests on monetary invariants and Round FSM are MANDATORY in Phase 3 and Phase 4 respectively.

### Saga / messaging
- Every domain event: `{ messageId, correlationId, causationId, type, version, occurredAt, payload }`.
- Outbox row written in same TX as domain mutation. Polling publisher with `confirmSelect` + `waitForConfirms`.
- Inbox dedupe row written in same TX as side-effect.
- Quorum queues with `x-delivery-limit` on both main and DLQ.

### WebSocket
- JWT validated at handshake (cached JWKS). No mid-connection re-auth.
- Server-authoritative timestamps for cashout — `cashoutAcceptedAt` computed at the inbound handler, before any await. Never trust client time.
- Ticks emitted as `volatile.emit` so a slow consumer never blocks broadcast.

### Frontend
- Multiplier curve on Canvas 2D with `requestAnimationFrame` + `devicePixelRatio` + `clearRect`. No SVG, no WebGL.
- Client computes multiplier locally from `e^(GROWTH_RATE * t / 1000)` anchored to `roundStartedAt`. EWMA tween toward server tick — never snap.
- Multi-tab token refresh via `BroadcastChannel`.

---

## Commit hygiene

- Atomic commits per logical change. Follow the repo's existing prefix style (`docs:`, `feat:`, `fix:`, `chore:`, `refactor:`, `test:`).
- **Never add `Co-Authored-By: Claude`, "Generated by", or any AI attribution.** (Git history is scored at 10%; AI fingerprints are an instant red flag.)
- Commit messages in PT-BR or EN are both fine — match the project's style (currently EN).
- No emojis in code; comments only when logic is genuinely complex. Names should be self-explanatory.

---

## ADRs

Every significant decision gets an ADR in `.planning/adrs/ADR-NNN-<slug>.md` during the phase that resolves it. Format:

```markdown
# ADR-NNN: <Title>
**Status**: Accepted | Superseded by ADR-XXX
**Date**: YYYY-MM-DD
**Phase**: N
## Context
<What problem, what constraints>
## Considered
- Option A — pros / cons
- Option B — pros / cons
## Decision
<Chosen option and why>
## Consequences
<What this locks in, what it forecloses>
```

Roadmapper anticipates 30+ ADRs across the 10 phases. See `.planning/ROADMAP.md` per-phase "Key decisions to make" lists.

---

## Quick reference

| Want to... | Do this |
|------------|---------|
| Bring up the whole stack | `bun run docker:up` |
| Tear it down cleanly | `bun run docker:down` |
| Wipe volumes + images | `bun run docker:prune` |
| Run unit tests for a service | `cd services/<svc> && bun test tests/unit` |
| Run e2e for a service | `cd services/<svc> && bun test tests/e2e` (requires `docker:up`) |
| Check current GSD state | Read `.planning/STATE.md` |
| Plan next phase | `/gsd:plan-phase <N>` |

---

*Last updated: 2026-05-24 after project initialization.*
