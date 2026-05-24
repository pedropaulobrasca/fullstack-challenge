// Phase 1 baseline — entities are intentionally empty. Phase 3 registers Wallet + Transaction; Phase 4 registers Round + Bet; Phase 2 registers OutboxMessage + InboxMessage.
import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";

export default defineConfig({
  clientUrl: process.env.DATABASE_URL ?? "",
  entities: [],
  entitiesTs: [],
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
