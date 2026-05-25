---
phase: 02-outbox-inbox-spine
plan: 07
subsystem: messaging spine integration into games + wallets services
tags: [nestjs, mikro-orm, migrations, rabbitmq, topology, outbox, inbox, dlq, docker]
requires:
  - "P2.6 MessagingSpineModule.forRootAsync + TopologyBootstrap"
  - "P2.2 shared SQL fragments at packages/messaging-spine/src/migrations/shared/*.sql"
  - "Phase 1 docker-compose stack (games/wallets services + migrate init containers)"
provides:
  - "OUTBOX_POLL_BATCH_SIZE env (default 100) in both gamesEnvSchema and walletsEnvSchema"
  - "OutboxMessage/InboxMessage/DeadLetterMessage EntitySchemas registered in both mikro-orm.config.ts"
  - "Six MikroORM migrations (three per service) loading the canonical SQL fragments via require.resolve + readFileSync"
  - "AppModule.forRoot for both services mounting MikroOrmModule.forRoot + MessagingSpineModule.forRootAsync with per-service TopologyConfig"
  - "GamesDeadLetterConsumer + WalletsDeadLetterConsumer @RabbitSubscribe-bound to their DLQs with x-delivery-limit=3"
  - "smoke-health extended with 15 new probes (6 table probes + 9 RabbitMQ topology probes)"
affects:
  - "Phase 3 wallet handlers can now inject OutboxRepository + InboxRepository and rely on the asserted topology"
  - "Phase 4 round loop publisher will use the same wired spine"
  - "Phase 5 saga integration tests will run against this exact module composition"
tech-stack:
  added:
    - "@types/amqplib ^0.10.8 added to both services for ConsumeMessage typing"
  patterns:
    - "Map TopologyConfig directly into RabbitMQConfig.exchanges/queues — declarations happen on connect, before @RabbitSubscribe handler registration tries to bind"
    - "MESSAGING_OPTIONS hoisted into a tiny global sub-module so RabbitMQModule.forRootAsync.useFactory can inject it from outside the spine module's scope"
    - "Migrations use createRequire(import.meta.url) + require.resolve + readFileSync to load SQL bodies — package.json subpath exports declare the .sql files as a public surface"
    - "Per-service DeadLetterConsumer subclass holds the @RabbitSubscribe decorator (consumer is per-DLQ; base class is shared)"
key-files:
  created:
    - services/games/src/infrastructure/mikro-orm/migrations/20260524001-create-outbox.ts
    - services/games/src/infrastructure/mikro-orm/migrations/20260524002-create-inbox.ts
    - services/games/src/infrastructure/mikro-orm/migrations/20260524003-create-dead-letter-messages.ts
    - services/wallets/src/infrastructure/mikro-orm/migrations/20260524001-create-outbox.ts
    - services/wallets/src/infrastructure/mikro-orm/migrations/20260524002-create-inbox.ts
    - services/wallets/src/infrastructure/mikro-orm/migrations/20260524003-create-dead-letter-messages.ts
    - services/games/src/infrastructure/messaging/games-dead-letter.consumer.ts
    - services/wallets/src/infrastructure/messaging/wallets-dead-letter.consumer.ts
    - .planning/phases/02-outbox-inbox-spine/02-07-SUMMARY.md
  modified:
    - services/games/src/config/defaults.ts
    - services/wallets/src/config/defaults.ts
    - services/games/.env.example
    - services/wallets/.env.example
    - services/games/.env
    - services/wallets/.env
    - services/games/mikro-orm.config.ts
    - services/wallets/mikro-orm.config.ts
    - services/games/src/app.module.ts
    - services/wallets/src/app.module.ts
    - services/games/package.json
    - services/wallets/package.json
    - bun.lock
    - packages/messaging-spine/package.json
    - packages/messaging-spine/src/module.ts
    - scripts/smoke-health.sh
