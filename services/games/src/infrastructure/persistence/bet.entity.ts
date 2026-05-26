import { BigIntType, EntitySchema } from "@mikro-orm/core";

export class BetRow {
  id!: string;
  roundId!: string;
  playerId!: string;
  amountCents!: bigint;
  currencyCode!: string;
  status!: string;
  cashedOutAt!: Date | null;
  cashedOutMultiplierCentiX!: number | null;
  payoutCents!: bigint | null;
  refundReason!: string | null;
  createdAt!: Date;
}

export const BetEntitySchema = new EntitySchema<BetRow>({
  class: BetRow,
  tableName: "bets",
  properties: {
    id: { type: "uuid", primary: true },
    roundId: { type: "uuid", fieldName: "round_id" },
    playerId: { type: "string", fieldName: "player_id" },
    amountCents: { type: new BigIntType(), fieldName: "amount_cents" },
    currencyCode: { type: "string", fieldName: "currency_code", length: 3 },
    status: { type: "string" },
    cashedOutAt: { type: "Date", fieldName: "cashed_out_at", nullable: true },
    cashedOutMultiplierCentiX: {
      type: "integer",
      fieldName: "cashed_out_multiplier_centi_x",
      nullable: true,
    },
    payoutCents: {
      type: new BigIntType(),
      fieldName: "payout_cents",
      nullable: true,
    },
    refundReason: { type: "string", fieldName: "refund_reason", nullable: true },
    createdAt: {
      type: "Date",
      fieldName: "created_at",
      defaultRaw: "now()",
      onCreate: () => new Date(),
    },
  },
});
