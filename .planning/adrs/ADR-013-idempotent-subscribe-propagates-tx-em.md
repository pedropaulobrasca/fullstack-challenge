# ADR-013: `@IdempotentSubscribe` propagates `txEm` to the handler signature

**Status**: Accepted
**Date**: 2026-05-25
**Phase**: 3

## Context

Phase 2's verification (OI-3 carry-forward, documented in 02-09 SUMMARY and re-stated in 03-RESEARCH §"OI-1 / OI-3 Resolution Recommendation") surfaced a subtle but consequential bug in the `@IdempotentSubscribe` decorator: `host.em.transactional(async (txEm) => { ... })` correctly opened a Postgres transaction and wrote the inbox dedupe row inside it — but it never passed the inner `txEm` to the wrapped handler. The handler signature was `(envelope, msg)` and used `this.em` (the request-scoped root EM, fork-of-pool, distinct from `txEm`) for any entity mutation.

The net effect: entity persistence inside the handler executed against a different `EntityManager` context than the transaction the decorator had opened. MikroORM's Identity Map is per-EM, so `txEm.persist(entity)` and `this.em.persist(entity)` write to different unit-of-work queues, and `this.em.flush()` issues SQL on a different connection from the one carrying the inbox dedupe row's `BEGIN`. Phase 2's integration test suite (`packages/messaging-spine/tests/integration/`, 6 scenarios) was green only because every probe used raw SQL or the root EM directly — none of them attempted the realistic "handler mutates an entity via ORM" pattern that Phase 3's wallet debit/credit handlers required.

Phase 3 hit this immediately. Plan 03-06's `WalletDebitHandler` needs three writes — `wallets` UPDATE, `transactions` INSERT, `outbox` row — to land in the same Postgres TX as the inbox dedupe row that the decorator already wrote. Without `txEm` reaching the handler, the only options were (a) drop down to raw SQL inside every handler and bypass the ORM (defeats ADR-001's MikroORM choice), (b) flush mid-TX via `this.em.flush()` (a footgun — partial flush on a different connection is the standard "outbox written outside the side-effect TX" anti-pattern that ADR-007 / ADR-008 / ADR-010 spent four ADRs preventing), or (c) change the decorator to propagate `txEm`.

A related, smaller bug — OI-1, the envelope double-wrap — rode in on the same fix: the decorator passed the *whole* AMQP body to the handler rather than peeling the inner `payload` field when the body itself was an envelope. Handlers were doing `envelope.payload.payload.walletId` to reach what should be `envelope.payload.walletId`. Both bugs are decorator-boundary contract issues; one decorator patch closes both, plus the related W3 gap in `OutboxRepository.add`.

Three resolution shapes were on the table.

## Considered

- **Option A — propagate `txEm` to the handler signature (chosen)** — Decorator changes the wrapped function signature from `(envelope, msg)` to `(envelope, msg, txEm)`. Handler accepts and uses `txEm` for every entity mutation and outbox insert. The Identity Map fully participates: `txEm.persist(entity)` queues on the correct unit-of-work, flush hits the correct connection, the TX commits atomically across inbox dedupe + entity mutation + outbox row. Public API change to the spine (existing handlers ignore the third arg by JS semantics, so backwards-compatible at call time, but documented contract changes from 2-arg to 3-arg). Two-line decorator patch.
- **Option B — mandate raw SQL in every handler** — Handlers do `em.getConnection().execute(sql, ...)` for every write. Sidesteps the Identity Map problem because raw SQL doesn't care which EM owns the unit of work — it cares which connection carries the open BEGIN. Costs: defeats ADR-001's MikroORM Data-Mapper benefit (entities exist but nobody persists them); the wallets repository would devolve to a SQL-string assembly layer; the Phase 4 saga state and Phase 5 game aggregates would have to follow the same pattern; the property test (Plan 03-08) couldn't exercise the pure-domain `Wallet.debit/credit` predicate because there'd be no persistence path from the predicate to the DB without manual SQL.
- **Option C — internal `em.flush` mid-TX inside the handler** — Handler calls `await this.em.flush()` after persisting entities, trusting MikroORM to do the right thing. Fails: `this.em.flush()` issues SQL on the request-scoped EM's connection, NOT the one carrying the decorator's open `BEGIN`. The flush either commits to a different connection (silent data loss when the outer TX rolls back) or deadlocks (two connections holding row-level locks on the same wallet row). Even when it appears to work, the outbox row written by `OutboxRepository.add(env, route)` (no third arg) lands outside the side-effect TX — recreating the *exact* dual-write bug Phase 2 was built to prevent. Anti-pattern, documented across every outbox-pattern writeup reviewed in 02-RESEARCH §Pattern 3.

