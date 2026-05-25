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

export interface MessagingSpineModuleAsyncOptions {
  imports?: ModuleMetadata["imports"];
  useFactory: (
    ...deps: unknown[]
  ) => MessagingOptions | Promise<MessagingOptions>;
  inject?: FactoryProvider["inject"];
}

@Module({})
export class MessagingSpineModule {
  static forRootAsync(
    asyncOptions: MessagingSpineModuleAsyncOptions,
  ): DynamicModule {
    return {
      module: MessagingSpineModule,
      imports: [
        ...(asyncOptions.imports ?? []),
        MessagingClsModule.forRoot(),
        RabbitMQModule.forRootAsync({
          useFactory: (opts: MessagingOptions) => ({
            uri: opts.amqpUrl,
            connectionInitOptions: { wait: true, timeout: 30_000 },
            enableControllerDiscovery: true,
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
        {
          provide: MESSAGING_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
        Logger,
        OutboxRepository,
        InboxRepository,
        DeadLetterRepository,
        OutboxListenerService,
        OutboxPublisher,
        TopologyBootstrap,
      ],
      exports: [
        MESSAGING_OPTIONS,
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
