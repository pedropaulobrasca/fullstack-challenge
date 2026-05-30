import { Migration } from "@mikro-orm/migrations";

export class Migration20260530002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `CREATE TABLE leaderboard_24h (
         player_id UUID PRIMARY KEY,
         net_profit_cents BIGINT NOT NULL DEFAULT 0,
         win_count INT NOT NULL DEFAULT 0 CHECK (win_count >= 0),
         total_bet_count INT NOT NULL DEFAULT 0 CHECK (total_bet_count >= 0),
         last_settled_at TIMESTAMPTZ NOT NULL
       );`,
    );
    this.addSql(
      `COMMENT ON TABLE leaderboard_24h IS 'Denormalized read model for the 24h leaderboard. Window filtering happens at query time via WHERE last_settled_at > NOW() - INTERVAL ''N hours''. Partial-index predicates with NOW() are not allowed by Postgres (IMMUTABLE-only).';`,
    );
    this.addSql(
      `CREATE INDEX idx_leaderboard_24h_profit_desc ON leaderboard_24h (net_profit_cents DESC, player_id);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS idx_leaderboard_24h_profit_desc;`);
    this.addSql(`DROP TABLE IF EXISTS leaderboard_24h;`);
  }
}
