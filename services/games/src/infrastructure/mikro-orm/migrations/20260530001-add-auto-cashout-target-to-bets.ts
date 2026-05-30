import { Migration } from "@mikro-orm/migrations";

export class Migration20260530001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE bets ADD COLUMN auto_cashout_target_centi_x INT NULL CHECK (auto_cashout_target_centi_x IS NULL OR auto_cashout_target_centi_x >= 101);`,
    );
    this.addSql(
      `CREATE INDEX idx_bets_auto_cashout_candidates ON bets (round_id, auto_cashout_target_centi_x) WHERE status = 'ACTIVE' AND auto_cashout_target_centi_x IS NOT NULL;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_bets_auto_cashout_candidates;`);
    this.addSql(`ALTER TABLE bets DROP COLUMN IF EXISTS auto_cashout_target_centi_x;`);
  }
}
