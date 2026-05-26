import { Migration } from "@mikro-orm/migrations";

export class Migration20260526003 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE bets (
        id UUID PRIMARY KEY,
        round_id UUID NOT NULL REFERENCES rounds(id),
        player_id TEXT NOT NULL,
        amount_cents BIGINT NOT NULL CHECK (amount_cents >= 100 AND amount_cents <= 100000),
        currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
        status TEXT NOT NULL CHECK (status IN ('PENDING','ACTIVE','CASHED_OUT','LOST','REFUNDED')),
        cashed_out_at TIMESTAMPTZ NULL,
        cashed_out_multiplier_centi_x INT NULL,
        payout_cents BIGINT NULL CHECK (payout_cents IS NULL OR payout_cents >= 0),
        refund_reason TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT bets_status_state_consistency_check CHECK (
          (status IN ('PENDING','ACTIVE','REFUNDED','LOST')
            AND cashed_out_at IS NULL
            AND cashed_out_multiplier_centi_x IS NULL
            AND payout_cents IS NULL)
          OR
          (status = 'CASHED_OUT'
            AND cashed_out_at IS NOT NULL
            AND cashed_out_multiplier_centi_x IS NOT NULL
            AND payout_cents IS NOT NULL)
        )
      );
    `);
    this.addSql(
      `CREATE UNIQUE INDEX bets_one_active_per_player ON bets(player_id, round_id) WHERE status IN ('PENDING','ACTIVE');`,
    );
    this.addSql(
      `CREATE INDEX bets_player_history_idx ON bets(player_id, created_at DESC);`,
    );
    this.addSql(
      `CREATE INDEX bets_round_active_idx ON bets(round_id) WHERE status IN ('PENDING','ACTIVE');`,
    );
    this.addSql(
      `CREATE INDEX bets_round_player_status_idx ON bets(player_id, round_id, status);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS bets CASCADE;`);
  }
}
