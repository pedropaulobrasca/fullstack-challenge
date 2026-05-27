import {
  type DynamicModule,
  Logger,
  Module,
  type ModuleMetadata,
  type FactoryProvider,
} from "@nestjs/common";
import { RabbitMQModule } from "@golevelup/nestjs-rabbitmq";
import { MikroOrmModule } from "@mikro-orm/nestjs";

import { MessagingClsModule } from "./context/messaging-cls";
import { DeadLetterMessageSchema } from "./dead-letter/dead-letter-message.entity";
import { DeadLetterRepository } from "./dead-letter/dead-letter-repository";
import { InboxMessageSchema } from "./inbox/inbox-message.entity";
import { InboxRepository } from "./inbox/inbox-repository";
import { OutboxListenerService } from "./outbox/outbox-listener.service";
import { OutboxMessageSchema } from "./outbox/outbox-message.entity";
import { OutboxPublisher } from "./outbox/outbox-publisher.service";
import { OutboxRepository } from "./outbox/outbox-repository";
import {
  MESSAGING_OPTIONS,
  type MessagingOptions,
} from "./outbox/messaging-options";
import { TopologyBootstrap } from "./topology/topology-bootstrap.service";
import { buildQuorumArgs } from "./topology/topology-defaults";

export interface MessagingSpineModuleAsyncOptions {
  imports?: ModuleMetadata["imports"];
  useFactory: (
    ...deps: unknown[]
  ) => MessagingOptions | Promise<MessagingOptions>;
  inject?: FactoryProvider["inject"];
}

@Module({})
class MessagingOptionsModule {
  static forRootAsync(
    asyncOptions: MessagingSpineModuleAsyncOptions,
  ): DynamicModule {
    return {
      module: MessagingOptionsModule,
      global: true,
      imports: [...(asyncOptions.imports ?? [])],
      providers: [
        {
          provide: MESSAGING_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
      ],
      exports: [MESSAGING_OPTIONS],
    };
  }
}

@Module({})
export class MessagingSpineModule {
  static forRootAsync(
    asyncOptions: MessagingSpineModuleAsyncOptions,
  ): DynamicModule {
    const optionsModule = MessagingOptionsModule.forRootAsync(asyncOptions);
    return {
      module: MessagingSpineModule,
      global: true,
      imports: [
        optionsModule,
        MessagingClsModule.forRoot(),
        RabbitMQModule.forRootAsync({
          imports: [optionsModule],
          useFactory: (opts: MessagingOptions) => ({
            uri: opts.amqpUrl,
            connectionInitOptions: { wait: true, timeout: 30_000 },
            enableControllerDiscovery: true,
            exchanges: opts.topology.exchangesToAssert.map((ex) => ({
              name: ex.name,
              type: ex.type,
              options: { durable: ex.durable },
            })),
            queues: opts.topology.queuesToAssert.map((q) => ({
              name: q.name,
              options: {
                durable: true,
                arguments: buildQuorumArgs(q.deliveryLimit, q.dlx),
              },
            })),
          }),
          inject: [MESSAGING_OPTIONS],
        }),
        MikroOrmModule.forFeature([
          OutboxMessageSchema,
          InboxMessageSchema,
          DeadLetterMessageSchema,
        ]),
      ],
      providers: [
        Logger,
        OutboxRepository,
        InboxRepository,
        DeadLetterRepository,
        OutboxListenerService,
        OutboxPublisher,
        TopologyBootstrap,
      ],
      exports: [
        MessagingOptionsModule,
        OutboxRepository,
        InboxRepository,
        DeadLetterRepository,
        RabbitMQModule,
        MessagingClsModule,
        MikroOrmModule,
      ],
    };
  }
}
