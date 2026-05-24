export interface DomainEventEnvelope<TPayload = unknown> {
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly payload: TPayload;
}
