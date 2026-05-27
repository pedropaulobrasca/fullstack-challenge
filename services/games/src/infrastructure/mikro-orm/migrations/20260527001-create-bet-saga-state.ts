import { Migration } from "@mikro-orm/migrations";

export class Migration20260527001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE bet_saga_state (
        bet_id          UUID PRIMARY KEY REFERENCES bets(id) ON DELETE CASCADE,
        correlation_id  TEXT NOT NULL,
        status          TEXT NOT NULL CONSTRAINT bet_saga_state_status_check CHECK (status IN ('DEBIT_PENDING','CONFIRMED','REFUNDED','TIMED_OUT','COMPENSATED')),
        deadline_at     TIMESTAMPTZ NOT NULL,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    this.addSql(
      `CREATE UNIQUE INDEX bet_saga_state_correlation_id_idx ON bet_saga_state(correlation_id);`,
    );
    this.addSql(
      `CREATE INDEX bet_saga_state_deadline_idx ON bet_saga_state(deadline_at) WHERE status = 'DEBIT_PENDING';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS bet_saga_state CASCADE;`);
  }
}
