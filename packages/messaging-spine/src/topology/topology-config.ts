import { z } from "zod";

export const topologyConfigSchema = z.object({
  exchangesToAssert: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["direct", "topic", "fanout"]),
      durable: z.boolean().default(true),
    }),
  ),
  queuesToAssert: z.array(
    z.object({
      name: z.string(),
      deliveryLimit: z.number().int().positive(),
      dlx: z.string().optional(),
    }),
  ),
  bindings: z.array(
    z.object({
      queue: z.string(),
      exchange: z.string(),
      routingKey: z.string(),
    }),
  ),
});

export type TopologyConfig = z.infer<typeof topologyConfigSchema>;
