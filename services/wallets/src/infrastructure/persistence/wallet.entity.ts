import { BigIntType, EntitySchema } from "@mikro-orm/core";

export class WalletRow {
  id!: string;
  playerId!: string;
  balanceCents!: bigint;
  currencyCode!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletEntitySchema = new EntitySchema<WalletRow>({
  class: WalletRow,
  tableName: "wallets",
  properties: {
    id: { type: "uuid", primary: true },
    playerId: { type: "string", fieldName: "player_id", unique: true },
    balanceCents: { type: new BigIntType(), fieldName: "balance_cents" },
    currencyCode: { type: "string", fieldName: "currency_code", length: 3 },
    createdAt: {
      type: "Date",
      fieldName: "created_at",
      defaultRaw: "now()",
      onCreate: () => new Date(),
    },
    updatedAt: {
      type: "Date",
      fieldName: "updated_at",
      defaultRaw: "now()",
      onCreate: () => new Date(),
      onUpdate: () => new Date(),
    },
  },
});
