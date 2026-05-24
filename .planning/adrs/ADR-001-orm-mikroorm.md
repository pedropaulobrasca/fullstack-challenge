# ADR-001: ORM selection — MikroORM 7

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 1

## Context

The Crash Game challenge weights DDD and architecture at 25% of the final score. REQ-DOM-08 requires rich aggregates with behavior methods (`round.acceptBet`, `bet.cashOut`, `wallet.debit`), zero infrastructure imports in the domain layer, and one-aggregate-per-transaction consistency. REQ-WALL-02 requires the Wallet to mutate balance only inside transactions co-located with outbox writes. REQ-DOM-03 forbids any float arithmetic, which means the ORM must round-trip `bigint` cents and `NUMERIC` columns losslessly into a `Money` value object (see ADR-002).

The ORM choice is the single largest constraint on aggregate purity for the lifetime of the project: it dictates whether entities can stay POJOs, whether the Unit of Work is explicit, and whether `em.transactional()` can wrap a domain mutation plus an outbox insert in a single SQL transaction.

Four candidates were evaluated against this brief: MikroORM 7.1+, Prisma 6/7, TypeORM, and Drizzle.

## Considered

- **MikroORM 7.1+** — Data Mapper. Identity Map + Unit of Work per request via `@mikro-orm/nestjs` request-scoped EntityManager. `em.transactional(IsolationLevel.SERIALIZABLE, ...)` wraps domain + outbox writes in a single TX. Embeddables natively map value objects (Money, Multiplier) to columns. `BIGINT` and `NUMERIC` driver round-trips preserve `bigint` / string precision. Bun 1.3 compatibility verified by the maintainer guide. Costs: explicit CLI-driven migrations; circular entity references need `Relation<>` under SWC.
- **Prisma 6/7** — Schema-first generator emits plain types with no encapsulation. Forces an anemic-service-with-getters anti-pattern. Unit of Work is implicit per query; aggregate transactions exist (`$transaction`) but the philosophy fights DDD. Excellent DX, large ecosystem, Bun support stable since 5.4.
- **TypeORM** — Active Record + Data Mapper duality leaks framework concerns into entities. Repository pattern is shallow. Maintenance velocity has slowed. Known circular-dep issues under SWC + Bun. Mature but legacy.
- **Drizzle** — Query builder with excellent inference. No Identity Map, no Unit of Work, no aggregate persistence story. Would force hand-rolling every DDD primitive — net cost over a 5-day timeline.

## Decision

**MikroORM 7.1+** is the ORM for both services (`games`, `wallets`). Packages: `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/nestjs`, `@mikro-orm/migrations`, `@mikro-orm/seeder`.

Rationale, per STACK.md §2.1 and SUMMARY.md §2: the Identity Map guarantees aggregates returned from a repository are the same instance across the request, eliminating "load then re-save with stale state" bugs that REQ-DOM-01/02/03 invariants depend on. Data Mapper keeps entities free of framework base classes — the domain layer imports nothing from `@mikro-orm/*` decorators (decorators live on infrastructure-side ORM-mapping classes). `em.transactional(IsolationLevel.SERIALIZABLE)` is one line and covers the dual-write contract for outbox/inbox (REQ-WALL-03). Embeddables map the `Money` VO directly. Bun 1.3.11 + NestJS 11.1.21 + MikroORM 7.1 is the combination verified by the PAS7 Studio Bun+NestJS guide cited in RESEARCH §Standard Stack.

The 25% architecture scoring band is the deciding factor: Prisma's anemic-by-default ergonomics would force defensive structure to recover DDD purity, and the recruiter sees the cost during the arguição.

## Consequences

- **Locked in**: explicit migration files via the MikroORM CLI; per-service `mikro-orm.config.ts`; `Relation<EntityName>` wrapper required for circular references under Bun's SWC transform; one-shot migration init container pattern per service (see RESEARCH §Pattern 1).
- **Foreclosed**: Prisma's introspection-driven schema-first workflow; Active Record ergonomics; query-builder-only approaches.
- **Anticipated recruiter question**: "Why not Prisma?" — defended by the DDD weighting in the rubric and the Identity Map / Unit of Work argument captured here.
- **Risk surface**: less-popular than Prisma, so Stack Overflow coverage is thinner; mitigated by the official MikroORM docs and the maintainer-blessed NestJS integration package.

## Alternatives Rejected

- **Prisma 6/7** — anemic-by-default generator fights the 25%-weighted DDD scoring band; would force defensive wrappers to recover aggregate purity.
- **TypeORM** — Active Record + Data Mapper duality leaks framework into entities; maintenance has slowed; known SWC + Bun circular-dep friction.
- **Drizzle** — query builder without Unit of Work or Identity Map; net cost over 5 days to hand-roll aggregate persistence.
