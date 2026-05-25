import type { TopologyConfig } from "../topology/topology-config";

export const MESSAGING_OPTIONS = Symbol('MESSAGING_OPTIONS');

export interface MessagingOptions {
  amqpUrl: string;
  databaseUrl: string;
  serviceName: string;
  outbox: {
    pollIntervalMs: number;
    batchSize: number;
    notifyChannel?: string;
  };
  topology: TopologyConfig;
}
