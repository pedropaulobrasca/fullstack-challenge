import { Migration } from "@mikro-orm/migrations";

export class Migration20260526001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE seed_chain (
        nonce BIGINT PRIMARY KEY,
        hash TEXT NOT NULL,
        seed TEXT NULL,
        revealed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE INDEX seed_chain_unrevealed_idx ON seed_chain(nonce) WHERE seed IS NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS seed_chain CASCADE;`);
  }
}
