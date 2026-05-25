import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";

export interface DeadLetterRecord {
  originalMessageId: string;
  originalExchange: string;
  originalRoutingKey: string;
  originalQueue: string;
  consumerName: string;
  headers: Record<string, unknown>;
  payload: Record<string, unknown>;
  errorClass?: string;
  errorMessage?: string;
  redeliveryCount: number;
}

@Injectable()
export class DeadLetterRepository {
  constructor(private readonly em: EntityManager) {}

  async persist(record: DeadLetterRecord): Promise<void> {
    await this.em.getConnection().execute(
      "INSERT INTO dead_letter_messages (original_message_id, original_exchange, original_routing_key, original_queue, consumer_name, headers, payload, error_class, error_message, redelivery_count, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now()) ON CONFLICT (consumer_name, original_message_id) DO NOTHING",
      [
        record.originalMessageId,
        record.originalExchange,
        record.originalRoutingKey,
        record.originalQueue,
        record.consumerName,
        JSON.stringify(record.headers),
        JSON.stringify(record.payload),
        record.errorClass ?? null,
        record.errorMessage ?? null,
        record.redeliveryCount,
      ],
    );
  }
}
