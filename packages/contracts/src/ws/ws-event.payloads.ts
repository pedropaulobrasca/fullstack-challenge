import { z } from "zod";
import { moneySnapshotSchema } from "../money/snapshot";

const roundStatusSchema = z.enum(["BETTING", "RUNNING", "CRASHED", "SETTLED"]);
const betStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "CASHED_OUT",
  "LOST",
  "REFUNDED",
]);

const roundShapeSchema = z
  .object({
    id: z.string().min(1),
    status: roundStatusSchema,
    nonce: z.string(),
    seedHash: z.string().length(64),
    clientSeed: z.string().min(1),
    bettingEndsAt: z.string(),
    startedAt: z.string().nullable(),
    crashedAt: z.string().nullable(),
    settledAt: z.string().nullable(),
    crashPoint: z.number().positive().nullable(),
    serverSeed: z.string().nullable(),
  })
  .strict();

const activeBetEntrySchema = z
  .object({
    betId: z.string().min(1),
    playerIdMasked: z.string().regex(/^[0-9a-f]{8}$/),
    amount: moneySnapshotSchema,
  })
  .strict();

const myBetEntrySchema = z
  .object({
    betId: z.string().min(1),
    amount: moneySnapshotSchema,
    status: betStatusSchema,
    cashoutMultiplier: z.number().positive().nullable(),
  })
  .strict();

export const roundSnapshotObjectSchema = z
  .object({
    round: roundShapeSchema,
    activeBets: z.array(activeBetEntrySchema),
    myBet: myBetEntrySchema.nullable(),
    serverTime: z.number().int().nonnegative(),
  })
  .strict();

export const roundSnapshotPayloadSchema = roundSnapshotObjectSchema.nullable();

export type RoundSnapshotObject = z.infer<typeof roundSnapshotObjectSchema>;
export type RoundSnapshotPayload = z.infer<typeof roundSnapshotPayloadSchema>;

export const roundStartedPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    nonce: z.string(),
    seedHash: z.string().length(64),
    bettingEndsAt: z.string(),
  })
  .strict();

export type RoundStartedPayload = z.infer<typeof roundStartedPayloadSchema>;

export const roundRunningPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    startedAt: z.string(),
  })
  .strict();

export type RoundRunningPayload = z.infer<typeof roundRunningPayloadSchema>;

export const roundCrashedPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    crashPoint: z.number().positive(),
    crashedAt: z.string(),
  })
  .strict();

export type RoundCrashedPayload = z.infer<typeof roundCrashedPayloadSchema>;

export const roundSettledPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    serverSeed: z.string().min(1),
    settledAt: z.string(),
  })
  .strict();

export type RoundSettledPayload = z.infer<typeof roundSettledPayloadSchema>;

export const roundTickPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    multiplier: z.number().positive(),
    t: z.number().int().nonnegative(),
  })
  .strict();

export type RoundTickPayload = z.infer<typeof roundTickPayloadSchema>;

export const betPlacedPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    betId: z.string().min(1),
    playerIdMasked: z.string().regex(/^[0-9a-f]{8}$/),
    amount: moneySnapshotSchema,
  })
  .strict();

export type BetPlacedPayload = z.infer<typeof betPlacedPayloadSchema>;

export const betMyActivePayloadSchema = z
  .object({
    roundId: z.string().min(1),
    betId: z.string().min(1),
    amount: moneySnapshotSchema,
  })
  .strict();

export type BetMyActivePayload = z.infer<typeof betMyActivePayloadSchema>;

export const betMyRefundedPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    betId: z.string().min(1),
    amount: moneySnapshotSchema,
    reason: z.string().min(1),
  })
  .strict();

export type BetMyRefundedPayload = z.infer<typeof betMyRefundedPayloadSchema>;

export const betMyCashedOutPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    betId: z.string().min(1),
    multiplier: z.number().positive(),
    payout: moneySnapshotSchema,
  })
  .strict();

export type BetMyCashedOutPayload = z.infer<typeof betMyCashedOutPayloadSchema>;

export const betCashedOutPayloadSchema = z
  .object({
    roundId: z.string().min(1),
    betId: z.string().min(1),
    playerIdMasked: z.string().regex(/^[0-9a-f]{8}$/),
    multiplier: z.number().positive(),
  })
  .strict();

export type BetCashedOutPayload = z.infer<typeof betCashedOutPayloadSchema>;
