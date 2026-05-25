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

**Current focus**: Phase 3 in progress (Wallet Service) — Wave 2 (03-02 / 03-03 / 03-04) complete; Wave 3 in progress (03-05 REST surface landed, 03-07 Kong gateway narrowing landed). Remaining: 03-06 AMQP debit/credit consumers, 03-08 property tests + use-case unit tests, 03-09 smoke probes, 03-10 ADRs.

---

## Current Position

- **Milestone**: 1 (initial submission)
- **Phase**: 3 — Wallet Service (in progress, 6/10 plans complete inside the phase; 2/10 phases complete overall)
- **Plan**: P3.07 complete → Kong gateway map narrowed to two regex-anchored, method-constrained wallets routes (`POST ~/wallets$`, `GET ~/wallets/me$`); five mutation probes return Kong-origin 404 before reaching wallets:4002 (verified body signature: `no Route matched with those values` + `request_id` field). REQ-WALL-04 closed at the gateway layer; AMQP-side closure still owned by Plan 03-06.
- **Status**: Gateway surface is verifiably tightened. Mutation paths (applyDebit/applyCredit) are still reserved for Plan 03-06; once that lands the AMQP-side of REQ-WALL-04 is also closed.
- **Progress**: `▰▰▱▱▱▱▱▱▱▱` 2/10 phases complete (Phase 3 in progress: 6/10 plans)

**Next action**: Plan 03-06 (mutation repository — applyDebitAtomically + applyCreditAtomically + AMQP wallet.debit / wallet.credit handlers) is the unblocking work remaining on the wallet-service mutation path.

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 10 |
| Phases complete | 2 / 10 |
| v1 requirements mapped | 95 / 95 (100%) |
| v1 requirements complete | 10 / 95 (REQ-AUTH-04 + REQ-AUTH-05 + REQ-WALL-01 + REQ-WALL-02 + REQ-WALL-03 + REQ-WALL-04 + REQ-WALL-05 + REQ-WALL-06 + REQ-SAGA-05 + REQ-SAGA-06) |
| Stretch backlog items | 8 |
| ADRs landed | 10 (Phase 1: 6, Phase 2: 4) |
| ADRs anticipated | 30+ (Phase 1: 6, Phase 2: 4, Phase 3: 2, Phase 4: 4, Phase 5: 2, Phase 6: 3, Phase 7: 4, Phase 8: 2, Phase 9: 3, Phase 10: 3) |
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

- [x] Run `/gsd:plan-phase 1` (Foundation & Infra) — done; Phase 1 implementation complete
- [x] Run `/gsd:plan-phase 2` (Outbox/Inbox Messaging Spine) — done; Phase 2 complete (10/10 plans)
- [ ] Run `/gsd:verify-phase 2` (goal-backward audit against ROADMAP Phase 2 Success Criteria)
- [ ] Run `/gsd:plan-phase 3` (Wallet Service) and `/gsd:plan-phase 4` (Game Core) — parallelizable after Phase 2 verifies
- [ ] Phase 10 follow-up: archival job for outbox PROCESSED rows + dead-letter replay endpoint
- [ ] Phase 10 follow-up: Prometheus `dead_letter_messages_count{service}` gauge per ADR-009 monitoring note
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
| 1. Foundation & Infra | 10 / 10 plans landed (P1.10 smoke test green) | Implementation complete, verifier pending | All seven smoke probes pass cold and warm |
| 2. Outbox/Inbox Messaging Spine | 10 / 10 plans landed (P2.10 ADRs + closeout) | Implementation complete, verifier pending | `@crash/messaging-spine` wired into both services; 4 ADRs landed; 22/22 smoke probes; unit + integration tests green |
| 3. Wallet Service | 6 / 10 plans landed (P3.01 spine OI, P3.02 domain, P3.03 schema, P3.04 JWT guard, P3.05 REST surface, P3.07 Kong narrowing) | In progress | Gateway surface verifiably tightened; mutation-side closure pending P3.06 AMQP consumers |
| 4. Game Core (domain only) | — | Not started | Parallel with Phase 3 (post Phase 2) |
| 5. Saga Integration | — | Not started | Depends on Phase 3 + Phase 4 |
| 6. WebSocket Gateway & Multiplier Sync | — | Not started | Depends on Phase 5 |
| 7. Frontend Vertical Slice | — | Not started | Depends on Phase 6 |
| 8. Provably-Fair UX, History & Replay | — | Not started | Depends on Phase 7 |
| 9. Auto Features & Leaderboard | — | Not started | Parallel with Phase 8 (post Phase 7) |
| 10. Quality Hardening & Docs | — | Not started | Depends on Phase 9 |

