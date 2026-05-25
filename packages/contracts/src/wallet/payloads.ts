import { z } from "zod";
import { moneySnapshotSchema } from "../money/snapshot";

export const walletDebitPayloadSchema = z
  .object({
    playerId: z.string().min(1),
    amount: moneySnapshotSchema,
  })
  .strict();

export const walletCreditPayloadSchema = z
  .object({
    playerId: z.string().min(1),
    amount: moneySnapshotSchema,
  })
  .strict();

export const walletDebitedPayloadSchema = z
  .object({
    walletId: z.string().uuid(),
    playerId: z.string().min(1),
    newBalance: moneySnapshotSchema,
  })
  .strict();

export const walletCreditedPayloadSchema = z
  .object({
    walletId: z.string().uuid(),
    playerId: z.string().min(1),
    newBalance: moneySnapshotSchema,
  })
  .strict();

export const walletDebitRejectedPayloadSchema = z
  .object({
    playerId: z.string().min(1),
    reason: z.enum(["INSUFFICIENT_FUNDS", "WALLET_NOT_FOUND"]),
    requested: moneySnapshotSchema,
    available: moneySnapshotSchema.optional(),
  })
  .strict();

export type WalletDebitPayload = z.infer<typeof walletDebitPayloadSchema>;
export type WalletCreditPayload = z.infer<typeof walletCreditPayloadSchema>;
export type WalletDebitedPayload = z.infer<typeof walletDebitedPayloadSchema>;
export type WalletCreditedPayload = z.infer<typeof walletCreditedPayloadSchema>;
export type WalletDebitRejectedPayload = z.infer<
  typeof walletDebitRejectedPayloadSchema
>;
