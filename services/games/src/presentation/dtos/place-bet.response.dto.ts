import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const placeBetResponseSchema = z
  .object({
    betId: z.string().uuid(),
    status: z.literal("PENDING"),
  })
  .strict();

export class PlaceBetResponseDto extends createZodDto(placeBetResponseSchema) {}
