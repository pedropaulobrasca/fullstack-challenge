import { EntitySchema } from "@mikro-orm/core";

export class BetSagaStateRow {
  betId!: string;
  correlationId!: string;
  status!: string;
  deadlineAt!: Date;
  updatedAt!: Date;
}

export const BetSagaStateEntitySchema = new EntitySchema<BetSagaStateRow>({
  class: BetSagaStateRow,
  tableName: "bet_saga_state",
  properties: {
    betId: { type: "uuid", fieldName: "bet_id", primary: true },
    correlationId: { type: "string", fieldName: "correlation_id" },
    status: { type: "string", fieldName: "status" },
    deadlineAt: { type: "Date", fieldName: "deadline_at" },
    updatedAt: {
      type: "Date",
      fieldName: "updated_at",
      defaultRaw: "now()",
      onUpdate: () => new Date(),
    },
  },
});
