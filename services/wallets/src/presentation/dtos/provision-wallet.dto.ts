import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const provisionWalletRequestSchema = z.object({}).strict();

export class ProvisionWalletRequestDto extends createZodDto(provisionWalletRequestSchema) {}
