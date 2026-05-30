import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { env } from "../../config/defaults";

const AUTO_BET_MIN_TARGET_X = env.AUTO_BET_MIN_TARGET_CENTI_X / 100;
const AUTO_BET_MAX_TARGET_X = env.AUTO_CASHOUT_MAX_X;

export const placeBetRequestSchema = z
  .object({
    amountCents: z
      .string()
      .regex(/^\d+$/, "amountCents must be a non-negative integer string")
      .transform((raw) => BigInt(raw)),
    autoCashoutTarget: z
      .number()
      .positive()
      .min(AUTO_BET_MIN_TARGET_X)
      .max(AUTO_BET_MAX_TARGET_X)
      .optional(),
  })
  .strict();

export class PlaceBetRequestDto extends createZodDto(placeBetRequestSchema) {}
