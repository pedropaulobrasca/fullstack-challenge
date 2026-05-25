import { Migration } from "@mikro-orm/migrations";

export class Migration20260525001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY,
        player_id TEXT NOT NULL UNIQUE,
        balance_cents BIGINT NOT NULL,
        currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT wallets_balance_non_negative CHECK (balance_cents >= 0)
      );
    `);
    this.addSql(`CREATE INDEX wallets_player_id_idx ON wallets(player_id);`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS wallets CASCADE;`);
  }
}
