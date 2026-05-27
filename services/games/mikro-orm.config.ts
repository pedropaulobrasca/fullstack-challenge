import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import {
  OutboxMessageSchema,
  InboxMessageSchema,
  DeadLetterMessageSchema,
} from "@crash/messaging-spine";
import { SeedChainEntitySchema } from "./src/infrastructure/persistence/seed-chain.entity";
import { RoundEntitySchema } from "./src/infrastructure/persistence/round.entity";
import { BetEntitySchema } from "./src/infrastructure/persistence/bet.entity";
import { BetSagaStateEntitySchema } from "./src/infrastructure/persistence/bet-saga-state.entity";

export default defineConfig({
  clientUrl: process.env.DATABASE_URL ?? "",
  entities: [
    OutboxMessageSchema,
    InboxMessageSchema,
    DeadLetterMessageSchema,
    SeedChainEntitySchema,
    RoundEntitySchema,
    BetEntitySchema,
    BetSagaStateEntitySchema,
  ],
  entitiesTs: [
    OutboxMessageSchema,
    InboxMessageSchema,
    DeadLetterMessageSchema,
    SeedChainEntitySchema,
    RoundEntitySchema,
    BetEntitySchema,
    BetSagaStateEntitySchema,
  ],
  migrations: {
    path: "./src/infrastructure/mikro-orm/migrations",
    pathTs: "./src/infrastructure/mikro-orm/migrations",
    tableName: "mikro_orm_migrations",
    transactional: true,
    emit: "ts",
    snapshot: false,
  },
  allowGlobalContext: true,
  extensions: [Migrator],
});
