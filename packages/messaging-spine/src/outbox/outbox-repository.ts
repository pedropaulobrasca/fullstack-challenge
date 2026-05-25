import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import type { DomainEventEnvelope } from "@crash/shared-kernel/events";
import { envelopeToAmqpHeaders } from "../envelope/envelope-headers";
import { OutboxMessage } from "./outbox-message.entity";

export interface OutboxRoute {
  exchange: string;
  routingKey: string;
  aggregateType: string;
  aggregateId: string;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  /** MUST be called inside an active em.transactional scope. The caller's transactional wrapper flushes + commits, the trigger fires pg_notify on commit, the publisher wakes. Calling outside transactional is a contract violation that breaks the same-TX guarantee of the outbox pattern. */
  async add<TPayload>(
    env: DomainEventEnvelope<TPayload>,
    route: OutboxRoute,
  ): Promise<OutboxMessage> {
    const row = new OutboxMessage();
    row.messageId = env.messageId;
    row.aggregateType = route.aggregateType;
    row.aggregateId = route.aggregateId;
    row.eventType = env.type;
    row.eventVersion = env.version;
    row.exchange = route.exchange;
    row.routingKey = route.routingKey;
    row.payload = env.payload as Record<string, unknown>;
    row.headers = envelopeToAmqpHeaders(env) as Record<string, unknown>;
    row.status = "PENDING";
    row.attempts = 0;
    this.em.persist(row);
    return row;
  }
}
