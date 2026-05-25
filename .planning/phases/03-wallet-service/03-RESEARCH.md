# Phase 3: Wallet Service — Research

**Researched:** 2026-05-25
**Domain:** Money-handling microservice (DDD aggregates + REST + AMQP consumer + JWT auth + ledger model)
**Confidence:** HIGH (stack locked, Phase 2 spine landed and probed; only OI follow-ups + JWKS guard surface real choices)

---

## Summary

Phase 3 turns the empty `wallets-service` scaffold into a complete bounded context: rich `Wallet` aggregate with `Money` invariants, immutable `Transaction` ledger, idempotent `POST /wallets` provisioning, `GET /wallets/me`, and two AMQP consumers (`wallet.debit`, `wallet.credit`) that route through Phase 2's `@IdempotentSubscribe` decorator. The five success criteria are now all individually wireable to concrete tests (DB CHECK, property-test on zero-net sequences, no-mutation REST surface verified via Kong smoke, inbox-replay no-op, idempotent provisioning).

Two structural decisions surface as ADR-worthy: (a) `Transaction` is its own append-only aggregate (ledger model, not event sourcing) — written in the same DB TX as the `Wallet` snapshot mutation, never across services; (b) JWT validation happens at each NestJS service via `jose`'s `createRemoteJWKSet` (cache + cooldown built in) — Kong stays a pure router. A third opportunity surfaces from Phase 2's `OI-3` follow-up: the `@IdempotentSubscribe` decorator should propagate `txEm` to handlers (Option A below), and `OI-1`'s wire-envelope double-wrap should be fixed at the decorator boundary (one-line change). Both are tiny, both are in scope.

The atomic-debit pattern locks to a conditional `UPDATE ... WHERE balance_cents >= $1 RETURNING balance_cents` against the EM's connection. This is the canon Postgres + bigint money pattern: the DB enforces the invariant (CHECK constraint as defence in depth, conditional WHERE as primary guard), and rowcount === 0 is the unambiguous signal for `INSUFFICIENT_FUNDS` — no race window, no aggregate load+save dance, no SERIALIZABLE retry loop.

**Primary recommendation:** Wallet aggregate exposes pure-domain `debit(...)` / `credit(...)` that return the next snapshot + a Transaction event. The AMQP handler runs inside `em.transactional(...)` (decorator-managed), calls a `WalletRepository.applyDebitAtomically(walletId, money, correlationId)` that emits one raw conditional UPDATE + one Transaction INSERT + one outbox row. REST controllers stay read/provision-only (`POST /wallets`, `GET /wallets/me`); a `JwtGuard` based on `jose.jwtVerify + createRemoteJWKSet` injects `playerId` from the `sub` claim. Property test in `bun:test` + `fast-check` over zero-net sequences (10k cases). Kong route map stays trimmed; smoke-health.sh grows three new probes (token, provision, get-me).

---

## User Constraints (from CONTEXT.md)

> No `discuss-phase` was run for Phase 3. The phase context comes from ROADMAP Phase 3, REQUIREMENTS REQ-DOM-03 / REQ-AUTH-04 / REQ-WALL-01..04 / REQ-WALL-07, and Phase 2's VERIFICATION carry-forward (OI-1..OI-5). All decisions inside this phase are Claude's discretion subject to the locked decisions table below.

### Locked Decisions (from ROADMAP + PROJECT + STACK)

- **Stack:** NestJS 11.1.21, MikroORM 7.1, Postgres 18, Dinero v2 wrapped in `Money` VO, RabbitMQ 4.2 quorum queues, Keycloak 26.5, Kong DB-less router, Bun 1.3.11 runtime, `bun:test` + `fast-check` for tests.
- **Money:** `Money` VO from `@crash/shared-kernel` (Dinero v2 backed by bigint). Postgres column: `BIGINT` cents (ESLint guard banning `number` for `/amount|balance|bet|payout|price|wager/i` is already live from Phase 1).
- **Auth pattern:** Kong has no JWT plugin (already stripped — see `docker/kong/kong.yml`). Each service validates JWT itself via JWKS — REQ-AUTH-04 + ARCHITECTURE §1.
- **Messaging:** Phase 2 `@crash/messaging-spine` provides `OutboxRepository`, `@IdempotentSubscribe`, `InboxRepository`, topology assert at bootstrap. Phase 3 consumes; does not reimplement.
- **Initial balance:** `INITIAL_BALANCE_CENTS=100000` (env-driven, already in `services/wallets/src/config/defaults.ts`).
- **Currency:** `CRD { code: 'CRD', base: 10n, exponent: 2n }` (already in `@crash/shared-kernel/money/currency.ts`).
- **Wallet REST surface:** ONLY `POST /wallets` and `GET /wallets/me`. Any mutation REST path is disqualifying (REQ-WALL-04).

### Claude's Discretion (this research recommends)

- Atomic UPDATE strategy (conditional WHERE vs SERIALIZABLE TX).
- Transaction-as-aggregate vs Transaction-as-child-entity.
- JWKS library (`jose` vs `jwks-rsa` + `jsonwebtoken`).
- OI-1 / OI-3 resolution shape (decorator change vs handler convention).
- Property-test arbitrary design + assertion shape.

### Deferred Ideas (OUT OF SCOPE for Phase 3)

