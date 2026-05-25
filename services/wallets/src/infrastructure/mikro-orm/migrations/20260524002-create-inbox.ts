import { Migration } from "@mikro-orm/migrations";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export class Migration20260524002 extends Migration {
  override async up(): Promise<void> {
    const sqlPath = require.resolve(
      "@crash/messaging-spine/src/migrations/shared/002-inbox.sql",
    );
    const sql = readFileSync(sqlPath, "utf8");
    this.addSql(sql);
  }

  override async down(): Promise<void> {
    this.addSql("DROP TABLE IF EXISTS inbox");
  }
}
