# STATE — Crash Game (Jungle Gaming Challenge)

> Project memory. Updated at phase transitions, plan completions, and milestone boundaries.

---

## Project Reference

- **Project doc**: `.planning/PROJECT.md`
- **Roadmap**: `.planning/ROADMAP.md`
- **Requirements**: `.planning/REQUIREMENTS.md`
- **Research**: `.planning/research/` (SUMMARY · STACK · ARCHITECTURE · FEATURES · PITFALLS)
- **Config**: `.planning/config.json` (mode=interactive, granularity=standard, parallelization=true)

**Core value**: Demonstrate senior-level engineering through a Crash Game that is correct, fair, real-time, and deeply considered — not a generic AI-assisted submission. Every decision must be defensible during the recruiter's arguição.

**Current focus**: Foundation — Phase 1 (Foundation & Infra).

---

## Current Position

- **Milestone**: 1 (initial submission)
- **Phase**: 1 — Foundation & Infra
- **Plan**: P1.9 complete → P1.10 next (healthcheck smoke test)
- **Status**: Phase 1 executing — README landed, smoke test pending
- **Progress**: `▱▱▱▱▱▱▱▱▱▱` 0/10 phases complete

**Next action**: Execute P1.10 (healthcheck smoke test) to close out Phase 1.

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 10 |
| v1 requirements mapped | 95 / 95 (100%) |
| Stretch backlog items | 8 |
| ADRs anticipated | 30+ (Phase 1: 4, Phase 2: 3, Phase 3: 2, Phase 4: 4, Phase 5: 2, Phase 6: 3, Phase 7: 4, Phase 8: 2, Phase 9: 3, Phase 10: 3) |
| Critical pitfalls addressed pre-saga | 5 / 5 (C1-C5 covered in Phases 1-4) |
| Phases with UI hint | 3 (Phases 7, 8, 9) |

---

## Accumulated Context

### Decisions (locked at roadmap creation)

- **Mode**: standard — horizontal layers, not vertical slices. Foundation → outbox → wallet → game → saga → ws → frontend → ux polish → bonuses → quality. Justified by the cross-cutting nature of the messaging spine (one bug in Phase 2 cascades into every saga) and the need to prove DDD purity before integration.
- **Granularity**: standard (10 phases). Reflects research convergence; coarser would compress critical pitfalls together (e.g., bundling Wallet + Game core hides aggregate-boundary discipline), finer would fragment the saga integration unnaturally.
- **Parallelization windows**: Phase 3 ⫼ Phase 4; Phase 8 ⫼ Phase 9. All other transitions are sequential.
- **Stack locked** (from STACK.md, ARCHITECTURE.md): Bun 1.3.11+, NestJS 11.1.21, TypeScript 5.6 strict, MikroORM 7.1, PostgreSQL 18, RabbitMQ 4.2 quorum queues, Keycloak 26.5, Kong 3.9 DB-less, Socket.IO 4.8, Dinero.js v2 stable, TanStack Start 1.x, Tailwind v4, shadcn CLI v4, Zustand 5, TanStack Query 5, oidc-spa, `bun:test` + `fast-check` + Playwright 1.49.
- **Conflicts resolved** (from SUMMARY §8): `amqplib` for outbox publisher + `@golevelup/nestjs-rabbitmq` for consumer ergonomics; Dinero v2 wrapped in local Money VO; Bustabit-canon crash formula; single `lobby` room; 30Hz server tick + 60fps client rAF; light CQRS with no ES; bet-202 / cashout-200 asymmetry.

### Todos

- [ ] Run `/gsd:plan-phase 1` (Foundation & Infra)
- [ ] Resolve OD8 (bet min/max bounds) and OD14 (auto-cashout max) with user before Phase 4 / Phase 9 respectively — defaults from REQUIREMENTS.md are placeholders awaiting confirmation
- [ ] Verify Bustabit-canon crash-point formula against the Rust reference impl during Phase 4 (research flagged MEDIUM confidence on final variant)
- [ ] Decide multi-bet pursuit (REQ-STRETCH-01) before Phase 4 freezes REQ-DOM-02 invariant

### Blockers

(None.)

### Open Configuration Values (env-driven, awaiting Phase 1 to materialize)

See `.planning/REQUIREMENTS.md` Open Configuration Values table. All 14 constants default per SUMMARY §7; ADR-004 will lock the source-of-truth file shape in Phase 1.

---

## Session Continuity

### Phase history

| Phase | Plans | Status | Notes |
|-------|-------|--------|-------|
| 1. Foundation & Infra | 9 / 10 plans landed (P1.9 README executed) | In progress | P1.10 (smoke test) remaining |
| 2. Outbox/Inbox Messaging Spine | — | Not started | Depends on Phase 1 |
| 3. Wallet Service | — | Not started | Parallel with Phase 4 (post Phase 2) |
| 4. Game Core (domain only) | — | Not started | Parallel with Phase 3 (post Phase 2) |
| 5. Saga Integration | — | Not started | Depends on Phase 3 + Phase 4 |
| 6. WebSocket Gateway & Multiplier Sync | — | Not started | Depends on Phase 5 |
| 7. Frontend Vertical Slice | — | Not started | Depends on Phase 6 |
| 8. Provably-Fair UX, History & Replay | — | Not started | Depends on Phase 7 |
| 9. Auto Features & Leaderboard | — | Not started | Parallel with Phase 8 (post Phase 7) |
| 10. Quality Hardening & Docs | — | Not started | Depends on Phase 9 |

### Recent activity

- **2026-05-24** — P1.9 (repo README) executed: rewrote `README.md` with the Phase 1 surface — Quickstart, 19-row env table, demo-user curl flow, healthcheck probes, ADR + Roadmap links. Commit `bba12a0`.
- **2026-05-24** — Roadmap created (10 phases, 95/95 v1 REQ-IDs mapped, stretch backlog defined). STATE.md initialized. REQUIREMENTS.md traceability appended.
- **2026-05-24** — Research synthesis completed (SUMMARY, STACK, ARCHITECTURE, FEATURES, PITFALLS).
- **2026-05-24** — Project initialized (PROJECT.md, REQUIREMENTS.md, config.json).

---

*Last updated: 2026-05-24 by gsd-roadmapper.*