## Decision

**Option A — `@IdempotentSubscribe` propagates `txEm` to the wrapped handler as the third positional argument.** `OutboxRepository.add(envelope, route, em?: EntityManager)` accepts an optional third positional argument for the same TX-context threading on the publisher side.

Decorator patch (Plan 03-01 commit `ff110d5`, file `packages/messaging-spine/src/inbox/idempotent-subscribe.decorator.ts`):

```ts
await host.em.transactional(async (txEm) => {
  const claim = await host.inbox.tryClaim(consumerName, envelope.messageId, txEm);
  if (!claim.claimed) return;
  await original.call(host, envelope, msg, txEm); // <-- third arg added
});
```

Envelope unwrap (same commit, OI-1):

```ts
const rawPayload = decodeAmqpBody(msg);
const wirePayload =
  typeof rawPayload === "object" && rawPayload !== null && "payload" in rawPayload
    ? rawPayload.payload
    : rawPayload;
const envelope = parseEnvelope({ ...envelopeHeaders, payload: wirePayload });
```

Type-guarded — flat payloads (no wrapping) fall through unchanged; arbitrary objects without a `payload` key cannot be coerced into a peel.

`OutboxRepository.add` extension (same commit, W3, file `packages/messaging-spine/src/outbox/outbox-repository.ts`):

```ts
async add(envelope: DomainEventEnvelope, route: OutboxRoute, em?: EntityManager): Promise<void> {
  const row = this.buildRow(envelope, route);
  await (em ?? this.em).persist(row).flush();
}
```

Optional third positional argument — legacy callers (those who already opened their own `em.transactional` and use `this.em` from within it) omit the argument and get the injected root EM; new callers (Phase 3 handlers and onward) pass the decorator's `txEm` so the outbox row lands in the same TX as the inbox dedupe row and the side-effect mutation. Additive, backwards-compatible at call time, documented as a public-API minor change.

Handler usage (Plan 03-06 commit `6278d38`, `WalletDebitHandler.handle`):

```ts
async handle(envelope: DomainEventEnvelope<WalletDebitPayload>, _msg: ConsumeMessage, txEm: EntityManager) {
  // ... validate, derive Money + PlayerId
  const result = await this.walletRepo.applyDebitAtomically(playerId, amount, txEm);
  // ... pattern-match on result.kind
  await this.txRepo.append(transaction, { playerId, txEm });
  await this.outbox.add(walletDebitedEnvelope, route, txEm);
}
```

All three writes — `wallets` UPDATE (atomic conditional UPDATE bound to the TX context via `em.getConnection().execute(sql, params, "all", em.getTransactionContext())`, the Plan 03-09 commit `5678c0f` autocommit fix), `transactions` INSERT, `outbox` row — execute on the connection carrying the decorator's open `BEGIN`, alongside the inbox dedupe row. The TX commits all four or rolls back all four.

Plan 03-01 commit `1eb453a` updated the five Phase 2 integration test probes that walked `envelope.payload.payload` (now `envelope.payload`); the sixth (`poison-message.test.ts`) doesn't read the payload. Five files modified, 10 lines changed. Final messaging-spine test suite: 61 unit pass + 6 integration pass + typecheck clean (Plan 03-01 evidence, re-verified at this writing — 61/61 unit pass via `bun test packages/messaging-spine/tests/unit`).

