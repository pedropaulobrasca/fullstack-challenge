import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Module, type INestApplication, type Type } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { EntityManager } from "@mikro-orm/postgresql";
import { Test } from "@nestjs/testing";
import { Client as PgClient } from "pg";
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from "testcontainers";

import { MessagingSpineModule } from "../../../src/module";
import { OutboxRepository } from "../../../src/outbox/outbox-repository";
import { InboxRepository } from "../../../src/inbox/inbox-repository";
import { DeadLetterRepository } from "../../../src/dead-letter/dead-letter-repository";
import { MessagingProbeSchema } from "./messaging-probe.entity";
import { createProbeMikroOrmConfig } from "./probe-mikro-orm.config";

export interface TestHarness {
  app: INestApplication;
  em: EntityManager;
  outboxRepo: OutboxRepository;
  inboxRepo: InboxRepository;
  deadLetterRepo: DeadLetterRepository;
  pgContainer: StartedTestContainer;
  rmqContainer: StartedTestContainer;
  amqpUrl: string;
  databaseUrl: string;
  teardown: () => Promise<void>;
}

export interface BootHarnessOptions {
  extraProviders?: Array<Type<unknown>>;
  pollIntervalMs?: number;
}

const SHARED_SQL_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "migrations",
  "shared",
);

const PROBE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messaging_probe (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  side_effect_count INT NOT NULL DEFAULT 0
);
`;

async function runMigrations(connectionString: string): Promise<void> {
  const fragments = [
    readFileSync(join(SHARED_SQL_DIR, "001-outbox.sql"), "utf8"),
    readFileSync(join(SHARED_SQL_DIR, "002-inbox.sql"), "utf8"),
    readFileSync(join(SHARED_SQL_DIR, "003-dead-letter-messages.sql"), "utf8"),
    PROBE_TABLE_SQL,
  ];

  const client = new PgClient({ connectionString });
  await client.connect();
  try {
    for (const sql of fragments) {
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

export async function bootHarness(
  options: BootHarnessOptions = {},
): Promise<TestHarness> {
  const pgContainer = await new GenericContainer("postgres:18-alpine")
    .withEnvironment({
      POSTGRES_DB: "messaging_test",
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/, 2),
    )
    .withStartupTimeout(120_000)
    .start();

  const rmqContainer = await new GenericContainer(
    "rabbitmq:4.2.4-management-alpine",
  )
    .withExposedPorts(5672, 15672)
    .withWaitStrategy(Wait.forLogMessage(/Server startup complete/, 1))
    .withStartupTimeout(120_000)
    .start();

  const pgHost = pgContainer.getHost();
  const pgPort = pgContainer.getMappedPort(5432);
  const rmqHost = rmqContainer.getHost();
  const rmqPort = rmqContainer.getMappedPort(5672);

  const databaseUrl = `postgres://test:test@${pgHost}:${pgPort}/messaging_test`;
  const amqpUrl = `amqp://guest:guest@${rmqHost}:${rmqPort}`;

  await runMigrations(databaseUrl);

  const extraProviders = options.extraProviders ?? [];
  const pollIntervalMs = options.pollIntervalMs ?? 1000;

  @Module({
    imports: [
      MikroOrmModule.forRoot(createProbeMikroOrmConfig(databaseUrl)),
      MikroOrmModule.forFeature([MessagingProbeSchema]),
      MessagingSpineModule.forRootAsync({
        useFactory: () => ({
          amqpUrl,
          databaseUrl,
          serviceName: "test",
          outbox: { pollIntervalMs, batchSize: 100 },
          topology: {
            exchangesToAssert: [
              { name: "wallet.events", type: "topic", durable: true },
              { name: "wallet.dlx", type: "fanout", durable: true },
            ],
            queuesToAssert: [
              { name: "test.q", deliveryLimit: 5, dlx: "wallet.dlx" },
              { name: "test.dlq", deliveryLimit: 3 },
            ],
            bindings: [
              { queue: "test.q", exchange: "wallet.events", routingKey: "test.*" },
              { queue: "test.dlq", exchange: "wallet.dlx", routingKey: "" },
            ],
          },
        }),
      }),
    ],
    providers: extraProviders,
    exports: extraProviders,
  })
  class HarnessTestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [HarnessTestModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.enableShutdownHooks();
  await app.init();

  const em = app.get<EntityManager>(EntityManager).fork();
  const outboxRepo = app.get(OutboxRepository);
  const inboxRepo = app.get(InboxRepository);
  const deadLetterRepo = app.get(DeadLetterRepository);

  const teardown = async (): Promise<void> => {
    await app.close().catch(() => undefined);
    await rmqContainer.stop().catch(() => undefined);
    await pgContainer.stop().catch(() => undefined);
  };

  return {
    app,
    em,
    outboxRepo,
    inboxRepo,
    deadLetterRepo,
    pgContainer,
    rmqContainer,
    amqpUrl,
    databaseUrl,
    teardown,
  };
}

export async function shutdownHarness(h: TestHarness): Promise<void> {
  await h.teardown();
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

export async function withPgClient<T>(
  connectionString: string,
  fn: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = new PgClient({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
