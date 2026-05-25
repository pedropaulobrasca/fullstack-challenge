import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import {
  OutboxMessageSchema,
  InboxMessageSchema,
  DeadLetterMessageSchema,
} from "@crash/messaging-spine";

export default defineConfig({
  clientUrl: process.env.DATABASE_URL ?? "",
  entities: [OutboxMessageSchema, InboxMessageSchema, DeadLetterMessageSchema],
  entitiesTs: [
    OutboxMessageSchema,
    InboxMessageSchema,
    DeadLetterMessageSchema,
  ],
  migrations: {
    path: "./src/infrastructure/mikro-orm/migrations",
    pathTs: "./src/infrastructure/mikro-orm/migrations",
    tableName: "mikro_orm_migrations",
    transactional: true,
    emit: "ts",
    snapshot: false,
  },
  extensions: [Migrator],
});