- Bet aggregate (Phase 4 owns it — Phase 3 does NOT model bet status).
- Saga orchestration (Phase 5 — Phase 3 emits `wallet.debited` / `wallet.debit.rejected` / `wallet.credited` events; Game side consumes in Phase 5).
- WebSocket gateway / `wallet:balance` push (Phase 6).
- Token refresh mid-connection (Phase 6 — Phase 3 just validates one HTTP-call's token).
- OpenTelemetry instrumentation (Phase 10).
- Multi-currency support (CRD only).

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-DOM-03 | Wallet aggregate balance + precision invariants | §1 Wallet aggregate API + §3 Postgres CHECK + §11 property test |
| REQ-AUTH-04 | JWT validation via cached JWKS at each service | §6 JWKS guard (`jose.createRemoteJWKSet`) |
| REQ-WALL-01 | `POST /wallets` idempotent provisioning | §5 REST endpoints |
| REQ-WALL-02 | `GET /wallets/me` returns balance + metadata | §5 REST endpoints |
| REQ-WALL-03 | Initial balance from `INITIAL_BALANCE_CENTS` | §5 + already-wired env in `defaults.ts` |
| REQ-WALL-04 | Debit/credit only via RabbitMQ (no REST mutations) | §4 AMQP consumer + §7 Kong route hardening |
| REQ-WALL-07 | Immutable Transaction ledger row per debit/credit | §2 Transaction aggregate + §3 DDL |

---

## Project Constraints (from CLAUDE.md)

- **Money:** Never `number` for monetary fields. `BIGINT` cents column. `pg` returns NUMERIC as string — only parse via `Money.fromSnapshot` or `Money.of(BigInt(raw))`.
- **Domain layer:** Zero infra imports. Aggregates expose behaviour methods (`wallet.debit(...)`). VOs throw on invalid construction.
- **One aggregate per TX:** Wallet + Transaction live in the *same* bounded context (same DB), so a single MikroORM TX writing both rows is allowed and correct. Cross-service consistency (Wallet ↔ Game) goes through saga + outbox, NEVER multi-aggregate TX across services.
- **Config:** No hardcoded business constants. Everything from `services/wallets/src/config/defaults.ts` (zod-parsed env).
- **Saga / messaging envelope:** `{ messageId, correlationId, causationId, type, version, occurredAt, payload }`. Outbox write same-TX as state change. Inbox dedupe same-TX as side-effect.
- **Commits:** No `Co-Authored-By: Claude`, no "Generated by", no AI attribution, no emojis. PT-BR or EN both OK; match the project (currently EN).
- **Tests:** Property tests on monetary invariants are MANDATORY in Phase 3 (per CLAUDE.md).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wallet provisioning (idempotent) | API / Backend (wallets-service) | — | First-login provisioning per ADR-005; only the service knows whether a wallet exists |
| Balance read (`/wallets/me`) | API / Backend (wallets-service) | — | Read model is single-row Wallet snapshot; no projection layer needed |
| Balance mutation (debit / credit) | API / Backend (wallets-service AMQP consumer) | — | REST mutation is explicitly disqualifying (REQ-WALL-04); only AMQP `wallet.commands.q` |
| JWT validation | API / Backend (every NestJS service) | — | Kong has no JWT plugin (ARCH §1); each service holds a `jose` JWKS cache |
| Domain invariants (balance >= 0, currency match) | Domain layer (`Wallet` aggregate + Postgres CHECK) | Database | Defence in depth — aggregate `debit` throws; conditional UPDATE rejects; CHECK constraint is fail-closed safety net |
| Idempotency on AMQP redelivery | Infrastructure (Phase 2 `@IdempotentSubscribe` + `inbox` table) | — | Phase 2 spine owns the inbox table + decorator; Phase 3 just decorates handlers |
| Event emission (`wallet.debited` etc.) | Infrastructure (Phase 2 `OutboxRepository` + `OutboxPublisher`) | — | Phase 2 spine owns the outbox + polling publisher; Phase 3 calls `outbox.add(...)` in the handler TX |
| Transaction ledger | Domain (Transaction entity) | Database (immutable insert) | Append-only audit trail per REQ-WALL-07 |

---

## Standard Stack

### Core (already locked + present in `services/wallets/package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/common` / `@nestjs/core` | 11.1.21 | Service framework | Locked stack (STACK §1) |
| `@mikro-orm/core` + `@mikro-orm/postgresql` + `@mikro-orm/nestjs` | 7.1.x | ORM + DDD-native UoW | Locked (STACK §2.1, ADR-001) |
| `@crash/shared-kernel` | workspace | Money VO, errors, branded IDs | Phase 1 deliverable |
| `@crash/contracts` | workspace | `serializeMoney`, `parseMoneySnapshot`, zod | Phase 1 deliverable |
| `@crash/messaging-spine` | workspace | Outbox, inbox, `@IdempotentSubscribe`, topology | Phase 2 deliverable |
| `@golevelup/nestjs-rabbitmq` | 9.0.2 | AMQP consumer ergonomics | Used by Phase 2 (ADR-008) |
| `amqplib` | 0.10.9 | Raw publisher (Phase 2 owns) | Used by Phase 2 (ADR-008) |
| `nestjs-cls` | 6.2.0 | CLS for correlationId propagation | Used by Phase 2 (`MessagingClsModule`) |
| `zod` | 3.23+ | Edge validation | Locked (STACK §2.6) |

### Supporting (to add in Phase 3)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `jose` | 6.2.3 [VERIFIED: npm registry] | JWT verify + `createRemoteJWKSet` cache | The single dep for JWKS validation. Built-in cache + cooldown (`cacheMaxAge` since v4) means no manual cache plumbing. Modern, audited, used widely in 2026. [CITED: github.com/panva/jose] |
| `nestjs-zod` | 5.4.0 [VERIFIED: npm registry] | NestJS controller pipe wiring + DTO types from zod schemas | DTOs for `POST /wallets` / `GET /wallets/me` request + response shapes. Avoids class-validator (banned by STACK §2.6). |
| `fast-check` | 4.8.0 [VERIFIED: npm registry] | Property test 10k zero-net sequences | Per CLAUDE.md mandate + ROADMAP success criterion 5. Already present in repo (Phase 1 property test on Money). Note: STACK §1 listed `^3.x` but `4.x` is current; pin to current. |

**Note:** `STACK.md §3` listed `passport-jwt + jwks-rsa + @nestjs/passport + @nestjs/jwt` as the auth chain. After re-research, **`jose` alone is the better fit** for this challenge:
- Phase 2 already uses `nestjs-cls` and explicit `@RabbitSubscribe` decorators — there's no Passport ecosystem investment to amortise.
- `jose.createRemoteJWKSet` ships with cache + cooldown built in (no `jwks-rsa` rate-limiter to configure).
- Three-package chain (`passport-jwt + jwks-rsa + @nestjs/passport`) brings reflect-metadata + decorator magic that fights Bun's SWC transform (M1 from PITFALLS).
- A single `JwtGuard implements CanActivate` is ~30 lines; no Passport class needed.

This recommendation overrides STACK §3's listed packages for Phase 3. Document the override in ADR-012 (JWKS validation).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `jose` | `jwks-rsa` + `jsonwebtoken` + `passport-jwt` | More packages, more decorator metadata, less audited cache layer — rejected per reasoning above |
| `jose` | Kong JWT plugin | Would require Kong DB-mode or external plugin server. Distributes auth concern across two systems. Rejected by ARCH §1 + ADR-012 below |
| `Transaction` as child entity of `Wallet` | Load `Wallet` + its transactions, append, save all | Locks the whole entity tree on every operation. Wallet snapshot mutation + transaction insert is conceptually two-row write in same TX, no reason to load history each time |
| MikroORM `em.transactional(SERIALIZABLE)` + load-modify-save | Atomic conditional UPDATE | SERIALIZABLE retries under contention; conditional UPDATE is one round-trip, zero retries, atomic by definition |
| `passport-jwt` strategy class | `JwtGuard` implementing `CanActivate` directly | Passport adds a layer; we own less code by skipping it |

**Installation:**

```bash
cd services/wallets
bun add jose nestjs-zod fast-check
```

**Version verification (run before commit):**

```bash
npm view jose version                    # confirmed: 6.2.3
npm view nestjs-zod version              # confirmed: 5.4.0
npm view fast-check version              # confirmed: 4.8.0
```

---

## Package Legitimacy Audit

> slopcheck not available in this research session — all packages tagged `[VERIFIED: npm registry]` were also verified against authoritative sources (`jose` official panva/jose repo, `nestjs-zod` official maintained package, `fast-check` already used in repo). Planner does NOT need to gate behind `checkpoint:human-verify` because all three packages have multi-year publication history + verified GitHub source + >1M weekly downloads.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `jose` | npm | 8+ yrs | 30M+/wk | github.com/panva/jose | N/A (unavailable) | Approved — author panva (Filip Skokan, OIDC certified) is the authoritative Node.js JOSE implementer |
| `nestjs-zod` | npm | 3+ yrs | 200k+/wk | github.com/BenLorantfy/nestjs-zod | N/A | Approved — official NestJS+zod bridge |
| `fast-check` | npm | 7+ yrs | 1.5M+/wk | github.com/dubzzz/fast-check | N/A | Approved — already present in Phase 1 |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
                              ┌─────────────────────────┐
   ┌──── HTTP (JWT) ─────────▶│ Kong (router only)      │
   │     POST /wallets        │ - /wallets → wallets:4002
   │     GET  /wallets/me     │ - NO mutation routes    │
   │                          └──────────┬──────────────┘
   │                                     ▼
┌──┴──────┐        ┌──── JWKS pull ─────┬──────────────────────────────┐
│ Browser │        │  (cached, cooldown)│                              │
└─────────┘        ▼                    │                              │
              ┌──────────────┐          ▼                              │
              │ Keycloak     │  ┌──────────────────────────────────┐  │
              │ realm        │  │  wallets-service (NestJS, :4002) │  │
              │ crash-game   │  │                                  │  │
              └──────────────┘  │  ┌─ Presentation ─────────────┐  │  │
                                │  │ WalletsController          │  │  │
                                │  │  - POST /wallets           │  │  │
                                │  │  - GET  /wallets/me        │  │  │
                                │  │  Guard: JwtGuard           │  │  │
                                │  │     (jose.jwtVerify        │  │  │
                                │  │      + createRemoteJWKSet) │  │  │
                                │  └────────────┬───────────────┘  │  │
                                │               │                   │  │
                                │               ▼                   │  │
                                │  ┌─ Application ──────────────┐  │  │
                                │  │ ProvisionWallet usecase    │  │  │
                                │  │ DebitWallet usecase ◀──────┼──┼──┼─ AMQP commands
                                │  │ CreditWallet usecase ◀─────┼──┼──┼─ (Phase 2 spine)
                                │  └────────────┬───────────────┘  │  │
                                │               │                   │  │
                                │               ▼                   │  │
                                │  ┌─ Domain ────────────────────┐  │  │
                                │  │ Wallet aggregate            │  │  │
                                │  │  - provision(initial)       │  │  │
                                │  │  - debit(amount, corrId)    │  │  │
                                │  │  - credit(amount, corrId)   │  │  │
                                │  │ Transaction aggregate       │  │  │
                                │  │  - immutable, append-only   │  │  │
                                │  │ Money VO (Phase 1)          │  │  │
                                │  └────────────┬────────────────┘  │  │
                                │               │                   │  │
                                │               ▼                   │  │
                                │  ┌─ Infrastructure ────────────┐  │  │
                                │  │ WalletRepository            │  │  │
                                │  │  applyDebitAtomically:      │  │  │
                                │  │   UPDATE wallets            │  │  │
                                │  │   SET balance_cents =       │  │  │
                                │  │     balance_cents - $amt    │  │  │
                                │  │   WHERE id=$id              │  │  │
                                │  │     AND balance_cents >= $amt│  │ │
                                │  │   RETURNING balance_cents   │  │  │
                                │  │ TransactionRepository       │  │  │
                                │  │ WalletDebitConsumer  ──▶ OutboxRepository.add(event) │
                                │  │ WalletCreditConsumer        │  │  │
                                │  └─────────────┬───────────────┘  │  │
                                └────────────────┼──────────────────┘  │
                                                 │ same TX               │
                                                 ▼                       │
                              ┌──────────────────────────────┐           │
                              │  Postgres wallets DB         │           │
                              │  wallets (balance CHECK >= 0)│           │
                              │  transactions (immutable)    │           │
                              │  outbox  (Phase 2)           │           │
                              │  inbox   (Phase 2)           │           │
                              └────────────────────┬─────────┘           │
                                                   │ pg_notify trigger    │
                                                   ▼                       │
                              ┌──────────────────────────────┐           │
                              │ OutboxPublisher (Phase 2)    │           │
                              │ confirmSelect + waitForConfirms ──▶ RabbitMQ
                              │                              │             │
                              │ Inbox dedupe ◀──────────── @IdempotentSubscribe handler
                              └──────────────────────────────┘
```

**Component responsibilities table:**

| File / Component | Layer | Responsibility |
|------------------|-------|----------------|
| `presentation/controllers/wallets.controller.ts` | Presentation | REST endpoints (`POST /wallets`, `GET /wallets/me`); applies `JwtGuard`; calls usecases |
| `presentation/guards/jwt.guard.ts` | Presentation | `CanActivate` — extracts Bearer, calls `jose.jwtVerify`, attaches `req.user = { playerId }` |
| `presentation/dtos/*.ts` | Presentation | zod schemas + DTOs for request + response |
| `application/use-cases/provision-wallet.ts` | Application | Idempotent: load by playerId → return if exists → create + persist + return |
| `application/handlers/wallet-debit.handler.ts` | Application | `@IdempotentSubscribe` consumer for `wallet.debit`. Inside TX: atomic update, transaction insert, outbox event |
| `application/handlers/wallet-credit.handler.ts` | Application | `@IdempotentSubscribe` consumer for `wallet.credit`. Inside TX: atomic update, transaction insert, outbox event |
| `domain/wallet.aggregate.ts` | Domain | `Wallet` class — invariants, behaviour, `Money` balance |
| `domain/transaction.aggregate.ts` | Domain | `Transaction` class — immutable, factory-constructed |
| `domain/errors.ts` | Domain | `InsufficientFundsError`, `WalletNotFoundError`, `WalletAlreadyExistsError` |
| `infrastructure/repositories/wallet.repository.ts` | Infrastructure | `applyDebitAtomically`, `applyCreditAtomically`, `findByPlayerId`, `save` |
| `infrastructure/repositories/transaction.repository.ts` | Infrastructure | `append(transaction)` — INSERT only |
| `infrastructure/persistence/wallet.entity.ts` | Infrastructure | MikroORM `EntitySchema` for `wallets` table |
| `infrastructure/persistence/transaction.entity.ts` | Infrastructure | MikroORM `EntitySchema` for `transactions` table |
| `infrastructure/mikro-orm/migrations/*-create-wallets.ts` | Infrastructure | DDL: `wallets` table with `CHECK (balance_cents >= 0)` |
| `infrastructure/mikro-orm/migrations/*-create-transactions.ts` | Infrastructure | DDL: `transactions` table |

### Recommended Project Structure

```
services/wallets/src/
├── domain/
│   ├── wallet.aggregate.ts
│   ├── transaction.aggregate.ts
│   ├── wallet.repository.ts          # interface only
│   ├── transaction.repository.ts     # interface only
│   └── errors.ts
├── application/
│   ├── use-cases/
│   │   └── provision-wallet.ts
│   └── handlers/
│       ├── wallet-debit.handler.ts
│       └── wallet-credit.handler.ts
├── infrastructure/
│   ├── persistence/
│   │   ├── wallet.entity.ts          # EntitySchema (POJO)
│   │   └── transaction.entity.ts
│   ├── repositories/
│   │   ├── mikro-wallet.repository.ts
│   │   └── mikro-transaction.repository.ts
│   ├── messaging/
│   │   └── wallets-dead-letter.consumer.ts   # already exists (Phase 2)
│   └── mikro-orm/
│       └── migrations/
│           ├── 20260525001-create-wallets.ts
│           └── 20260525002-create-transactions.ts
├── presentation/
│   ├── controllers/
│   │   ├── wallets.controller.ts
│   │   └── health.controller.ts      # already exists (Phase 1)
│   ├── dtos/
│   │   ├── provision-wallet.dto.ts
│   │   └── wallet-view.dto.ts
│   └── guards/
│       └── jwt.guard.ts
├── config/
│   └── defaults.ts                   # already exists; ADD KEYCLOAK_ISSUER, KEYCLOAK_JWKS_URI, KEYCLOAK_AUDIENCE
├── app.module.ts                     # extend with WalletsModule wiring
└── main.ts
```

### Pattern 1: Aggregate behaviour + repository persistence (DDD canon)

**What:** Domain aggregate exposes behaviour returning the next state + domain events. Repository persists via MikroORM. Application handler orchestrates inside a TX.

**When to use:** Every state mutation in this phase.

**Example:**

```typescript
// domain/wallet.aggregate.ts
// Source: ARCHITECTURE §2.2 + DDD canon (Vernon)
import { Money, type CorrelationId, type PlayerId, type WalletId } from "@crash/shared-kernel";
import { InsufficientFundsError } from "./errors";

export type WalletProps = {
  id: WalletId;
  playerId: PlayerId;
  balance: Money;
  createdAt: Date;
  updatedAt: Date;
};

export class Wallet {
  private constructor(private props: WalletProps) {}

  static provision(id: WalletId, playerId: PlayerId, initial: Money, now: Date): Wallet {
    return new Wallet({ id, playerId, balance: initial, createdAt: now, updatedAt: now });
  }

  static rehydrate(props: WalletProps): Wallet {
    return new Wallet(props);
  }

  get id(): WalletId { return this.props.id; }
  get playerId(): PlayerId { return this.props.playerId; }
  get balance(): Money { return this.props.balance; }

  debit(amount: Money, correlationId: CorrelationId, now: Date): { next: Wallet; transaction: TransactionParams } {
    const next = this.props.balance.subtract(amount); // throws NegativeMoneyError if insufficient
    return {
      next: new Wallet({ ...this.props, balance: next, updatedAt: now }),
      transaction: {
        walletId: this.props.id,
        kind: "DEBIT",
        amount,
        correlationId,
        previousBalance: this.props.balance,
        newBalance: next,
        appliedAt: now,
      },
    };
  }

  credit(amount: Money, correlationId: CorrelationId, now: Date): { next: Wallet; transaction: TransactionParams } { /* ... */ }
}
```

**Important:** the domain `Wallet.debit` enforces the invariant via `Money.subtract` (which throws `NegativeMoneyError` for negative result). But the **handler** doesn't use `Wallet.debit` for the actual mutation — it uses the **atomic UPDATE** (Pattern 3 below). The domain method exists for (a) unit tests, (b) the property test, (c) intent documentation. The atomic UPDATE is the production write path because it's race-safe; the domain method is the conceptual write path. The Transaction row built from `Wallet.debit`'s output is what gets inserted.

### Pattern 2: Inbox-dedupe AMQP handler via Phase 2 decorator

**What:** Apply `@IdempotentSubscribe({ consumerName, exchange, routingKey, queue })` to a method on a class that injects `em: EntityManager`, `cls: ClsService`, `inbox: InboxRepository`.

**Example:**

```typescript
// application/handlers/wallet-debit.handler.ts
// Source: packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts contract
import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { ClsService } from "nestjs-cls";
import {
  EXCHANGES,
  QUEUES,
  IdempotentSubscribe,
  InboxRepository,
  OutboxRepository,
  buildEnvelope,
} from "@crash/messaging-spine";

