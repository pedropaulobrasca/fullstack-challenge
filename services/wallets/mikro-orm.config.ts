import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import {
  OutboxMessageSchema,
  InboxMessageSchema,
  DeadLetterMessageSchema,
} from "@crash/messaging-spine";
import { WalletEntitySchema } from "./src/infrastructure/persistence/wallet.entity";
import { TransactionEntitySchema } from "./src/infrastructure/persistence/transaction.entity";

export default defineConfig({
  clientUrl: process.env.DATABASE_URL ?? "",
  entities: [
    OutboxMessageSchema,
    InboxMessageSchema,
    DeadLetterMessageSchema,
    WalletEntitySchema,
    TransactionEntitySchema,
  ],
  entitiesTs: [
    OutboxMessageSchema,
    InboxMessageSchema,
    DeadLetterMessageSchema,
    WalletEntitySchema,
    TransactionEntitySchema,
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