decisions:
  - "Use the package exports field to publish ./src/migrations/shared/*.sql as a public subpath rather than walking up to the package root via dirname — keeps the contract explicit and the SQL files become a documented part of the messaging-spine public surface"
  - "Hoist MESSAGING_OPTIONS into a sub-module (MessagingOptionsModule.forRootAsync, global=true) so the same options provider can be injected by both MessagingSpineModule providers AND RabbitMQModule.forRootAsync.useFactory (which runs in its own module scope and cannot see MessagingSpineModule's providers without an imports link)"
  - "Feed TopologyConfig.exchangesToAssert/queuesToAssert directly into RabbitMQConfig.exchanges/queues so RabbitMQModule does the assertion on connect, before handler discovery and queue-binding run in onApplicationBootstrap — TopologyBootstrap becomes a defense-in-depth second pass for bindings only"
  - "Per-service DLQ consumer subclass (GamesDeadLetterConsumer, WalletsDeadLetterConsumer) rather than a parameterized factory — each service owns its own DLQ topology and the @RabbitSubscribe arguments are static literals from EXCHANGES/QUEUES constants, making the binding visible in code review"
metrics:
  duration_minutes: 35
  tasks_completed: 4
  files_created: 9
  files_modified: 16
  commits: 5
  completed: 2026-05-24
---

# Phase 2 Plan 7: Service Wiring Summary

Mounts every artefact built in plans 02-01 through 02-06 into the live
games and wallets services. After this plan, `bun run docker:up` brings the
stack up cold with six migrations applied, every messaging entity
registered, every RabbitMQ exchange/queue/binding asserted, and a concrete
DLQ consumer subscribed on each side. The extended `bun run smoke:health`
reports 22/22 probes green (7 baseline Phase 1 + 6 table probes + 9
topology probes).

REQ-WALL-05, REQ-WALL-06, REQ-SAGA-05 and REQ-SAGA-06 are now operationally
realised — Phase 3 wallet handlers can `em.transactional` an outbox.add
call and the publisher will pick it up; the DLQ has its own
x-delivery-limit=3 so poison loops cannot occur.

---

## Final per-service TopologyConfig

### wallets

```ts
{
  exchangesToAssert: [
    { name: EXCHANGES.WALLET_COMMANDS, type: "direct", durable: true },
    { name: EXCHANGES.WALLET_EVENTS,   type: "topic",  durable: true },
    { name: EXCHANGES.WALLET_DLX,      type: "fanout", durable: true },
  ],
  queuesToAssert: [
    { name: QUEUES.WALLET_COMMANDS,
      deliveryLimit: env.RMQ_DELIVERY_LIMIT_MAIN,
      dlx: EXCHANGES.WALLET_DLX },
    { name: QUEUES.WALLET_DLQ,
      deliveryLimit: env.RMQ_DELIVERY_LIMIT_DLQ },
  ],
  bindings: [
    { queue: QUEUES.WALLET_COMMANDS, exchange: EXCHANGES.WALLET_COMMANDS, routingKey: "wallet.debit" },
    { queue: QUEUES.WALLET_COMMANDS, exchange: EXCHANGES.WALLET_COMMANDS, routingKey: "wallet.credit" },
    { queue: QUEUES.WALLET_DLQ,      exchange: EXCHANGES.WALLET_DLX,      routingKey: "" },
  ],
}
```

### games

```ts
{
  exchangesToAssert: [
    { name: EXCHANGES.GAME_EVENTS,   type: "topic",  durable: true },
    { name: EXCHANGES.GAME_DLX,      type: "fanout", durable: true },
    { name: EXCHANGES.WALLET_EVENTS, type: "topic",  durable: true },
  ],
  queuesToAssert: [
    { name: QUEUES.GAMES_WALLET_EVENTS,
      deliveryLimit: env.RMQ_DELIVERY_LIMIT_MAIN,
      dlx: EXCHANGES.GAME_DLX },
    { name: QUEUES.GAMES_DLQ,
      deliveryLimit: env.RMQ_DELIVERY_LIMIT_DLQ },
  ],
  bindings: [
    { queue: QUEUES.GAMES_WALLET_EVENTS, exchange: EXCHANGES.WALLET_EVENTS, routingKey: "wallet.*" },
    { queue: QUEUES.GAMES_DLQ,           exchange: EXCHANGES.GAME_DLX,      routingKey: "" },
  ],
}
```

