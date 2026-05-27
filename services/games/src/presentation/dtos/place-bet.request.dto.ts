import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const placeBetRequestSchema = z
  .object({
    amountCents: z
      .string()
      .regex(/^\d+$/, "amountCents must be a non-negative integer string")
      .transform((raw) => BigInt(raw)),
  })
  .strict();

export class PlaceBetRequestDto extends createZodDto(placeBetRequestSchema) {}