@Injectable()
export class WalletDebitHandler {
  constructor(
    public readonly em: EntityManager,
    public readonly cls: ClsService,
    public readonly inbox: InboxRepository,
    private readonly outbox: OutboxRepository,
    private readonly walletRepo: WalletRepository,
    private readonly txRepo: TransactionRepository,
  ) {}

  public readonly logger = new Logger(WalletDebitHandler.name);

  @IdempotentSubscribe({
    consumerName: "wallets.debit",
    exchange: EXCHANGES.WALLET_COMMANDS,
    routingKey: "wallet.debit",
    queue: QUEUES.WALLET_COMMANDS,
  })
  async handle(envelope: WalletDebitEnvelope): Promise<void> {
    const { playerId, amountSnapshot, correlationId } = envelope.payload;
    const amount = Money.fromSnapshot(amountSnapshot);

    const result = await this.walletRepo.applyDebitAtomically(playerId, amount);

    if (result.kind === "INSUFFICIENT_FUNDS") {
      await this.outbox.add(
        buildEnvelope({
          type: "wallet.debit.rejected",
          version: 1,
          correlationId,
          causationId: envelope.messageId,
          payload: { playerId, reason: "INSUFFICIENT_FUNDS" },
        }),
        { exchange: EXCHANGES.WALLET_EVENTS, routingKey: "wallet.debit.rejected", aggregateType: "Wallet", aggregateId: playerId },
      );
      return;
    }

    await this.txRepo.append(/* Transaction params */);
    await this.outbox.add(
      buildEnvelope({
        type: "wallet.debited",
        version: 1,
        correlationId,
        causationId: envelope.messageId,
        payload: { walletId: result.walletId, newBalanceSnapshot: result.newBalance.toSnapshot() },
      }),
      { exchange: EXCHANGES.WALLET_EVENTS, routingKey: "wallet.debited", aggregateType: "Wallet", aggregateId: result.walletId },
    );
  }
}
```

### Pattern 3: Atomic conditional UPDATE (the canon Postgres + money pattern)

**What:** A single SQL statement that mutates the balance only if the WHERE condition holds, returning the new balance.

**Example:**

```typescript
// infrastructure/repositories/mikro-wallet.repository.ts
async applyDebitAtomically(
  playerId: PlayerId,
  amount: Money,
): Promise<{ kind: "OK"; walletId: WalletId; newBalance: Money } | { kind: "INSUFFICIENT_FUNDS" }> {
  const cents = amount.toCents(); // bigint
  const rows = await this.em.getConnection().execute<Array<{ id: string; balance_cents: string }>>(
    `UPDATE wallets
     SET balance_cents = balance_cents - ?, updated_at = now()
     WHERE player_id = ? AND balance_cents >= ?
     RETURNING id, balance_cents`,
    [cents.toString(), playerId, cents.toString()],
  );
  if (rows.length === 0) return { kind: "INSUFFICIENT_FUNDS" };
  const row = rows[0]!;
  return {
    kind: "OK",
    walletId: row.id as WalletId,
    newBalance: Money.of(BigInt(row.balance_cents)),
  };
}
```

Why raw SQL and not the EM identity map? Because Phase 2's `@IdempotentSubscribe` decorator opens `em.transactional(...)` but the EM operates on its own session; mutations to entities loaded inside the transaction don't auto-flush at the right time when crossing the decorator/handler boundary (this is the OI-3 issue documented in Phase 2 VERIFICATION). Raw SQL via `this.em.getConnection().execute()` participates in the open TX (verified by Phase 2's `InboxRepository.tryClaim`, `outbox-publisher.service.ts`, integration tests). Same pattern, same TX, no identity-map surprise.

**Source:** [MikroORM Entity Manager docs](https://mikro-orm.io/docs/entity-manager) + Phase 2 `idempotent-subscribe.decorator.ts:113` + `inbox-repository.ts:13`.

### Pattern 4: JWKS-validated JWT guard with `jose`

```typescript
// presentation/guards/jwt.guard.ts
// Source: github.com/panva/jose docs (createRemoteJWKSet + jwtVerify)
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../../config/defaults";