`wallet.events` appears in the games exchangesToAssert because games CONSUMES
from it — declaring it idempotently means games can bring up cleanly even
if wallets is not yet running. Both services will agree on the same shape
because the constants flow from `packages/messaging-spine/src/topology/topology-defaults.ts`.

---

## Env additions

Both `gamesEnvSchema` and `walletsEnvSchema` now declare:

```ts
OUTBOX_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(100)
```

Mirrored in `services/{games,wallets}/.env.example` and `services/{games,wallets}/.env`:

```
# Phase 2 — Outbox publisher tuning
OUTBOX_POLL_BATCH_SIZE=100
```

`OUTBOX_POLL_INTERVAL_MS=1000`, `RMQ_DELIVERY_LIMIT_MAIN=5`, `RMQ_DELIVERY_LIMIT_DLQ=3`
were already present from Phase 1.

---

## Migrations

Six files, identical structure across services (only the absolute path differs).
Each loads the canonical SQL via `require.resolve` against the messaging-spine
package exports.

| Migration | Service | Loads | down() |
|-----------|---------|-------|--------|
| `20260524001-create-outbox.ts` | games + wallets | `@crash/messaging-spine/src/migrations/shared/001-outbox.sql` | drops trigger + function + table |
| `20260524002-create-inbox.ts` | games + wallets | `@crash/messaging-spine/src/migrations/shared/002-inbox.sql` | drops table |
| `20260524003-create-dead-letter-messages.ts` | games + wallets | `@crash/messaging-spine/src/migrations/shared/003-dead-letter-messages.sql` | drops table |

Migrate logs (cold docker:up cycle):

```
games-migrate-1  | [migrator] Applied '20260524001-create-outbox'
games-migrate-1  | [migrator] Applied '20260524002-create-inbox'
games-migrate-1  | [migrator] Applied '20260524003-create-dead-letter-messages'
games-migrate-1  | Successfully migrated up to the latest version
wallets-migrate-1| [migrator] Applied '20260524001-create-outbox'
wallets-migrate-1| [migrator] Applied '20260524002-create-inbox'
wallets-migrate-1| [migrator] Applied '20260524003-create-dead-letter-messages'
wallets-migrate-1| Successfully migrated up to the latest version
```

Both migrate init containers exit 0.

---

## Per-service DLQ consumer

```ts
@Injectable()
export class WalletsDeadLetterConsumer extends DeadLetterConsumer {
  protected readonly consumerName = "wallets.dlq";

  constructor(repo: DeadLetterRepository) {
    super(repo, new Logger(WalletsDeadLetterConsumer.name));
  }

  @RabbitSubscribe({
    exchange: EXCHANGES.WALLET_DLX,
    routingKey: "",
    queue: QUEUES.WALLET_DLQ,
    queueOptions: {
      durable: true,
      arguments: buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_DLQ),
    },
  })
  async handle(rawPayload: unknown, msg: ConsumeMessage): Promise<undefined> {
    return this.handleDeadLetter(rawPayload, msg);
  }
}
```

`GamesDeadLetterConsumer` mirrors the shape with `EXCHANGES.GAME_DLX` /
`QUEUES.GAMES_DLQ` / `consumerName = "games.dlq"`. Both use
`buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_DLQ)` — satisfying REQ-SAGA-05's
"x-delivery-limit on the DLQ itself" requirement made concrete.

---

## RabbitMQ topology snapshot (live management API)

`wallet.commands.q` (queried via `GET /api/queues/%2F/wallet.commands.q`):

```json
{
  "type": "quorum",
  "arguments": {
    "x-dead-letter-exchange": "wallet.dlx",
    "x-delivery-limit": 5,
    "x-queue-type": "quorum"
  }
}
```

