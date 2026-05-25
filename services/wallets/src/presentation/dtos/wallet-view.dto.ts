import { moneySnapshotSchema } from "@crash/contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const walletViewSchema = z
  .object({
    id: z.string().uuid(),
    playerId: z.string(),
    balance: moneySnapshotSchema,
    currency: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export class WalletViewDto extends createZodDto(walletViewSchema) {}