const JWKS = createRemoteJWKSet(new URL(env.KEYCLOAK_JWKS_URI), {
  cacheMaxAge: 600_000,       // 10 min ceiling; jose follows Cache-Control under this anyway
  cooldownDuration: 30_000,   // 30s minimum between fetches per RFC 7517
});

export interface AuthenticatedRequest extends Request {
  user: { playerId: string; tokenExp: number };
}

@Injectable()
export class JwtGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers["authorization"] ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException("MISSING_BEARER_TOKEN");

    try {
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: env.KEYCLOAK_ISSUER,
        audience: env.KEYCLOAK_AUDIENCE,
      });
      req.user = { playerId: payload.sub as string, tokenExp: payload.exp as number };
      return true;
    } catch {
      throw new UnauthorizedException("INVALID_TOKEN");
    }
  }
}
```

[CITED: github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md]

### Anti-Patterns to Avoid

- **Don't load Wallet aggregate then `wallet.debit()` then `em.persist + flush`.** The race window between SELECT and UPDATE allows a parallel handler (or REST mutation, if one slipped in) to drain the balance. Use the atomic UPDATE.
- **Don't use `SERIALIZABLE` isolation as the primary defence.** SERIALIZABLE retries cost throughput and the conditional UPDATE makes the retry loop unnecessary. SERIALIZABLE may make sense for cross-row invariants in future phases, but not for single-wallet balance.
- **Don't model Transaction as a child of Wallet that loads with it.** Wallet has tens of thousands of transactions over its lifetime; loading them per debit is wasteful and never needed for the write.
- **Don't expose any REST mutation route**, including PATCH, PUT, DELETE on `/wallets`. Kong's declarative config + integration smoke must prove this.
- **Don't call `jwks-rsa.passportJwtSecret` from a NestJS Passport strategy.** Two strategy layers fighting Bun's SWC = the M1 regression vector. Skip Passport entirely.
- **Don't write the outbox row in a separate TX from the wallet mutation + transaction row.** Phase 2's whole point is same-TX.
- **Don't trust client-supplied `correlationId`.** Use the envelope's `correlationId` (validated by `parseEnvelope`); never read from request body.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWKS fetch + cache | Manual `fetch + setInterval + Map` | `jose.createRemoteJWKSet` | Built-in cooldown + Cache-Control respect + JWKS parsing + key rotation |
| JWT signature verify | `crypto.verify` against fetched RSA pubkey | `jose.jwtVerify(token, JWKS, opts)` | Audited; handles alg validation; rejects `alg:none`; supports JWE/JWS canon |
| Idempotent consumer | Re-implement inbox dedup in this service | `@IdempotentSubscribe` from `@crash/messaging-spine` | Phase 2 already implemented + tested + verified |
| Outbox publisher | Manual `INSERT outbox + setTimeout publish` | `OutboxRepository.add` + Phase 2 publisher | Phase 2 already implemented + tested + verified |
| AMQP topology assert | Manual `assertExchange` / `assertQueue` calls | `MessagingSpineModule.forRootAsync` topology block | Already wired in `app.module.ts` |
| Money arithmetic | bigint math by hand | `Money` VO from `@crash/shared-kernel` | Phase 1 deliverable; Dinero-backed; throws on negative/currency mismatch |
| zod-to-DTO bridge | Manual `BadRequestException` | `nestjs-zod` `ZodValidationPipe` | Single source of truth; auto OpenAPI |
| Property test runner | Manual sample loops | `fast-check.assert + fc.property` | 10k cases + automatic shrinking |

**Key insight:** Phase 3 is mostly composition. Phase 2 owns inbox/outbox/topology; Phase 1 owns Money/errors/branded IDs; only the *domain* of wallets (aggregates, repository, conditional UPDATE, JWT guard) is new code. The temptation to "polish" Phase 2 internals is real (especially around OI-1 and OI-3) — see §9 below for the surgical resolution that avoids feature-creep.

---

## Common Pitfalls

### Pitfall 1: Re-rolling the OI-3 workaround per-handler

**What goes wrong:** Each new handler ends up using raw SQL via `this.em.getConnection().execute()` because the decorator's TX doesn't see EM identity map mutations. As more handlers land, more raw SQL accumulates.

**Why it happens:** Phase 2's `@IdempotentSubscribe` calls `host.em.transactional(...)` but the handler isn't passed the `txEm`. Mutations to entities loaded via `host.em` outside the callback might bind to a different EM context.

**How to avoid:** Apply OI-3 resolution Option A (§9 below) — change `@IdempotentSubscribe` to inject the transactional EM into the handler signature. Then Wallet handlers can use the EM identity map naturally for the Transaction insert (not for the conditional UPDATE — that stays raw for race safety).

**Warning signs:** Two or more handlers in the same service using `getConnection().execute()` for what should be entity persistence.

### Pitfall 2: JWT `iss` claim mismatch between browser and backend (Docker)

**What goes wrong:** Frontend logs in via `http://localhost:8080/realms/crash-game`; backend container running inside Docker validates against `http://keycloak:8080/realms/crash-game`. JWT `iss` claim is whatever Keycloak issued; if backend expects a different value, validation fails with `iss mismatch`.

**Why it happens:** Keycloak's `iss` claim is set when the token is created, based on the hostname the browser used. Inside Docker, the backend reaches Keycloak via service name `keycloak`; outside, the browser uses `localhost`. Without explicit hostname config, the two diverge.

**How to avoid:** Set `KC_HOSTNAME=localhost` (or `KC_HOSTNAME_URL=http://localhost:8080`) on the Keycloak container in `docker-compose.yml`. This forces Keycloak to issue tokens with `iss: http://localhost:8080/realms/crash-game` regardless of the request path. Backend then has env `KEYCLOAK_ISSUER=http://localhost:8080/realms/crash-game` and the JWKS fetch uses Docker service URL (`http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs`) — the JWKS endpoint is fetch-only, hostname-independent. `iss` claim alignment is what matters. [CITED: keycloak.org/server/hostname]

**Warning signs:** All tokens 401 with `iss mismatch` immediately after smoke-test introduces Keycloak login.

### Pitfall 3: BigInt JSON serialization

**What goes wrong:** `JSON.stringify({ balance: 100000n })` throws `TypeError: Do not know how to serialize a BigInt`. AMQP envelope payload, REST response, Postgres NUMERIC return — all places where bigint touches JSON.

**Why it happens:** `BigInt` has no native JSON representation in the spec.

**How to avoid:** Phase 1's `MoneySnapshot = { amount: string, currency: string, scale: number }` already solves this. Every wire surface uses `Money.toSnapshot()` for outbound, `Money.fromSnapshot(...)` (via `parseMoneySnapshot`) for inbound. Phase 3's controller and AMQP handler must NEVER touch a `bigint` in JSON.

**Warning signs:** Test failure with "Do not know how to serialize a BigInt"; `pg` returning NUMERIC as `string` and code calling `Number(raw)` on it.

### Pitfall 4: Double-wrap envelope from Phase 2 (OI-1)

**What goes wrong:** Inside the handler, `envelope.payload.walletId` is undefined because the actual payload is at `envelope.payload.payload.walletId` (the decorator wraps the rawPayload again).

**Why it happens:** Phase 2's `idempotent-subscribe.decorator.ts:121-129` builds a synthetic envelope where `payload: rawPayload`, but the publisher already serialised the full envelope into the AMQP body (so `rawPayload` IS the original envelope, not the original payload). The synthetic envelope's `payload` field is itself an envelope.

**How to avoid:** §9 OI-1 resolution — fix at the decorator. `payload: (rawPayload as { payload: unknown }).payload`. Add a regression test in `tests/unit/idempotent-subscribe.test.ts` asserting that `envelope.payload` is the original payload field, not the wrapper.

**Warning signs:** First wallet handler implementation references `envelope.payload.payload.x` to access fields.

### Pitfall 5: Property test using fc.assert with async predicate without await

**What goes wrong:** Test passes locally (sync arbitraries) then breaks in CI where DB ops are async. fast-check shrinks for ages on misleading failures.

**Why it happens:** `fc.assert(fc.property(arb, predicate))` requires `fc.asyncProperty` when predicate is async, and the test function must `await` the assertion.

