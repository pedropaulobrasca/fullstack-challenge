import { BigIntType, EntitySchema } from "@mikro-orm/core";

export type TransactionKind = "DEBIT" | "CREDIT";

export class TransactionRow {
  id!: string;
  walletId!: string;
  playerId!: string;
  kind!: TransactionKind;
  amountCents!: bigint;
  currencyCode!: string;
  previousBalanceCents!: bigint;
  newBalanceCents!: bigint;
  correlationId!: string;
  messageId!: string;
  appliedAt!: Date;
}

export const TransactionEntitySchema = new EntitySchema<TransactionRow>({
  class: TransactionRow,
  tableName: "transactions",
  properties: {
    id: { type: "uuid", primary: true },
    walletId: { type: "uuid", fieldName: "wallet_id" },
    playerId: { type: "string", fieldName: "player_id" },
    kind: { type: "string", fieldName: "kind" },
    amountCents: { type: new BigIntType(), fieldName: "amount_cents" },
    currencyCode: { type: "string", fieldName: "currency_code", length: 3 },
    previousBalanceCents: {
      type: new BigIntType(),
      fieldName: "previous_balance_cents",
    },
    newBalanceCents: {
      type: new BigIntType(),
      fieldName: "new_balance_cents",
    },
    correlationId: { type: "string", fieldName: "correlation_id" },
    messageId: { type: "string", fieldName: "message_id", unique: true },
    appliedAt: {
      type: "Date",
      fieldName: "applied_at",
      defaultRaw: "now()",
    },
  },
  indexes: [
    {
      name: "transactions_wallet_id_applied_at_idx",
      properties: ["walletId", "appliedAt"],
    },
    {
      name: "transactions_correlation_id_idx",
      properties: ["correlationId"],
    },
  ],
});