`wallet.dlq`:

```json
{
  "type": "quorum",
  "arguments": {
    "x-delivery-limit": 3,
    "x-queue-type": "quorum"
  }
}
```

Note: `wallet.dlq` correctly has no `x-dead-letter-exchange` — terminal queue.

TopologyBootstrap log lines (cold boot) confirm every declaration:

```
wallets-1 | [TopologyBootstrap] assertExchange wallet.commands (direct)
wallets-1 | [TopologyBootstrap] assertExchange wallet.events (topic)
wallets-1 | [TopologyBootstrap] assertExchange wallet.dlx (fanout)
wallets-1 | [TopologyBootstrap] assertQueue wallet.commands.q (deliveryLimit=5, dlx=wallet.dlx)
wallets-1 | [TopologyBootstrap] assertQueue wallet.dlq (deliveryLimit=3, dlx=none)
wallets-1 | [TopologyBootstrap] bindQueue wallet.commands.q <- wallet.commands :: wallet.debit
wallets-1 | [TopologyBootstrap] bindQueue wallet.commands.q <- wallet.commands :: wallet.credit
wallets-1 | [TopologyBootstrap] bindQueue wallet.dlq <- wallet.dlx :: 
games-1   | [TopologyBootstrap] assertExchange game.events (topic)
games-1   | [TopologyBootstrap] assertExchange game.dlx (fanout)
games-1   | [TopologyBootstrap] assertExchange wallet.events (topic)
games-1   | [TopologyBootstrap] assertQueue games.wallet-events.q (deliveryLimit=5, dlx=game.dlx)
games-1   | [TopologyBootstrap] assertQueue games.dlq (deliveryLimit=3, dlx=none)
games-1   | [TopologyBootstrap] bindQueue games.wallet-events.q <- wallet.events :: wallet.*
games-1   | [TopologyBootstrap] bindQueue games.dlq <- game.dlx :: 
```

---

## Postgres state snapshot

Both databases (games, wallets) report identical state via `\dt` + `pg_proc` /
`pg_trigger`:

| Object | games | wallets |
|--------|-------|---------|
| table outbox | exists | exists |
| table inbox | exists | exists |
| table dead_letter_messages | exists | exists |
| function outbox_notify_fn | exists | exists |
| trigger outbox_notify_trigger ON outbox | exists | exists |
| index outbox_pending_idx (partial WHERE status='PENDING') | exists | exists |
| table mikro_orm_migrations | 3 rows | 3 rows |

---

## smoke-health: 22/22

```
Running Phase 1+2 smoke probes against local stack...

[PASS] postgres pg_isready
[PASS] rabbitmq management api
[PASS] keycloak /health/ready (port 9000)
[PASS] keycloak password grant (player/player123)
[PASS] kong admin /status (port 8001)
[PASS] games /health (port 4001)
[PASS] wallets /health (port 4002)
[PASS] postgres table games.outbox
[PASS] postgres table wallets.outbox
[PASS] postgres table games.inbox
[PASS] postgres table wallets.inbox
[PASS] postgres table games.dead_letter_messages
[PASS] postgres table wallets.dead_letter_messages
[PASS] rabbitmq exchanges wallet.commands
[PASS] rabbitmq exchanges wallet.events
[PASS] rabbitmq exchanges wallet.dlx
[PASS] rabbitmq exchanges game.events
[PASS] rabbitmq exchanges game.dlx
[PASS] rabbitmq queues wallet.commands.q
[PASS] rabbitmq queues wallet.dlq
[PASS] rabbitmq queues games.wallet-events.q
[PASS] rabbitmq queues games.dlq

Smoke summary: 22/22 probes passed
```

No Phase 1 regression — the original 7 probes continue to pass.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Subpath exports needed for SQL fragments**

- **Found during:** Task 4 — first `bun run docker:up` cycle.
- **Issue:** Migration containers failed with
  `Cannot find module '@crash/messaging-spine/src/migrations/shared/001-outbox.sql'`.
  The messaging-spine `package.json` only exported `.`, and Node's exports
  field treats any unlisted subpath as inaccessible — even via `require.resolve`.
