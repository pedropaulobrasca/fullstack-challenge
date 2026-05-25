import { EntitySchema } from '@mikro-orm/core';
import type { OutboxStatus } from './outbox-status';

export class OutboxMessage {
  id!: string;
  messageId!: string;
  aggregateType!: string;
  aggregateId!: string;
  eventType!: string;
  eventVersion: number = 1;
  exchange!: string;
  routingKey!: string;
  payload!: Record<string, unknown>;
  headers!: Record<string, unknown>;
  status: OutboxStatus = 'PENDING';
  attempts: number = 0;
  lastError?: string;
  createdAt!: Date;
  publishedAt?: Date;
  lastAttemptAt?: Date;
}

export const OutboxMessageSchema = new EntitySchema<OutboxMessage>({
  class: OutboxMessage,
  tableName: 'outbox',
  properties: {
    id: { type: 'bigint', primary: true },
    messageId: { type: 'uuid', fieldName: 'message_id', unique: true },
    aggregateType: { type: 'string', fieldName: 'aggregate_type' },
    aggregateId: { type: 'string', fieldName: 'aggregate_id' },
    eventType: { type: 'string', fieldName: 'event_type' },
    eventVersion: { type: 'int', fieldName: 'event_version', default: 1 },
    exchange: { type: 'string', fieldName: 'exchange' },
    routingKey: { type: 'string', fieldName: 'routing_key' },
    payload: { type: 'json', fieldName: 'payload' },
    headers: { type: 'json', fieldName: 'headers' },
    status: { type: 'string', fieldName: 'status', default: 'PENDING' },
    attempts: { type: 'int', fieldName: 'attempts', default: 0 },
    lastError: { type: 'text', fieldName: 'last_error', nullable: true },
    createdAt: { type: 'Date', fieldName: 'created_at', defaultRaw: 'now()' },
    publishedAt: { type: 'Date', fieldName: 'published_at', nullable: true },
    lastAttemptAt: { type: 'Date', fieldName: 'last_attempt_at', nullable: true },
  },
  indexes: [
    {
      name: 'outbox_pending_idx',
      properties: ['createdAt'],
      where: "status = 'PENDING'",
    },
  ],
});
