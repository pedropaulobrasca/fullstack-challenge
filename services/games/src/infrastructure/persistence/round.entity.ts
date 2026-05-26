import { BigIntType, EntitySchema } from "@mikro-orm/core";

export class RoundRow {
  id!: string;
  nonce!: bigint;
  status!: string;
  seedHash!: string;
  clientSeed!: string;
  serverSeed!: string | null;
  crashPointCentiX!: number | null;
  formulaVersion!: number;
  bettingEndsAt!: Date;
  startedAt!: Date | null;
  crashedAt!: Date | null;
  settledAt!: Date | null;
  createdAt!: Date;
}

export const RoundEntitySchema = new EntitySchema<RoundRow>({
  class: RoundRow,
  tableName: "rounds",
  properties: {
    id: { type: "uuid", primary: true },
    nonce: { type: new BigIntType(), unique: true },
    status: { type: "string" },
    seedHash: { type: "string", fieldName: "seed_hash" },
    clientSeed: { type: "string", fieldName: "client_seed" },
    serverSeed: { type: "string", fieldName: "server_seed", nullable: true },
    crashPointCentiX: {
      type: "integer",
      fieldName: "crash_point_centi_x",
      nullable: true,
    },
    formulaVersion: { type: "integer", fieldName: "formula_version" },
    bettingEndsAt: { type: "Date", fieldName: "betting_ends_at" },
    startedAt: { type: "Date", fieldName: "started_at", nullable: true },
    crashedAt: { type: "Date", fieldName: "crashed_at", nullable: true },
    settledAt: { type: "Date", fieldName: "settled_at", nullable: true },
    createdAt: {
      type: "Date",
      fieldName: "created_at",
      defaultRaw: "now()",
      onCreate: () => new Date(),
    },
  },
});
