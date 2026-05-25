import { Migration } from "@mikro-orm/migrations";

export class Migration20260525002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE transactions (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
        player_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('DEBIT', 'CREDIT')),
        amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
        currency_code TEXT NOT NULL,
        previous_balance_cents BIGINT NOT NULL,
        new_balance_cents BIGINT NOT NULL,
        correlation_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE INDEX transactions_wallet_id_applied_at_idx ON transactions(wallet_id, applied_at DESC);`,
    );
    this.addSql(
      `CREATE INDEX transactions_correlation_id_idx ON transactions(correlation_id);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS transactions CASCADE;`);
  }
}
