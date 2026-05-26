import { BigIntType, EntitySchema } from "@mikro-orm/core";

export class SeedChainRow {
  nonce!: bigint;
  hash!: string;
  seed!: string | null;
  revealedAt!: Date | null;
  createdAt!: Date;
}

export const SeedChainEntitySchema = new EntitySchema<SeedChainRow>({
  class: SeedChainRow,
  tableName: "seed_chain",
  properties: {
    nonce: { type: new BigIntType(), primary: true },
    hash: { type: "string" },
    seed: { type: "string", nullable: true },
    revealedAt: { type: "Date", fieldName: "revealed_at", nullable: true },
    createdAt: {
      type: "Date",
      fieldName: "created_at",
      defaultRaw: "now()",
      onCreate: () => new Date(),
    },
  },
});