**How to avoid:** Use `await fc.assert(fc.asyncProperty(arb, async (ops) => { ... }))` and run the predicate against the **domain** `Wallet.debit/credit` methods (pure, sync, in-memory), NOT against the repository (avoids real DB load for 10k cases).

**Warning signs:** Property test takes >30s for 10k cases; flaky behaviour.

---

## Runtime State Inventory

> Phase 3 is a greenfield phase (no rename / refactor). Section omitted by design.

---

## Code Examples

### Provision wallet (idempotent POST /wallets)

```typescript
// application/use-cases/provision-wallet.ts
// Source: REQ-WALL-01 + ADR-005 (first-login provisioning)
import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { Money, PlayerId, WalletId } from "@crash/shared-kernel";
import { v4 as uuid } from "uuid";
import { env } from "../../config/defaults";
import { Wallet } from "../../domain/wallet.aggregate";

@Injectable()
export class ProvisionWalletUseCase {
  constructor(private readonly em: EntityManager, private readonly walletRepo: WalletRepository) {}

  async execute(playerId: PlayerId): Promise<{ created: boolean; wallet: Wallet }> {
    return this.em.transactional(async () => {
      const existing = await this.walletRepo.findByPlayerId(playerId);
      if (existing) return { created: false, wallet: existing };
      const wallet = Wallet.provision(
        WalletId(uuid()),
        playerId,
        Money.of(env.INITIAL_BALANCE_CENTS),
        new Date(),
      );
      await this.walletRepo.save(wallet);
      return { created: true, wallet };
    });
  }
}
```

### GET /wallets/me

```typescript
// presentation/controllers/wallets.controller.ts
@Controller("wallets")
@UseGuards(JwtGuard)
export class WalletsController {
  constructor(
    private readonly provision: ProvisionWalletUseCase,
    private readonly walletRepo: WalletRepository,
  ) {}

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    const { created, wallet } = await this.provision.execute(PlayerId(req.user.playerId));
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return WalletView.from(wallet);
  }

  @Get("me")
  async getMe(@Req() req: AuthenticatedRequest) {
    const wallet = await this.walletRepo.findByPlayerId(PlayerId(req.user.playerId));
    if (!wallet) throw new NotFoundException("WALLET_NOT_PROVISIONED");
    return WalletView.from(wallet);
  }
}
```

### DTOs via nestjs-zod

```typescript
// presentation/dtos/wallet-view.dto.ts
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { moneySnapshotSchema } from "@crash/contracts";

export const walletViewSchema = z.object({
  id: z.string().uuid(),
  playerId: z.string(),
  balance: moneySnapshotSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export class WalletViewDto extends createZodDto(walletViewSchema) {}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `passport-jwt` + `jwks-rsa` strategy class | `jose.createRemoteJWKSet` + `jwtVerify` in a plain `CanActivate` guard | jose 4.x (2022+) shipped `cacheMaxAge`; ecosystem moved away from Passport for simple JWT validation | Fewer deps; less decorator metadata (better with Bun's SWC) |
| `class-validator` DTOs | `nestjs-zod` + zod schemas | NestJS-zod 4 (2024+) | Single source of truth (DTO type = schema) |
| `BIGSERIAL` + `BIGINT` cents | unchanged | n/a | bigint cents is canon since 2010s for play money |
| `SELECT FOR UPDATE` + read-then-write | conditional `UPDATE ... WHERE balance_cents >= $1 RETURNING ...` | always-current pattern | One round-trip, atomic, no retry loop |

**Deprecated/outdated:**
- `nest-keycloak-connect` — heavy, opinionated, brings policy enforcement we don't need (we own only one realm, no resource-level RBAC in this phase). Not used.
- `dinero.js` v1 — superseded by v2 stable (March 2026). Project already on v2.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | jose's `createRemoteJWKSet` honours `Cache-Control: max-age` from Keycloak's JWKS endpoint while still respecting `cooldownDuration` lower bound | §6 JWKS guard | Slightly more JWKS calls than expected; not a correctness issue. Verified by github.com/panva/jose docs but cache interaction with Keycloak headers not retested in this session [CITED: github.com/panva/jose, https://github.com/panva/jose/discussions/394] |
| A2 | Keycloak 26.5's JWKS endpoint emits sensible `Cache-Control` headers | §6 | Same as A1. If not, fall back to fixed `cacheMaxAge: 600_000` |
| A3 | `KC_HOSTNAME=localhost` will not break in-Docker JWKS fetch (since JWKS fetch is by URL, not by hostname binding) | §6 + Pitfall 2 | If wrong, two-URL config required: `KEYCLOAK_ISSUER=http://localhost:8080/realms/crash-game` for iss check, `KEYCLOAK_JWKS_URI=http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs` for fetch. This is in fact what the implementation should already do — the two env vars are independent. [ASSUMED: confirmed by WebSearch but not retested in this session] |
| A4 | Phase 2's `OutboxRepository.add` works correctly when called from inside `@IdempotentSubscribe`'s `em.transactional` block (i.e., the outbox row is committed in the same TX as the inbox dedupe row) | §4 AMQP handler | If wrong, "wallet.debited" event could publish without a wallet mutation — split-brain. **Mitigation:** Phase 2 integration tests `outbox-write-and-publish.test.ts` PASS for exactly this scenario, so confidence is HIGH. Verified via VERIFICATION.md SC#1 |
| A5 | OI-3 Option A (propagate `txEm` to handler signature) is safe to implement in Phase 3 without breaking Phase 2 integration tests | §9 OI-3 | If wrong, Phase 2 tests break and we revert to Option B (consistent raw SQL). Phase 2 tests are well-isolated, blast radius bounded. [ASSUMED] |
| A6 | Bustabit-canon HMAC formula is irrelevant to Wallet (Phase 3) — it's Phase 4's concern | (omitted) | None — Wallet doesn't compute crash points |

---

## Open Questions

1. **Does the planner introduce ADR-013?**
   - What we know: ROADMAP anticipates two ADRs for Phase 3 (Ledger model + JWKS validation). Phase 2 OI-3 resolution (decorator change) likely surfaces a third — "Decorator-injected `txEm` in `@IdempotentSubscribe`".
   - What's unclear: Whether OI-3 deserves its own ADR or rides in ADR-011 (Ledger model).
   - Recommendation: Plan a third ADR (ADR-013: `@IdempotentSubscribe` propagates txEm). It's a public-API change to the spine and the rationale (EM identity-map flush correctness) is worth its own short document.

2. **Should the `wallets` table embed `last_correlation_id` for replay safety beyond inbox?**
   - What we know: Inbox dedup is the primary safety net (REQ-WALL-05, Phase 2 done). It uses `consumer_name + message_id` UNIQUE.
   - What's unclear: Whether to also stamp `last_correlation_id` on the wallet row as defence in depth.
   - Recommendation: NO. The Transaction table already records `correlation_id` per row, plus a UNIQUE constraint on `(message_id)` in the Transaction table serves as a final safety net. Adding state to Wallet violates "Wallet is just a balance snapshot". Documented in ADR-011.

3. **Does Wallet need a `version` column for optimistic locking?**
   - What we know: Atomic UPDATE makes optimistic locking redundant for balance mutation.
   - What's unclear: Whether REST-side concurrent provision attempts (two browser tabs hitting POST /wallets simultaneously) need a version check.
   - Recommendation: NO. Use a `UNIQUE (player_id)` constraint on `wallets`. Second concurrent insert fails with `unique_violation`; provision usecase catches and returns the existing wallet. Simpler than version columns.

4. **What's the exact error response shape for `WALLET_NOT_PROVISIONED` on `/wallets/me`?**
   - What we know: HTTP semantics suggest 404.
   - What's unclear: NestJS exception filter mapping to a typed response body.
   - Recommendation: Standard NestJS `NotFoundException`, with a global `ExceptionFilter` that maps to `{ code: "WALLET_NOT_PROVISIONED", message: "Wallet not provisioned for player; call POST /wallets first." }`. Add to follow-up if needed; not Phase 3 blocking.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | Wallet + Transaction tables | ✓ | 18 (Phase 1 docker-compose) | — |
| RabbitMQ | wallet.commands queue (Phase 2 already declared) | ✓ | 4.2 | — |
| Keycloak | JWKS + token issuance | ✓ | 26.5 (running, realm imported, demo user present) | — |
| Kong | Route to wallets:4002 (already configured) | ✓ | 3.9 | — |
| Bun | Runtime + test runner | ✓ | 1.3.11 | — |
| `jose` | JWKS validation | ✗ (not yet installed) | 6.2.3 (registry) | None — must install |
| `nestjs-zod` | DTO + pipe | ✗ (not yet installed) | 5.4.0 (registry) | None — must install |
| `fast-check` | Property tests | ✗ in wallets devDeps (present in shared-kernel) | 4.8.0 | None — install as dev dep |
| `uuid` (or `crypto.randomUUID()`) | WalletId generation | Built into Bun | n/a | Use `crypto.randomUUID()` natively |

