import { EntitySchema } from '@mikro-orm/core';

export class DeadLetterMessage {
  id!: string;
  originalMessageId!: string;
  originalExchange!: string;
  originalRoutingKey!: string;
  originalQueue!: string;
  consumerName!: string;
  headers!: Record<string, unknown>;
  payload!: Record<string, unknown>;
  errorClass?: string;
  errorMessage?: string;
  redeliveryCount!: number;
  receivedAt!: Date;
}

export const DeadLetterMessageSchema = new EntitySchema<DeadLetterMessage>({
  class: DeadLetterMessage,
  tableName: 'dead_letter_messages',
  properties: {
    id: { type: 'bigint', primary: true },
    originalMessageId: { type: 'uuid', fieldName: 'original_message_id' },
    originalExchange: { type: 'string', fieldName: 'original_exchange' },
    originalRoutingKey: { type: 'string', fieldName: 'original_routing_key' },
    originalQueue: { type: 'string', fieldName: 'original_queue' },
    consumerName: { type: 'string', fieldName: 'consumer_name' },
    headers: { type: 'json', fieldName: 'headers' },
    payload: { type: 'json', fieldName: 'payload' },
    errorClass: { type: 'string', fieldName: 'error_class', nullable: true },
    errorMessage: { type: 'string', fieldName: 'error_message', nullable: true },
    redeliveryCount: { type: 'int', fieldName: 'redelivery_count' },
    receivedAt: { type: 'Date', fieldName: 'received_at', defaultRaw: 'now()' },
  },
  uniques: [
    {
      name: 'dead_letter_messages_consumer_name_original_message_id_unique',
      properties: ['consumerName', 'originalMessageId'],
    },
  ],
  indexes: [
    {
      name: 'dead_letter_received_at_idx',
      properties: ['receivedAt'],
    },
  ],
});
