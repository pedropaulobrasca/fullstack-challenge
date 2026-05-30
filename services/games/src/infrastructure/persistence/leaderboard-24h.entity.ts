import { BigIntType, EntitySchema } from "@mikro-orm/core";

export class Leaderboard24hRow {
  playerId!: string;
  netProfitCents!: bigint;
  winCount!: number;
  totalBetCount!: number;
  lastSettledAt!: Date;
}

export const Leaderboard24hEntitySchema = new EntitySchema<Leaderboard24hRow>({
  class: Leaderboard24hRow,
  tableName: "leaderboard_24h",
  properties: {
    playerId: { type: "uuid", fieldName: "player_id", primary: true },
    netProfitCents: { type: new BigIntType(), fieldName: "net_profit_cents" },
    winCount: { type: "integer", fieldName: "win_count" },
    totalBetCount: { type: "integer", fieldName: "total_bet_count" },
    lastSettledAt: { type: "Date", fieldName: "last_settled_at" },
  },
});
