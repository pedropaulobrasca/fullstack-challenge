import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";

@Injectable()
export class InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async tryClaim(
    consumerName: string,
    messageId: string,
    messageType: string,
  ): Promise<boolean> {
    const rows = await this.em.getConnection().execute<Array<{ message_id: string }>>(
      "INSERT INTO inbox (consumer_name, message_id, message_type, received_at) VALUES (?, ?, ?, now()) ON CONFLICT (consumer_name, message_id) DO NOTHING RETURNING message_id",
      [consumerName, messageId, messageType],
    );
    return rows.length === 1;
  }

  async markProcessed(consumerName: string, messageId: string): Promise<void> {
    await this.em.getConnection().execute(
      "UPDATE inbox SET processed_at = now() WHERE consumer_name = ? AND message_id = ?",
      [consumerName, messageId],
    );
  }
}