- **Fix:** Added `"./src/migrations/shared/*.sql": "./src/migrations/shared/*.sql"`
  pattern to the exports map. This publishes the SQL fragments as an explicit
  public subpath of the package, which is conceptually correct (the SQL bodies
  are part of messaging-spine's published contract).
- **Files modified:** `packages/messaging-spine/package.json`
- **Commit:** `b8f6f03`

**2. [Rule 3 — Blocking] MESSAGING_OPTIONS not visible inside RabbitMQModule scope**

- **Found during:** Task 4 — second docker:up cycle after fixing the exports.
- **Issue:** `UnknownDependenciesException: Nest can't resolve dependencies
  of the CONFIGURABLE_MODULE_OPTIONS (?). Please make sure that the argument
  Symbol(MESSAGING_OPTIONS) at index [0] is available in the RabbitMQModule
  module.` The MESSAGING_OPTIONS provider was declared in MessagingSpineModule's
  `providers` array, but `RabbitMQModule.forRootAsync` runs in its own DI
  scope and cannot see sibling providers without an explicit `imports` link.
- **Fix:** Hoisted MESSAGING_OPTIONS into a tiny global sub-module
  (`MessagingOptionsModule.forRootAsync`, `global: true`) and passed that
  sub-module both to `MessagingSpineModule.imports` AND to
  `RabbitMQModule.forRootAsync({ imports: [...] })`. Updated the spine's
  exports to surface `MessagingOptionsModule` rather than `MESSAGING_OPTIONS`
  directly (a module can only export providers it owns).
- **Files modified:** `packages/messaging-spine/src/module.ts`
- **Commit:** `b8f6f03`

**3. [Rule 3 — Blocking] DLQ consumer bound to game.dlx before TopologyBootstrap asserted it**

- **Found during:** Task 4 — third docker:up cycle.
- **Issue:** `Channel closed by server: 404 (NOT-FOUND) "no exchange 'game.dlx'
  in vhost '/'"`. RabbitMQModule's `onApplicationBootstrap` runs handler
  registration (including the @RabbitSubscribe queue binding) BEFORE
  TopologyBootstrap's `onApplicationBootstrap` had a chance to assert the
  exchange. The two NestJS lifecycle hooks fire in module-registration order,
  but inside `onApplicationBootstrap` the order between RabbitMQModule and
  TopologyBootstrap is racy because both are at the same lifecycle phase.
- **Fix:** Mapped the per-service TopologyConfig directly into
  `RabbitMQConfig.exchanges` and `RabbitMQConfig.queues` inside the
  `RabbitMQModule.forRootAsync` useFactory. RabbitMQModule asserts these on
  connect (before handler discovery), so when @RabbitSubscribe later tries
  to bindQueue, the exchange already exists. TopologyBootstrap remains as a
  defense-in-depth second assertion (it is also responsible for the explicit
  bindings array — golevelup's queues config does not declare wallet.* / 
  wallet.debit bindings).
- **Files modified:** `packages/messaging-spine/src/module.ts`
- **Commit:** `b8f6f03`

**4. [Rule 3 — Blocking] @types/amqplib missing in service packages**

- **Found during:** Task 3 typecheck.
- **Issue:** `error TS7016: Could not find a declaration file for module 'amqplib'`
  in the new DLQ consumer files. `@types/amqplib` was a devDep only in
  messaging-spine, not in the services that now import `ConsumeMessage` from
  amqplib directly.
- **Fix:** `bun add -d @types/amqplib@^0.10.8` in both services.
- **Files modified:** `services/games/package.json`, `services/wallets/package.json`, `bun.lock`
- **Commit:** `da03b18` (combined with Task 3 commit)

### Auth gates

None. Entire run was offline against the local docker stack (only authn
involved was the smoke-health Keycloak password grant for the demo `player`
user — already provisioned by Phase 1).

---

## Checkpoint outcome (Task 4)

Required four rebuild cycles due to deviations 1-3 above. Each deviation
was diagnosed from container logs and resolved with a targeted fix in
`packages/messaging-spine`. The fourth cycle came up clean:

- `bun run docker:up` → all containers Healthy, both migrate containers exit 0
- `bun run smoke:health` → 22/22 PASS (7 baseline + 15 new)
- RabbitMQ management API confirms quorum queues with correct arguments
- Postgres `psql` confirms tables + trigger + function in both DBs

No drift detected. No PRECONDITION_FAILED. Topology fully matches the
TopologyConfig declared in each AppModule.

---

## Known Stubs

None. Every artefact in this plan is live and exercised end-to-end by
docker:up. Phase 3 wallet handlers can immediately start writing to the
outbox; OutboxPublisher is already polling (empty) every 1s on both
services.

---

## Threat Flags

None. The plan's `<threat_model>` enumerated four threats (T-02-23 through
T-02-26); each is mitigated structurally:

