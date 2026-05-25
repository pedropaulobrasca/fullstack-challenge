# ADR-009: DLX topology with `x-delivery-limit` on the DLQ itself (quorum queues, RabbitMQ 4.2)

**Status**: Accepted
**Date**: 2026-05-24
**Phase**: 2

## Context

REQ-SAGA-05 reads: "System uses quorum queues + DLX with `x-delivery-limit` on both main and DLQ; poison messages land in a dead-letter table for inspection." Two failure modes drive this requirement.

The first is the main-queue poison loop: a message that consistently fails its handler must not redeliver indefinitely. Quorum queues solve this through `x-delivery-limit`: after N redeliveries, the broker routes the message to the configured `x-dead-letter-exchange` instead of redelivering again.

The second, less obvious, is the DLQ-itself poison loop. PITFALLS C4 and the joaovieira.ca writeup both document a production-grade incident pattern: a dead-letter consumer that itself fails (database unreachable, schema mismatch, parser bug) leaves the DLQ in an indefinite redelivery loop. Without an `x-delivery-limit` on the DLQ, the broker accumulates redelivery counts on the same messages, broker memory grows, and the cluster degrades. RabbitMQ defaults do not prevent this: classic queues have no first-class poison handling, and quorum queues only apply `x-delivery-limit` to the queue it is declared on.

The decision space is small: classic vs quorum, with-DLQ-limit vs without. Plan 02-06 (`TopologyBootstrap`) declares the topology at service startup via `assertExchange` + `assertQueue` + `bindQueue`; plan 02-07 wires per-service `GamesDeadLetterConsumer` and `WalletsDeadLetterConsumer` subclasses of the `DeadLetterConsumer` base from plan 02-05.

## Considered

- **Classic queues with manual retry/ack** — Pre-quorum-queue idiom: handler catches error → republishes to a delay queue → eventually NACKs to broker. No first-class poison handling; requires hand-rolling retry-count tracking in message headers. Easy to get subtly wrong; the broker does not enforce a cap.
- **Quorum queues with `x-delivery-limit` on main only** — Main queue routes to DLX after N attempts. DLQ has no limit. A failing dead-letter consumer (DB unreachable during `dead_letter_messages` INSERT) accumulates redelivery counts on the same poison messages forever. Documented to have taken down clusters in production.
- **Quorum queues with `x-delivery-limit` on both main AND DLQ** — Main queue declares `x-queue-type=quorum` + `x-delivery-limit=RMQ_DELIVERY_LIMIT_MAIN` (env-default 5) + `x-dead-letter-exchange=<dlx>`. DLQ declares `x-queue-type=quorum` + `x-delivery-limit=RMQ_DELIVERY_LIMIT_DLQ` (env-default 3) and no further DLX (terminal). After 5 main attempts + 3 DLQ attempts the message is dropped by the broker; the operator inspects `dead_letter_messages` for the side that succeeded in persisting.

## Decision

**Quorum queues everywhere, with `x-delivery-limit` on BOTH main and DLQ.**

The single source of truth lives in `packages/messaging-spine/src/topology/topology-defaults.ts`:

- `EXCHANGES` constants — `WALLET_COMMANDS` (direct), `WALLET_EVENTS` / `GAME_EVENTS` (topic), `WALLET_DLX` / `GAME_DLX` (fanout).
- `QUEUES` constants — `WALLET_COMMANDS` (`wallet.commands.q`), `GAMES_WALLET_EVENTS` (`games.wallet-events.q`), `WALLET_DLQ` (`wallet.dlq`), `GAMES_DLQ` (`games.dlq`).
- `buildQuorumArgs(deliveryLimit, dlxName?)` — returns `{ "x-queue-type": "quorum", "x-delivery-limit": deliveryLimit, "x-dead-letter-exchange"?: dlxName }`.
- `deriveDlxFromExchange(exchange)` — convenience used by `@IdempotentSubscribe` to wire main queue → DLX.

Each service's `TopologyConfig` (passed to `MessagingSpineModule.forRootAsync`) declares its exchanges, main queues with `buildQuorumArgs(RMQ_DELIVERY_LIMIT_MAIN, dlxName)`, and DLQs with `buildQuorumArgs(RMQ_DELIVERY_LIMIT_DLQ)` (no further DLX — terminal). `TopologyBootstrap` (plan 02-06) runs these assertions on `OnApplicationBootstrap` via a one-shot channel that always closes.

The `DeadLetterConsumer` base class (plan 02-05) subscribes to the DLQ, reads `x-death` from headers, persists into `dead_letter_messages` via the `DeadLetterRepository`, and always acks. Per-service `GamesDeadLetterConsumer` and `WalletsDeadLetterConsumer` subclasses (plan 02-07) bind to `QUEUES.GAMES_DLQ` and `QUEUES.WALLET_DLQ` respectively with `buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_DLQ)`.

Bounded poison absorption: up to 5 attempts on the main queue, then up to 3 attempts on the DLQ. After the third DLQ attempt without a successful `dead_letter_messages` INSERT, the broker drops the message. This is acceptable last-resort behavior because the consumer logs surface every dead-letter event and the operator can inspect broker logs for the dropped envelope.

Rationale, per 02-RESEARCH §Pitfall 4 + PITFALLS C4 + the RabbitMQ Quorum Queues docs (rabbitmq.com/docs/quorum-queues) + the DLX docs (rabbitmq.com/docs/dlx): the cost of declaring quorum + delivery-limit on the DLQ is a single line per queue; the cost of NOT declaring it is a documented production incident pattern. The trade-off is one-sided.

## Consequences

- **Locked in**: every main queue is quorum with `x-delivery-limit=RMQ_DELIVERY_LIMIT_MAIN` + `x-dead-letter-exchange=<dlx>`; every DLQ is quorum with `x-delivery-limit=RMQ_DELIVERY_LIMIT_DLQ` and no further DLX; `dead_letter_messages` table receives persisted exhausted messages with a `UNIQUE (consumer_name, original_message_id)` guard against DLQ-itself redelivery races.
- **Env defaults**: `RMQ_DELIVERY_LIMIT_MAIN=5`, `RMQ_DELIVERY_LIMIT_DLQ=3` — already in REQUIREMENTS.md Open Configuration Values and wired into both services' `defaults.ts` (plan 02-07).
- **Foreclosed**: classic queues anywhere; quorum-with-limit-on-main-only; routing the DLQ to a second DLX (recursion buys nothing).
- **Operator workflow**: `dead_letter_messages` is the inspection surface — SQL queries or a Phase 10 replay endpoint. RabbitMQ management UI shows DLQ depth and redelivery counts as the live signal.
- **Monitoring follow-up**: Phase 10 observability should expose `dead_letter_messages_count{service}` as a Prometheus gauge so a non-zero count alerts.
- **Anticipated recruiter question**: "Why a limit on the DLQ?" — defended by PITFALLS C4 (cluster takedowns documented in production) and the RabbitMQ docs explicitly recommending it for quorum-queue topologies.

## Alternatives Rejected

- **Classic queues with manual retry/ack** — no first-class poison handling; requires hand-rolling retry-count tracking; broker does not enforce a cap.
- **Quorum queues with `x-delivery-limit` on main only** — DLQ poison loop documented in PITFALLS C4 to take down clusters; the cost of adding the limit on the DLQ is one line per declaration.