**Missing dependencies with no fallback:** none (all installable).
**Missing dependencies with fallback:** none.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (already used by Phases 1+2) + `fast-check` 4.x for property |
| Config file | none (Bun built-in) |
| Quick run command | `cd services/wallets && bun test tests/unit` |
| Full suite command | `cd services/wallets && bun test` (all) + `INTEGRATION=1 bun test tests/integration` |
| Phase gate | All suites + smoke-health 25/25 + Kong probe + Keycloak token probe + provision + GET /wallets/me + property test 10k cases green |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-DOM-03 (balance >= 0) | `Wallet.debit` throws `NegativeMoneyError` when amount > balance | unit | `bun test tests/unit/wallet.aggregate.test.ts` | ❌ Wave 0 |
| REQ-DOM-03 (precision) | `Money` arithmetic round-trips via `toSnapshot` | unit (already exists in shared-kernel) | n/a | ✅ Phase 1 |
| REQ-DOM-03 (property: zero-net) | 10k random zero-net debit/credit sequences return to original balance | property | `bun test tests/property/wallet-zero-net.test.ts` | ❌ Wave 0 |
| REQ-AUTH-04 (JWKS) | Invalid bearer → 401; expired → 401; valid → 200; `iss` mismatch → 401; `aud` mismatch → 401 | integration | `INTEGRATION=1 bun test tests/integration/jwt-guard.test.ts` | ❌ Wave 0 |
| REQ-WALL-01 (idempotent provision) | First POST /wallets → 201 Created + balance=1000.00; second POST /wallets → 200 OK + same wallet | integration | `INTEGRATION=1 bun test tests/integration/provision-wallet.test.ts` | ❌ Wave 0 |
| REQ-WALL-02 (GET /wallets/me) | Returns serialized money snapshot + metadata; 404 if not provisioned | integration | included above | ❌ Wave 0 |
| REQ-WALL-03 (initial balance from env) | `INITIAL_BALANCE_CENTS=100000` → balance.toString() === "1000.00 CRD" | unit | `bun test tests/unit/provision-wallet.test.ts` | ❌ Wave 0 |
| REQ-WALL-04 (no REST mutation) | Kong has no debit/credit route; integration smoke confirms 404 on PATCH/DELETE/POST mutation paths | integration + smoke | `bash scripts/smoke-health.sh` (add 3 probes) | ❌ Wave 0 |
| REQ-WALL-04 (AMQP debit happy) | Publish `wallet.debit` for 500.00 → balance becomes 500.00 + Transaction row + `wallet.debited` outbox row | integration | `INTEGRATION=1 bun test tests/integration/wallet-debit.test.ts` | ❌ Wave 0 |
| REQ-WALL-04 (AMQP debit reject) | Publish `wallet.debit` for 2000.00 against 1000.00 wallet → balance unchanged + `wallet.debit.rejected{reason:INSUFFICIENT_FUNDS}` outbox row + Postgres CHECK fires if conditional UPDATE fails | integration | `INTEGRATION=1 bun test tests/integration/wallet-debit-rejected.test.ts` | ❌ Wave 0 |
| REQ-WALL-07 (immutable transaction) | Every successful debit/credit produces exactly one Transaction row referencing correlationId | integration | included in wallet-debit.test.ts assertions | ❌ Wave 0 |
| REQ-WALL-05 (inbox replay no-op, end-to-end) | Publishing `wallet.debit` with same messageId twice → second is dedupe-skipped; Transaction count = 1 | integration | `INTEGRATION=1 bun test tests/integration/inbox-replay.test.ts` | ❌ Wave 0 |
| ROADMAP SC#5 (property test 10k zero-net) | fast-check 10k cases | property | included in wallet-zero-net.test.ts | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd services/wallets && bun test tests/unit` (~ <2 s).
- **Per wave merge:** unit + property + integration: `cd services/wallets && bun test && INTEGRATION=1 bun test tests/integration`.
- **Phase gate:** full suite + extended `scripts/smoke-health.sh` (Phase 2's 22 + 3 new Phase 3 probes: Keycloak token, POST /wallets idempotent, GET /wallets/me) all green; manual `curl` walkthrough demonstrating debit/reject/transaction via RabbitMQ management UI publish.

### Wave 0 Gaps

- [ ] `services/wallets/tests/unit/wallet.aggregate.test.ts` — covers REQ-DOM-03 (balance + precision unit assertions)
- [ ] `services/wallets/tests/unit/provision-wallet.test.ts` — covers REQ-WALL-03 + REQ-WALL-01 unit
- [ ] `services/wallets/tests/property/wallet-zero-net.test.ts` — covers ROADMAP SC#5 (10k cases)
- [ ] `services/wallets/tests/integration/jwt-guard.test.ts` — covers REQ-AUTH-04
- [ ] `services/wallets/tests/integration/provision-wallet.test.ts` — covers REQ-WALL-01 + REQ-WALL-02
- [ ] `services/wallets/tests/integration/wallet-debit.test.ts` — covers REQ-WALL-04 (happy) + REQ-WALL-07
- [ ] `services/wallets/tests/integration/wallet-debit-rejected.test.ts` — covers REQ-WALL-04 (insufficient + CHECK)
- [ ] `services/wallets/tests/integration/inbox-replay.test.ts` — covers REQ-WALL-05 end-to-end
- [ ] `services/wallets/tests/conftest.ts` (or equivalent setup) — shared MikroORM EntityManager + testcontainers if needed (can reuse Phase 2's pattern in `packages/messaging-spine/tests/integration/`)
- [ ] Smoke-health probes 23-25 added to `scripts/smoke-health.sh`
- [ ] Framework: `fast-check` install in services/wallets devDeps

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Keycloak OIDC + PKCE (Phase 6 frontend side); each service validates JWT via cached JWKS (this phase) |
| V3 Session Management | partial | JWT-based stateless; refresh token rotation in Phase 6 |
| V4 Access Control | yes | `JwtGuard` enforces presence of valid token on `POST /wallets` + `GET /wallets/me`; `req.user.playerId` from `sub` claim is the only identity allowed to mutate that player's wallet (saga design — Game emits `wallet.debit` carrying `playerId`, Wallet trusts the broker channel) |
| V5 Input Validation | yes | zod schemas in `nestjs-zod` for HTTP DTOs; `parseEnvelope` for AMQP envelope (already in spine); `Money.fromSnapshot` throws on invalid |
| V6 Cryptography | yes | JWT signature via `jose.jwtVerify` against JWKS; no hand-rolled crypto |
| V7 Error Handling & Logging | yes | NestJS exception filter maps domain errors → typed HTTP responses; `nestjs-pino` (Phase 10 hardens, but base config OK) |
| V8 Data Protection | partial | No PII in wallet rows except `player_id` (Keycloak sub UUID). No card data, no real money. |
| V11 Business Logic | yes | Atomic UPDATE + Postgres CHECK constraint enforces "balance never negative" — primary defence; conditional WHERE blocks the race; CHECK is fail-closed safety net |
| V13 API & Web Services | yes | REST surface is read+idempotent-create only; mutations isolated to AMQP per broker trust model (ARCH §11) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Insufficient funds bypass via race condition (two concurrent debits) | Tampering | Atomic conditional UPDATE; CHECK constraint as backstop |
| Unauthorized debit via forged JWT | Spoofing | `jose.jwtVerify` against Keycloak JWKS; `iss` + `aud` claim validation |
| Replay attack via duplicate AMQP message | Tampering | Phase 2's inbox dedupe (already verified) |
| `iss` claim forgery via different Keycloak instance | Spoofing | Explicit `KEYCLOAK_ISSUER` env var validated in `jwtVerify({issuer})` |
| Wallet provisioning DoS (spam POST /wallets to create many wallets) | DoS | `UNIQUE (player_id)` constraint — second provision is a no-op DB-level; `JwtGuard` first ensures known player; rate limit at Kong is Phase 10 polish, not blocking |
| BigInt JSON serialization side-channel | Information Disclosure | All money on the wire is `MoneySnapshot { amount: string }` — never raw bigint |
| Stale JWKS cache after Keycloak key rotation | Spoofing window | `jose.createRemoteJWKSet` respects `Cache-Control` from Keycloak; ~10 min ceiling |

---

## Decisions to Make in Phase 3 (ADRs)

| ADR | Title | Decision | Notes |
|-----|-------|----------|-------|
| **ADR-011** | Ledger model: Wallet snapshot + immutable Transaction over event sourcing | Wallet keeps a maintained `balance_cents` snapshot column. Each debit/credit also writes an immutable Transaction row referencing `correlationId`. Both rows write in the same DB TX. No event sourcing — `balance` is mutable. | Alternatives rejected: full ES (overkill for 5-day challenge; rebuilding state from events on every read kills hot paths); transaction-only without snapshot (forces aggregation on every read). |
| **ADR-012** | JWT validation at each service via cached JWKS (over Kong JWT plugin) | Each NestJS service holds a `jose.createRemoteJWKSet` cache; `JwtGuard` validates per-request. Kong stays a pure declarative router. | Alternatives rejected: Kong JWT plugin (would need DB mode or external plugin server — operational hassle for play money); `passport-jwt + jwks-rsa` (more deps, more decorator metadata fighting Bun SWC). |
| **ADR-013** | `@IdempotentSubscribe` injects transactional EM into handler signature | Spine decorator passes the TX-scoped EM into the wrapped handler as a third arg, so handlers can use entity persistence naturally. Wallet `WalletDebitHandler.handle(envelope, msg, txEm)`. | Resolves Phase 2 OI-3. Public-API change to spine. Alternative rejected: every handler uses raw SQL exclusively (the current Phase 2 workaround) — works but inverts the DDD ergonomics MikroORM was chosen for. |

---

## OI-1 / OI-3 Resolution Recommendation

### OI-1: Envelope double-wrap

**Recommendation:** Fix at the spine decorator, not in handler convention.

**Why:** Handler convention (write `envelope.payload.payload.x` everywhere) propagates the bug across every future handler — anti-DRY and violates the spine's job of being a transparent transport.

**Surgical fix:**

```typescript
// packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts
// Current line 121-129:
const envelope = {
  messageId: meta.messageId,
  correlationId: meta.correlationId,
  causationId: meta.causationId,
  type: meta.type,
  version: meta.version,
  occurredAt: meta.occurredAt,
  payload: rawPayload,   // BUG: rawPayload is itself the parsed envelope from amqp, so .payload is nested
};

// Fix:
const wirePayload = (rawPayload && typeof rawPayload === "object" && "payload" in rawPayload)
  ? (rawPayload as { payload: unknown }).payload
  : rawPayload;
const envelope = { ...meta, payload: wirePayload };
```

**Regression test:** `packages/messaging-spine/tests/unit/idempotent-subscribe.test.ts` — assert that when a Phase 2 publisher emits `buildEnvelope({ payload: { walletId: "abc" } })` and the consumer's handler is decorated with `@IdempotentSubscribe`, the handler sees `envelope.payload.walletId === "abc"` (one hop, not two).

**Blast radius:** Phase 2 integration tests must re-run. If they were testing through the double-wrap (accessing `envelope.payload.payload`), they need a one-line update to remove the extra hop.

### OI-3: EM identity-map flush in decorator TX

**Recommendation:** **Option A — propagate `txEm` to handler signature.**

| Option | Description | Pros | Cons | Verdict |
|--------|-------------|------|------|---------|
| **A. Propagate txEm** | Decorator calls `host.em.transactional(async (txEm) => { ... await original.call(host, envelope, msg, txEm); ... })`; handler signature is `handle(envelope, msg, txEm)` | Handlers use EM identity map naturally; aligns with MikroORM 7 ergonomics; uniform across the codebase | Public-API change to spine; Phase 2 tests that assumed the 2-arg signature must update | **CHOSEN** |
| B. Raw SQL convention | Document that all handlers MUST use `this.em.getConnection().execute()`; no entity persistence in handlers | No spine change; uniform pattern | Throws away MikroORM's DDD-ergonomic value; every entity write needs hand-written SQL | Rejected — defeats ADR-001 |
| C. Internal repo flush | Repositories internally call `em.flush()` after each persist inside the decorator TX | Hides the issue from handlers | `em.flush()` mid-TX is a footgun; can interact badly with `confirmSelect` ordering | Rejected — leaky abstraction |

**Implementation sketch for Option A:**

```typescript
// In idempotent-subscribe.decorator.ts:
await host.em.transactional(async (txEm) => {
  const claimed = await host.inbox.tryClaim(opts.consumerName, meta.messageId, meta.type);
  if (!claimed) return;
  // ...
  await original.call(host, envelope, msg, txEm); // <-- pass txEm
  await host.inbox.markProcessed(opts.consumerName, meta.messageId);
});

// Handler signature (Wallet handler):
async handle(envelope: WalletDebitEnvelope, msg: ConsumeMessage, txEm: EntityManager): Promise<void> {
  // Use txEm for entity persistence
  txEm.persist(transactionEntity);
}
```

**Blast radius:** Spine decorator + WalletDebitHandler + WalletCreditHandler + any future handler. Phase 2 already has 4 integration tests using `@IdempotentSubscribe`; they need signature updates. Manageable.

---

## REST Endpoints + DTOs

```typescript
// presentation/dtos/provision-wallet.dto.ts
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const provisionWalletRequestSchema = z.object({}).strict(); // empty body
export class ProvisionWalletRequestDto extends createZodDto(provisionWalletRequestSchema) {}

// presentation/dtos/wallet-view.dto.ts
import { moneySnapshotSchema } from "@crash/contracts";

export const walletViewSchema = z.object({
  id: z.string().uuid(),
  playerId: z.string(),
  balance: moneySnapshotSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export class WalletViewDto extends createZodDto(walletViewSchema) {}

// presentation/controllers/wallets.controller.ts (final shape)
@Controller("wallets")
@UseGuards(JwtGuard)
@UsePipes(ZodValidationPipe)
export class WalletsController {
  constructor(
    private readonly provision: ProvisionWalletUseCase,
    private readonly walletRepo: WalletRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK) // override per branch via @Res passthrough
  async create(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<WalletViewDto> {
    const { created, wallet } = await this.provision.execute(PlayerId(req.user.playerId));
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return WalletView.from(wallet);
  }

  @Get("me")
  async getMe(@Req() req: AuthenticatedRequest): Promise<WalletViewDto> {
    const wallet = await this.walletRepo.findByPlayerId(PlayerId(req.user.playerId));
    if (!wallet) throw new NotFoundException({ code: "WALLET_NOT_PROVISIONED" });
    return WalletView.from(wallet);
  }
}
```

---

## JWKS Guard (definitive shape)

**Library:** `jose` 6.2.3.

**Cache strategy:** `cacheMaxAge: 600_000ms` (10 min upper bound), `cooldownDuration: 30_000ms` (30s lower bound between fetches). jose honours Keycloak's `Cache-Control: max-age` header within these bounds.

**iss alignment:** Set `KC_HOSTNAME=localhost` in docker-compose.yml so Keycloak issues tokens with `iss: http://localhost:8080/realms/crash-game` regardless of source. Two env vars in wallets/games:
- `KEYCLOAK_ISSUER=http://localhost:8080/realms/crash-game` (for `iss` claim check inside backend container)
- `KEYCLOAK_JWKS_URI=http://keycloak:8080/realms/crash-game/protocol/openid-connect/certs` (for actual JWKS fetch — uses Docker service name)

Both env vars added to `services/wallets/src/config/defaults.ts` AND `services/games/src/config/defaults.ts` (because Phase 6 will reuse this guard in games-service).

**Audience:** `KEYCLOAK_AUDIENCE=crash-game-client`. NOTE: Keycloak emits `aud` as the client ID only for confidential clients by default. For public PKCE clients (`crash-game-client` in realm-export.json IS `publicClient: true`), the `aud` claim may not contain the client ID — it commonly contains the resource server name. The realm export currently has no audience mapper. **Action item for plan:** add an audience mapper to `realm-export.json` (`"protocolMappers"`) or set the `KEYCLOAK_AUDIENCE` to `"account"` (Keycloak's default audience for player tokens). Decide during plan / discuss. [ASSUMED — needs verification during execution]

---

## Kong + Smoke Test Additions

**Kong route map — currently exposes everything under `/wallets/*` to wallets:4002.** This is permissive: Kong forwards mutation-shape paths like `POST /wallets/me/debit` to the service. Service rejects with 404 (no such controller), but the recruiter would call that a soft signal.

**Hardening recommendation (optional but cheap):** Tighten Kong to only allow `POST /wallets` and `GET /wallets/me`:

```yaml
# docker/kong/kong.yml
services:
  - name: wallets-service
    url: http://wallets:4002
    routes:
      - name: wallets-provision
        paths:
          - /wallets
        methods: [POST]
        strip_path: true
      - name: wallets-me
        paths:
          - /wallets/me
        methods: [GET]
        strip_path: true
```

Any other method/path on `/wallets/*` returns 404 from Kong, before touching the service. This is the canon way to enforce REQ-WALL-04 at the gateway level.

**Smoke-health.sh additions (probes 23, 24, 25):**

```bash
# 23: Keycloak password grant token (already exists for games — extend for wallets too)
TOKEN=$(curl -s ... password grant)

# 24: POST /wallets idempotent provisioning
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8000/wallets)
[[ "$HTTP" == "201" || "$HTTP" == "200" ]] || fail
HTTP2=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8000/wallets)
[[ "$HTTP2" == "200" ]] || fail "second call should be 200 not 201"

# 25: GET /wallets/me returns 1000.00 CRD
BALANCE=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/wallets/me | jq -r '.balance.amount')
[[ "$BALANCE" == "100000" ]] || fail

# 26 (optional): mutation path blocked at Kong
HTTP_MUT=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8000/wallets/me/debit)
[[ "$HTTP_MUT" == "404" ]] || fail "mutation path should 404 at Kong"
```

---

## Property Test Design

**Goal:** Prove that any sequence of credits/debits with a zero net sum returns the wallet to its starting balance. 10k cases.

**Arbitrary design:**

```typescript
// tests/property/wallet-zero-net.test.ts
import * as fc from "fast-check";
import { Money } from "@crash/shared-kernel";

const opAmountCents = fc.bigInt({ min: 1n, max: 1_000_000n }); // 0.01 to 10000.00

const zeroNetSequenceArb = fc
  .array(fc.tuple(fc.constantFrom("DEBIT", "CREDIT"), opAmountCents), { minLength: 0, maxLength: 100 })
  .map((ops) => {
    // Compute total debit vs credit; append an inverse op to zero the net.
    const netCents = ops.reduce(
      (n, [k, v]) => n + (k === "DEBIT" ? -v : v),
      0n,
    );
    const balancer: [string, bigint] = netCents < 0n
      ? ["CREDIT", -netCents]
      : ["DEBIT", netCents];
    return [...ops, balancer];
  });

test("zero-net sequence of credits/debits returns wallet to original balance", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.bigInt({ min: 1_000_000n, max: 1_000_000_000n }), // initial balance 10k to 10M cents
      zeroNetSequenceArb,
      async (initialCents, ops) => {
        let wallet = makeWallet(Money.of(initialCents));
        for (const [kind, amt] of ops) {
          if (kind === "DEBIT") {
            // Skip if would go negative — Money.subtract throws
            if (wallet.balance.toCents() < amt) {
              // pad with a credit first
              wallet = wallet.credit(Money.of(amt), correlationId(), new Date()).next;
            }
            wallet = wallet.debit(Money.of(amt), correlationId(), new Date()).next;
          } else {
            wallet = wallet.credit(Money.of(amt), correlationId(), new Date()).next;
          }
        }
        expect(wallet.balance.toCents()).toBe(initialCents);
      },
    ),
    { numRuns: 10_000 },
  );
});
```

Notes:
- Predicate runs against **pure-domain** Wallet (no DB) so 10k cases execute in <30s. The atomic UPDATE path is covered separately by integration tests.
- Guard against negative-intermediate-balance by padding with a credit when needed (this preserves the zero-net property because we only added a credit; the balancer at the end accounts for it).
- `correlationId()` is a helper that returns a fresh branded ID per op.

---

## Order of Execution (suggested plan-list)

> The planner will turn this into formal PLAN.md task IDs. Granularity is `standard`, parallelization is on.

| # | Plan | Depends on | Parallelizable? |
|---|------|-----------|-----------------|
| P3.1 | Domain layer: `Wallet` + `Transaction` aggregates, errors, repository interfaces, unit tests | — | with P3.2, P3.3 |
| P3.2 | Persistence: `wallet.entity.ts` + `transaction.entity.ts` (EntitySchema), MikroORM migrations (`wallets` with CHECK, `transactions` with UNIQUE (message_id) + FK), update `mikro-orm.config.ts` entities list | P3.1 (interfaces) | with P3.3 |
| P3.3 | OI-1 + OI-3 fix in `@crash/messaging-spine` — patch `idempotent-subscribe.decorator.ts` for envelope unwrap + txEm propagation; update Phase 2 unit tests; bump spine version | — | with P3.1, P3.2 |
| P3.4 | JWT guard: install `jose`, add `KEYCLOAK_ISSUER` + `KEYCLOAK_JWKS_URI` + `KEYCLOAK_AUDIENCE` to `defaults.ts`, set `KC_HOSTNAME=localhost` in docker-compose, write `JwtGuard`, unit tests | — | with P3.1, P3.2, P3.3 |
| P3.5 | REST: install `nestjs-zod`, write DTOs, write `WalletsController`, write `ProvisionWalletUseCase`, controller integration tests | P3.1, P3.2, P3.4 | — |
| P3.6 | AMQP handlers: `WalletDebitHandler` + `WalletCreditHandler` using `@IdempotentSubscribe` (post P3.3 patch), `WalletRepository.applyDebitAtomically/applyCreditAtomically` via raw SQL, outbox event emission | P3.1, P3.2, P3.3 | with P3.5 |
| P3.7 | Property test (`tests/property/wallet-zero-net.test.ts`) + 10k cases + CI integration | P3.1 | with P3.5, P3.6 |
| P3.8 | Integration tests (`provision-wallet`, `jwt-guard`, `wallet-debit`, `wallet-debit-rejected`, `inbox-replay`) | P3.5, P3.6 | — |
| P3.9 | Smoke-health additions (probes 23-25, optional 26 for Kong mutation block) + Kong route tightening | P3.5 | with P3.8 |
| P3.10 | ADRs (011, 012, 013), STATE + ROADMAP + REQUIREMENTS traceability updates, phase closeout | All | — |

**Parallelization windows:**
- P3.1 ⫼ P3.2 ⫼ P3.3 ⫼ P3.4 (Wave 1: domain + persistence + spine fix + auth guard — independent surfaces).
- P3.5 ⫼ P3.6 ⫼ P3.7 (Wave 2: REST, AMQP, property test, all consume Wave 1).
- P3.8 ⫼ P3.9 (Wave 3: integration tests + smoke + Kong).
- P3.10 (Wave 4: closeout, serial).

---

## Phase 3 Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | Spine patch (OI-1 + OI-3) breaks Phase 2 integration tests | MEDIUM | Run Phase 2 `INTEGRATION=1 bun test` in spine package immediately after the patch; update test assertions if double-wrap was being relied upon |
| R2 | Keycloak `iss`/`aud` mismatch between browser and backend container | MEDIUM | Set `KC_HOSTNAME=localhost`; document the dual-env-var pattern; smoke-test the password-grant token round-trip in Wave 3 |
| R3 | Conditional UPDATE returns no rows for a reason other than insufficient funds (e.g., wallet doesn't exist) | LOW | First check via `findByPlayerId` and throw `WALLET_NOT_PROVISIONED` before attempting the conditional UPDATE; OR include `WHERE player_id = ?` in the UPDATE and check rowcount + a follow-up SELECT |
| R4 | `aud` claim absent from public-PKCE tokens by default | MEDIUM | Either add an audience mapper to the realm-export.json OR loosen `audience` check to `"account"` (Keycloak's default). Decide during planning |
| R5 | Property test 10k cases time out under CI load | LOW | Run pure-domain (no DB) — should finish under 10s; if CI is slow, scope down to 5k for CI and run 10k in nightly |
| R6 | `fast-check` 4.x has breaking API changes from 3.x (STACK §3 listed `^3.x`) | LOW | Phase 1's existing property tests use fast-check; quickly verify compat before installing 4.x — fall back to 3.x if anything breaks |
| R7 | Double-bet between Game and Wallet because of envelope causationId not propagating | LOW | Phase 2's `MessagingClsModule` + `parseEnvelope` already enforce causation chain. Phase 3 just consumes — no new vector |
| R8 | UNIQUE (player_id) constraint conflict on concurrent provisioning | LOW | Use INSERT ... ON CONFLICT DO NOTHING RETURNING + fallback SELECT, OR catch the unique_violation in the usecase and retry the read path |

---

## Sources

### Primary (HIGH confidence)

- [github.com/panva/jose — createRemoteJWKSet docs](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md) — cache + cooldown semantics
- [github.com/panva/jose — CHANGELOG](https://github.com/panva/jose/blob/main/CHANGELOG.md) — cacheMaxAge added in v4; v6 current
- [panva/jose discussion #394 — cache TTL](https://github.com/panva/jose/discussions/394)
- [MikroORM v7 release notes](https://mikro-orm.io/blog/mikro-orm-7-released) — atomic update + raw() helper
- [MikroORM Entity Manager docs](https://mikro-orm.io/docs/entity-manager) — transactional + getConnection
- [Keycloak hostname v2 docs](https://www.keycloak.org/server/hostname) — frontendUrl + iss claim
- [RabbitMQ Quorum Queues docs](https://www.rabbitmq.com/docs/quorum-queues) — Phase 2 reference
- [Phase 2 VERIFICATION.md](../02-outbox-inbox-spine/VERIFICATION.md) — OI-1..OI-5 with reproduced evidence
- [.planning/research/ARCHITECTURE.md](../../research/ARCHITECTURE.md) §2.2 + §3.1 + §11 — Wallet bounded context, sagas
- [.planning/research/PITFALLS.md](../../research/PITFALLS.md) C1, C4, C5, H3, H4 — money + outbox + DDD purity + WS-auth + token expiry
- [.planning/research/STACK.md](../../research/STACK.md) §2.1, §2.2, §2.6, §3 — ORM + money + zod + version matrix

### Secondary (MEDIUM confidence)

- [Skycloak NestJS+Keycloak guide](https://skycloak.io/blog/keycloak-nestjs-authentication-guide/) — passport-jwt baseline alternative
- [itnext Keycloak+NestJS article](https://itnext.io/protecting-your-nestjs-api-with-keycloak-8236e0998233)
- [WorkOS JWKS guide](https://workos.com/blog/developers-guide-jwks)
- [MikroORM issue #3657](https://github.com/mikro-orm/mikro-orm/issues/3657) — atomic update support
- [fast-check official guide](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-bun-test-runner/)

### Tertiary (LOW confidence)

- [DEV community auth guard guide](https://dev.to/faidterence/implementing-an-auth-guard-with-jwt-tokens-in-nestjs-3o95) — pattern reference, not authoritative
- WebSearch results on cross-domain crypto wallet testing (filtered out — domain mismatch)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all three new deps verified on npm registry today; Phase 1+2 stack already proves Bun/NestJS/MikroORM viability
- Architecture: HIGH — ledger pattern is canon; AMQP wiring follows Phase 2 exactly; REST surface is two endpoints
- Pitfalls: HIGH for money/atomic-update/JWT; MEDIUM for Keycloak iss/aud alignment (requires execution-time verification)
- OI-1/OI-3 resolutions: MEDIUM-HIGH — surgical patches with clear blast radius; small chance Phase 2 test assertions need updating
- JWKS guard: HIGH on jose mechanics; MEDIUM on audience claim shape (needs realm-export inspection at execution)

**Research date:** 2026-05-25
**Valid until:** 2026-06-25 (30 days; stack is stable, no active library churn except jose patches)
