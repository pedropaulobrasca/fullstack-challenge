import { EntitySchema } from '@mikro-orm/core';

export class InboxMessage {
  consumerName!: string;
  messageId!: string;
  messageType!: string;
  receivedAt!: Date;
  processedAt?: Date;
  payloadHash?: string;
}

export const InboxMessageSchema = new EntitySchema<InboxMessage>({
  class: InboxMessage,
  tableName: 'inbox',
  properties: {
    consumerName: { type: 'string', fieldName: 'consumer_name', primary: true },
    messageId: { type: 'uuid', fieldName: 'message_id', primary: true },
    messageType: { type: 'string', fieldName: 'message_type' },
    receivedAt: { type: 'Date', fieldName: 'received_at', defaultRaw: 'now()' },
    processedAt: { type: 'Date', fieldName: 'processed_at', nullable: true },
    payloadHash: { type: 'string', fieldName: 'payload_hash', nullable: true },
  },
  indexes: [
    {
      name: 'inbox_received_at_idx',
      properties: ['receivedAt'],
    },
  ],
});
