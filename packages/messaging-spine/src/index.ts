export {
  buildEnvelope,
  parseEnvelope,
  type EnvelopeBuildOptions,
} from "./envelope/build-envelope";
export {
  envelopeToAmqpHeaders,
  amqpHeadersToEnvelopeMeta,
  AMQP_HEADER_KEYS,
  type EnvelopeMeta,
} from "./envelope/envelope-headers";
export {
  EXCHANGES,
  QUEUES,
  buildQuorumArgs,
  deriveDlxFromExchange,
  type ExchangeName,
  type QueueName,
} from "./topology/topology-defaults";
export {
  topologyConfigSchema,
  type TopologyConfig,
} from "./topology/topology-config";
export {
  CORRELATION_ID_KEY,
  CAUSATION_ID_KEY,
} from "./context/correlation-tokens";
export {
  MessagingClsModule,
  withMessagingContext,
} from "./context/messaging-cls";
export {
  OutboxMessage,
  OutboxMessageSchema,
} from "./outbox/outbox-message.entity";
export {
  OUTBOX_STATUSES,
  type OutboxStatus,
} from "./outbox/outbox-status";
export {
  InboxMessage,
  InboxMessageSchema,
} from "./inbox/inbox-message.entity";
export { InboxRepository } from "./inbox/inbox-repository";
export {
  IdempotentSubscribe,
  type IdempotentSubscribeOptions,
} from "./inbox/idempotent-subscribe.decorator";
export { CONSUMER_NAME_META } from "./inbox/consumer-name.token";
export {
  DeadLetterMessage,
  DeadLetterMessageSchema,
} from "./dead-letter/dead-letter-message.entity";
export {
  DeadLetterRepository,
  type DeadLetterRecord,
} from "./dead-letter/dead-letter-repository";
export { DeadLetterConsumer } from "./dead-letter/dead-letter-consumer.service";
export {
  OutboxRepository,
  type OutboxRoute,
} from "./outbox/outbox-repository";
export { OutboxListenerService } from "./outbox/outbox-listener.service";
export { OutboxPublisher } from "./outbox/outbox-publisher.service";
export {
  MESSAGING_OPTIONS,
  type MessagingOptions,
} from "./outbox/messaging-options";