### Recent activity

- **2026-05-25** — P3.07 (Kong wallets route narrowing) executed: `docker/kong/kong.yml` wallets-service block replaced with two named, method-constrained, regex-anchored routes (`wallets-provision` POST `~/wallets$`, `wallets-me` GET `~/wallets/me$`). Two commits — `ae853d0` (initial narrowing with plain prefix paths) and `fdd5ec5` (Rule 1 deviation: plain prefix leaked POST /wallets/me/debit to the service, switched to PCRE-anchored regex paths to force exact-match). Live probe matrix records 5/5 mutation methods/paths returning Kong-origin 404 (`no Route matched with those values` + `request_id`), 2/2 allowed paths forwarding to wallets:4002, games-routes untouched. Admin API confirms exactly three loaded routes: `wallets-provision`, `wallets-me`, `games-routes`. REQ-WALL-04 closed at the perimeter; the AMQP-side closure (debit/credit only via RabbitMQ) is still owned by Plan 03-06. P3.09 smoke probes will lift this matrix verbatim once P3.05 controllers land in the container image.
- **2026-05-25** — P3.02 (Wallet domain layer) executed: pure-domain Wallet bounded context landed in `services/wallets/src/domain/`. Three commits — `78aa2c8` (errors + repository interfaces), `24759d0` (Transaction aggregate — immutable factory-constructed ledger entry, frozen instance + props, MoneySnapshot on wire), `4172735` (Wallet aggregate — provision/rehydrate/debit/credit with snapshot semantics, translates NegativeMoneyError into InsufficientFundsError with both requested + available snapshots). 13/13 unit tests pass, `bunx tsc --noEmit` clean, zero infra imports inside `src/domain/`. Synchronous Wallet.debit/credit predicate is the building block Plan 03-08 will hammer with `fast-check`.
- **2026-05-25** — P3.01 (messaging-spine OI follow-ups) executed: closed OI-1 (envelope unwrap), OI-3 (txEm propagation to handler), and W3 (`OutboxRepository.add` accepts optional EM). Three commits — `d0ebe44` (RED unit regressions: 3 fail / 2 pass against unpatched decorator), `ff110d5` (GREEN patch — decorator + outbox repo + docstring), `1eb453a` (integration tests updated: 5 of 6 probes peeled by one hop, 10 lines net). Final suite: 61 unit pass + 6 integration pass + typecheck clean. Public-API change documented for ADR-013 (handler third-arg `txEm` is part of the spine's surface).
- **2026-05-24** — P2.10 (Phase 2 closeout) executed: ADR-007 (hand-rolled `@crash/messaging-spine` over `nestjs-outbox` / `pg-transactional-outbox`), ADR-008 (`amqplib` raw publisher + `@golevelup/nestjs-rabbitmq` consumer split), ADR-009 (DLX with `x-delivery-limit` on the DLQ itself, quorum queues), ADR-010 (dedicated `pg.Client` for LISTEN/NOTIFY outside MikroORM pool) authored; ADR catalogue README extended with the Phase 2 section; STATE + ROADMAP advanced to Phase 2 complete (2/10); REQUIREMENTS traceability marked REQ-WALL-05, REQ-WALL-06, REQ-SAGA-05, REQ-SAGA-06 as Done. Phase 2 is provably complete: 10/10 plans, 4 ADRs, integration tests green, smoke-health 22/22.
- **2026-05-24** — P2.9 (integration tests) executed in parallel with P2.10 (Wave 7). Six scenarios via testcontainers + `MessagingProbe`.
- **2026-05-24** — P2.8 (unit tests) executed: 5 unit suites (envelope, topology, inbox SQL, dead-letter, CLS) landed under `packages/messaging-spine/tests/unit/`. Commits `d7c9048`, `536cf70`, `4004ca0`.
- **2026-05-24** — P2.7 (service wiring) executed: both `services/games` and `services/wallets` now mount `MikroOrmModule.forRoot` + `MessagingSpineModule.forRootAsync` with per-service TopologyConfig; six MikroORM migrations (three per service) apply the canonical SQL fragments at boot via `require.resolve` against new subpath exports on `@crash/messaging-spine`; per-service `GamesDeadLetterConsumer` and `WalletsDeadLetterConsumer` subscribe to their DLQs via `@RabbitSubscribe` with `buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_DLQ)`; `OUTBOX_POLL_BATCH_SIZE=100` added to both env schemas. Smoke-health extended with 15 new probes (tables + topology); 22/22 PASS on cold docker:up. Commits `1c50caa`, `18d1a26`, `da03b18`, `f239cb6`, `b8f6f03`. Four Rule-3 auto-fixes against messaging-spine itself: (1) added `./src/migrations/shared/*.sql` to package exports so migrations can resolve the SQL bodies; (2) hoisted MESSAGING_OPTIONS into a tiny global sub-module so RabbitMQModule.forRootAsync can inject it; (3) mapped TopologyConfig into RabbitMQConfig.exchanges/queues so RabbitMQModule asserts them on connect (before @RabbitSubscribe binding); (4) added `@types/amqplib` to both services.
- **2026-05-24** — P2.6 (TopologyBootstrap + MessagingSpineModule composition) executed: shipped `TopologyBootstrap` `@Injectable` (asserts every configured exchange/quorum queue/binding at `OnApplicationBootstrap` via a one-shot channel that always closes), and `MessagingSpineModule.forRootAsync({ useFactory, inject, imports? })` that wires `MessagingClsModule.forRoot()` → `RabbitMQModule.forRootAsync(...)` → `MikroOrmModule.forFeature([OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema])`, registers Outbox/Inbox/DeadLetter repositories + listener + publisher + bootstrap, and re-exports the three repos plus the CLS/Rabbit/Mikro modules. Barrel now surfaces the complete public API needed by P2.7 service wiring. Commits `8786fb7`, `33f6647`. Deviation: Rule 3 — `MikroOrmModule.forFeature` receives the `EntitySchema` instances (not the bare classes) because messaging entities are defined via `EntitySchema`, not class decorators.
- **2026-05-25** — P2.3 (envelope/topology/CLS contracts) executed: shipped `buildEnvelope`/`parseEnvelope` with required `causationId`, AMQP header bridge (`envelopeToAmqpHeaders`/`amqpHeadersToEnvelopeMeta`/`AMQP_HEADER_KEYS`), topology constants (`EXCHANGES`/`QUEUES`/`buildQuorumArgs`/`deriveDlxFromExchange`), zod `topologyConfigSchema`, `MessagingClsModule.forRoot()`, and `withMessagingContext()`. Commits `3005f81`, `728bc3a`, `c6fa3f6`. Deviation: added `zod` to messaging-spine peer dependencies (Rule 3 — `topologyConfigSchema` import). Deferred: pre-existing MikroORM decorator typecheck errors in `src/outbox`, `src/inbox`, `src/dead-letter` (P2.2 scope, untracked stubs).
- **2026-05-24** — P1.10 (healthcheck smoke test) executed: HealthController per service, env-driven NestJS bootstrap, `scripts/smoke-health.sh` covers 7 probes (postgres, rabbitmq, keycloak health + token, kong, games, wallets), all green on cold + warm bootstrap. Commits `3c0bad2`, `b5d37ec`, `438c7df`. Deviations: postgres 18 mount layout, mikro-orm warnWhenNoEntities=false, healthcheck pinned to 127.0.0.1 for Alpine IPv6.
- **2026-05-24** — P1.9 (repo README) executed: rewrote `README.md` with the Phase 1 surface — Quickstart, 19-row env table, demo-user curl flow, healthcheck probes, ADR + Roadmap links. Commit `bba12a0`.
- **2026-05-24** — Roadmap created (10 phases, 95/95 v1 REQ-IDs mapped, stretch backlog defined). STATE.md initialized. REQUIREMENTS.md traceability appended.
- **2026-05-24** — Research synthesis completed (SUMMARY, STACK, ARCHITECTURE, FEATURES, PITFALLS).
- **2026-05-24** — Project initialized (PROJECT.md, REQUIREMENTS.md, config.json).

---

*Last updated: 2026-05-25 by gsd-executor (P3.07 — Kong wallets route narrowing; REQ-WALL-04 closed at the gateway perimeter).*
