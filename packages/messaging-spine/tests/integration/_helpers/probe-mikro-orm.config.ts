import { defineConfig } from "@mikro-orm/postgresql";
import {
  OutboxMessageSchema,
  InboxMessageSchema,
  DeadLetterMessageSchema,
} from "../../../src";
import { MessagingProbeSchema } from "./messaging-probe.entity";

export function createProbeMikroOrmConfig(connectionString: string) {
  return defineConfig({
    clientUrl: connectionString,
    entities: [
      OutboxMessageSchema,
      InboxMessageSchema,
      DeadLetterMessageSchema,
      MessagingProbeSchema,
    ],
    entitiesTs: [
      OutboxMessageSchema,
      InboxMessageSchema,
      DeadLetterMessageSchema,
      MessagingProbeSchema,
    ],
    allowGlobalContext: true,
    discovery: { warnWhenNoEntities: false },
  });
}
