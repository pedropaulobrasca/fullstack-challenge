# ADR-008: `amqplib` raw publisher + `@golevelup/nestjs-rabbitmq` consumer split

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 2

## Context

REQ-WALL-06 mandates that the outbox publisher use `confirmSelect` + `waitForConfirms` to guarantee at-least-once delivery: the broker must acknowledge every published message before the corresponding outbox row is marked `PUBLISHED`. REQ-SAGA-05 mandates quorum-queue + DLX topology with explicit `x-delivery-limit` arguments on both main and DLQ. REQ-WALL-05 mandates an inbox dedup row inserted in the same transaction as the side-effect, behind a decorator that wraps every consumer method. REQ-SAGA-06 mandates `correlationId` / `causationId` propagation through every message — read from CLS on publish, extracted from headers and pushed into CLS on consume.

These two halves — publisher confirm-channel lifecycle ownership, consumer ergonomic decorator-driven subscription — have different design pressures. The publisher wants full control over channel lifecycle: open a confirm channel, publish a batch, await confirms, mark processed in one TX, close cleanly on shutdown. The consumer wants connection-lifecycle automation, queue-binding declaration, reconnect handling, and a decorator-friendly registration surface that the `@IdempotentSubscribe` wrapper can stack on top of.

Three off-the-shelf options exist: raw `amqplib` end-to-end, `@nestjs/microservices` RabbitMQ transport end-to-end, and `@golevelup/nestjs-rabbitmq` end-to-end. A fourth — split the two halves intentionally — was chosen.

## Considered

- **Raw `amqplib` end-to-end** — Full control over both publisher and consumer, but every reconnect / re-bind / heartbeat / channel-error pathway hand-rolled. ~150 LOC of connection-management boilerplate per service that has been written and re-written across every RabbitMQ tutorial since 2014. Battle-tested code that someone else maintains is a strictly better trade.
- **`@nestjs/microservices` RabbitMQ transport end-to-end** — NestJS-idiomatic, low-friction. Hides `confirmSelect` / `waitForConfirms` behind the transport layer; PITFALLS M8 documents that satisfying REQ-WALL-06 from inside the transport requires ejecting from the abstraction (custom client + custom server). At that point the transport adds friction instead of removing it.
- **`@golevelup/nestjs-rabbitmq` end-to-end** — `@RabbitSubscribe` decorator is the cleanest consumer ergonomics in the ecosystem; the `RabbitMQModule` manages connection lifecycle + reconnect. The publisher path through `amqpConnection.publish(...)` exists but does not expose a confirm channel's full lifecycle (await-confirms-then-mark-published in the same DB transaction). Workable but awkward.
- **Split: raw `amqplib` confirm channel inside `OutboxPublisher` + `@golevelup/nestjs-rabbitmq` everywhere else** — Publisher uses `amqpConnection.connection.createConfirmChannel()` (delegating connection management to golevelup while owning the channel itself). Consumer uses `@RabbitSubscribe` via golevelup, wrapped by our `@IdempotentSubscribe` decorator (plan 02-05). Topology assertion (plan 02-06 `TopologyBootstrap`) uses a one-shot channel from the same shared connection.

## Decision

**Use both intentionally — `amqplib` for the publisher confirm channel, `@golevelup/nestjs-rabbitmq` for everything else.**

`OutboxPublisher` (plan 02-04) obtains its confirm channel via `await this.amqp.connection.createConfirmChannel()`, where `this.amqp` is the `AmqpConnection` injected by `@golevelup/nestjs-rabbitmq`. The confirm channel is opened in `onApplicationBootstrap`, drained on `onApplicationShutdown` (`waitForConfirms()` + `close()`), and used exclusively by the polling loop. The poll body is wrapped in `em.transactional`: claim batch with `FOR UPDATE SKIP LOCKED` → publish each row → `await channel.waitForConfirms()` → `UPDATE outbox SET status = 'PUBLISHED'` → commit. If `waitForConfirms` throws, the TX rolls back and rows return to `PENDING` for the next poll — the at-least-once contract holds.

Consumers (plan 02-05 onward) declare handlers with our `@IdempotentSubscribe` decorator, which internally forwards to `@RabbitSubscribe` from golevelup with queue-binding arguments derived from `buildQuorumArgs(deliveryLimit, dlxName)`. The decorator opens a request-scoped TX, inserts the inbox row, dispatches to the wrapped handler, marks `processed_at`, and returns; golevelup acks the AMQP message on successful return per its documented contract ("do not call channel.ack() / channel.nack() directly; return a `Nack` instance or undefined").

One `AmqpConnection` per service hosts both directions. The mental-model cost — "two APIs for the same broker" — is paid once and documented here.

Rationale, per 02-RESEARCH §Pattern 1 + §Pattern 2 + §"Don't Hand-Roll" + STACK.md SUMMARY §8: `amqplib` is the lowest level where the confirm channel's full lifecycle (createConfirmChannel + publish + waitForConfirms + close) is first-class. `@nestjs/microservices` would require us to eject from its abstraction to satisfy REQ-WALL-06 — at which point the abstraction is a net cost. `@golevelup/nestjs-rabbitmq`'s consumer ergonomics are unmatched and stack cleanly under our `@IdempotentSubscribe` decorator (plan 02-05 verified this on the unit-test bench). Picking the right tool per side is a one-line documentation cost that lasts the project lifetime.

## Consequences

- **Locked in**: `OutboxPublisher` depends on `AmqpConnection` from `@golevelup/nestjs-rabbitmq` and obtains its confirm channel via `connection.createConfirmChannel()`; every consumer in every service uses `@IdempotentSubscribe` which internally wraps `@RabbitSubscribe`; `TopologyBootstrap` (plan 02-06) asserts exchanges + queues + bindings on a one-shot channel from the same `AmqpConnection`.
- **Foreclosed**: `@nestjs/microservices` RabbitMQ transport as a consumer wrapper; raw `amqplib` end-to-end (rejected to avoid hand-rolling connection lifecycle).
- **Two APIs, one connection**: the cost is paid in the publisher's dependency on the raw `amqplib` channel API (typed via `@types/amqplib`, added as a dev dep in both services per the P2.7 deviation log). Documented in code via the `OutboxPublisher` JSDoc and surfaced here for arguição.
- **Type-safety burden**: `@types/amqplib` must stay in sync with the runtime `amqplib` version in both services. P2.7 already shipped this dependency to both `services/games` and `services/wallets`; future bumps go through both manifests in lockstep.
- **Anticipated recruiter question**: "Why two AMQP clients?" — defended by the confirm-channel-ownership argument and the explicit rejection of `@nestjs/microservices` for REQ-WALL-06.

## Alternatives Rejected

- **Raw `amqplib` end-to-end** — ~150 LOC of connection-lifecycle boilerplate per service; `@golevelup/nestjs-rabbitmq` solves this for free with a maintained, battle-tested module.
- **`@nestjs/microservices` RabbitMQ transport end-to-end** — hides `confirmSelect` / `waitForConfirms`; satisfying REQ-WALL-06 requires ejecting from the abstraction (PITFALLS M8), at which point the transport is a net cost.
- **`@golevelup/nestjs-rabbitmq` end-to-end** — `amqpConnection.publish(...)` does not expose a confirm channel's full lifecycle (await-confirms-then-mark-published in one DB transaction); workable only with awkward private-API access.