- **T-02-23** (topology drift): routing keys + queue/exchange names flow
  exclusively from `EXCHANGES`/`QUEUES` constants in topology-defaults.
- **T-02-24** (DLQ persist failure): DLQ has x-delivery-limit=3; after
  three failed persist attempts the broker drops the message and logs warn.
- **T-02-25** (workspace symlink missing in container): proven not to happen
  by the Task 4 docker:up smoke (migrations successfully readFileSync the SQL).
- **T-02-26** (.env in git): Phase 1 .gitignore already covers `.env` files;
  verified by `git status` showing only `.env.example` changes.

---

## Commits

| Commit    | Task   | Description                                                                  |
| --------- | ------ | ---------------------------------------------------------------------------- |
| `1c50caa` | Task 1 | env schemas + mikro-orm.config.ts entity registration                        |
| `18d1a26` | Task 2 | six MikroORM migrations sourcing shared SQL                                  |
| `da03b18` | Task 3 | MessagingSpineModule + DLQ consumers + @types/amqplib                        |
| `f239cb6` | Task 4 | extend smoke-health with table + topology probes                             |
| `b8f6f03` | Task 4 | three fixes against messaging-spine (subpath exports, options module, topology in RabbitMQConfig) |

---

## Self-Check: PASSED

Files exist on disk:
- `services/games/src/infrastructure/mikro-orm/migrations/20260524001-create-outbox.ts` — FOUND
- `services/games/src/infrastructure/mikro-orm/migrations/20260524002-create-inbox.ts` — FOUND
- `services/games/src/infrastructure/mikro-orm/migrations/20260524003-create-dead-letter-messages.ts` — FOUND
- `services/wallets/src/infrastructure/mikro-orm/migrations/20260524001-create-outbox.ts` — FOUND
- `services/wallets/src/infrastructure/mikro-orm/migrations/20260524002-create-inbox.ts` — FOUND
- `services/wallets/src/infrastructure/mikro-orm/migrations/20260524003-create-dead-letter-messages.ts` — FOUND
- `services/games/src/infrastructure/messaging/games-dead-letter.consumer.ts` — FOUND
- `services/wallets/src/infrastructure/messaging/wallets-dead-letter.consumer.ts` — FOUND
- `.planning/phases/02-outbox-inbox-spine/02-07-SUMMARY.md` — FOUND (this file)

Commits exist in git log (verified via `git log --oneline -10`):
- `1c50caa feat(02-07): register messaging entities and add OUTBOX_POLL_BATCH_SIZE env` — FOUND
- `18d1a26 feat(02-07): add six MikroORM migrations sourcing shared SQL fragments` — FOUND
- `da03b18 feat(02-07): wire MessagingSpineModule and per-service DeadLetterConsumer` — FOUND
- `f239cb6 feat(02-07): extend smoke-health with outbox/inbox/DLQ + rabbitmq topology probes` — FOUND
- `b8f6f03 fix(02-07): expose SQL fragments via subpath exports and hoist messaging options module` — FOUND
