import { Migration } from "@mikro-orm/migrations";

export class Migration20260526002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE rounds (
        id UUID PRIMARY KEY,
        nonce BIGINT NOT NULL UNIQUE REFERENCES seed_chain(nonce),
        status TEXT NOT NULL CHECK (status IN ('BETTING','RUNNING','CRASHED','SETTLED')),
        seed_hash TEXT NOT NULL,
        client_seed TEXT NOT NULL,
        server_seed TEXT NULL,
        crash_point_centi_x INT NULL,
        formula_version INT NOT NULL,
        betting_ends_at TIMESTAMPTZ NOT NULL,
        started_at TIMESTAMPTZ NULL,
        crashed_at TIMESTAMPTZ NULL,
        settled_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT rounds_fsm_check CHECK (
          (status = 'BETTING'
            AND started_at IS NULL
            AND crash_point_centi_x IS NULL
            AND server_seed IS NULL
            AND crashed_at IS NULL
            AND settled_at IS NULL)
          OR
          (status = 'RUNNING'
            AND started_at IS NOT NULL
            AND crash_point_centi_x IS NULL
            AND server_seed IS NULL
            AND crashed_at IS NULL
            AND settled_at IS NULL)
          OR
          (status = 'CRASHED'
            AND started_at IS NOT NULL
            AND crash_point_centi_x IS NOT NULL
            AND server_seed IS NULL
            AND crashed_at IS NOT NULL
            AND settled_at IS NULL)
          OR
          (status = 'SETTLED'
            AND started_at IS NOT NULL
            AND crash_point_centi_x IS NOT NULL
            AND server_seed IS NOT NULL
            AND crashed_at IS NOT NULL
            AND settled_at IS NOT NULL)
        )
      );
    `);
    this.addSql(
      `CREATE INDEX rounds_status_idx ON rounds(status) WHERE status IN ('BETTING','RUNNING','CRASHED');`,
    );
    this.addSql(
      `CREATE INDEX rounds_history_idx ON rounds(settled_at DESC) WHERE status = 'SETTLED';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS rounds CASCADE;`);
  }
}