Rationale, per 03-RESEARCH §"OI-1 / OI-3 Resolution Recommendation" + Plan 03-01 SUMMARY §"Public API change for ADR-013": this is the only resolution shape that preserves the Identity Map (so ADR-001's MikroORM choice keeps its payoff), preserves the same-TX guarantee (so ADR-007's outbox spine keeps its at-least-once-once-only semantics), and doesn't push the threading burden into every handler's documentation. The public-API change is small (one positional arg, optional on the outbox repository, JS-semantics-compatible on the decorator) and the audit story is clean: every spine consumer that uses `txEm` is doing so because the decorator's transactional callback gives it to them, not because they manually opened a TX and forgot to thread it.

## Consequences

- **Locked in (public API)**: handlers decorated with `@IdempotentSubscribe` MAY accept a third `txEm: EntityManager` argument (and SHOULD, for any handler that mutates entities — the doc-block on the decorator records the contract); `OutboxRepository.add(envelope, route, em?)` accepts an optional third positional EM; every new handler in Phase 3 / Phase 5 / Phase 9 inherits this surface.
- **Spine semver impact**: this is a minor-version change to `@crash/messaging-spine` — handlers without the third arg keep working (JS ignores extra positional args), but the documented contract is now 3-arg. ADR-007 + ADR-008 + ADR-009 + ADR-010 remain Accepted; this ADR extends the contract that ADR-007 / ADR-008 established.
- **Domain-purity preserved**: domain-layer repository interfaces (`services/wallets/src/domain/{wallet,transaction}.repository.ts`) type `txEm: unknown` — the infrastructure-layer Mikro repositories do an `instanceof EntityManager` runtime check (Plan 03-06 deviation 2). Application-layer handlers pass the real `EntityManager`. The domain never imports `@mikro-orm/*`.
- **TX-context binding for raw SQL**: the wallets atomic UPDATE pattern requires `em.getConnection().execute(sql, params, "all", em.getTransactionContext())` to bind raw SQL to the decorator's open TX (Plan 03-09 fix in commit `5678c0f`). Without the fourth argument, `execute` runs on the pool's autocommit connection — the wallet UPDATE commits before the Transaction insert + outbox row, breaking the same-TX guarantee. This is now the canonical pattern for any handler that needs to drop into raw SQL while preserving the four-write atomicity.
- **Integration test surface**: Plan 03-09 integration suite (`services/wallets/tests/integration/`, 6 files, 15 pass / 0 fail with the docker stack live) proves the end-to-end same-TX guarantee — `inbox-replay.test.ts` confirms the dedupe row blocks redelivery before the handler body runs; `wallet-debit.test.ts` and `wallet-credit.test.ts` confirm the four writes commit atomically; `wallet-debit-rejected.test.ts` confirms the balance stays untouched on INSUFFICIENT_FUNDS.
- **Foreclosed**: Option B (raw SQL everywhere) would have required rewriting Plan 03-02's domain-layer repository interfaces and Plan 03-05's repository implementations; Option C (em.flush mid-TX) is an anti-pattern documented across every outbox writeup reviewed in 02-RESEARCH §Pattern 3.
- **Anticipated recruiter question**: "Why did the decorator's signature change in Phase 3?" — defended by the OI-3 carry-forward note in 02-09 SUMMARY (Phase 2 verification surfaced this exact gap), the same-TX requirement that ADR-007 established, and the fact that the alternative (Option B raw SQL everywhere) would have undone ADR-001's MikroORM choice.

## Alternatives Rejected

- **Option B — raw SQL in every handler** — defeats ADR-001's MikroORM Data Mapper benefit; the property test in Plan 03-08 loses its pure-domain test surface; every future handler (Phase 5 saga, Phase 9 leaderboard projector) inherits the SQL-string-assembly cost.
- **Option C — internal `em.flush` mid-TX** — `this.em.flush` executes on the wrong connection (request-scoped EM, not the decorator's transactional EM); silent data-loss surface when the outer TX rolls back; recreates the dual-write bug ADR-007's outbox spine was built to prevent.
- **Status-quo (keep 2-arg signature, document the limitation)** — would force every Phase 3+ handler to either drop into raw SQL (Option B) or open its own nested transaction (Option C's failure mode); the technical-debt cost grows linearly with the number of handlers and was paid down once here, at the decorator boundary, where it belongs.
