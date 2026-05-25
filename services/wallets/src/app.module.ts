import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import {
  MessagingSpineModule,
  EXCHANGES,
  QUEUES,
} from "@crash/messaging-spine";
import mikroOrmConfig from "../mikro-orm.config";
import { env } from "./config/defaults";
import { WalletsController } from "./presentation/controllers/wallets.controller";
import { HealthController } from "./presentation/controllers/health.controller";
import { WalletsDeadLetterConsumer } from "./infrastructure/messaging/wallets-dead-letter.consumer";

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    MessagingSpineModule.forRootAsync({
      useFactory: () => ({
        amqpUrl: env.RABBITMQ_URL,
        databaseUrl: env.DATABASE_URL,
        serviceName: "wallets",
        outbox: {
          pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
          batchSize: env.OUTBOX_POLL_BATCH_SIZE,
        },
        topology: {
          exchangesToAssert: [
            { name: EXCHANGES.WALLET_COMMANDS, type: "direct", durable: true },
            { name: EXCHANGES.WALLET_EVENTS, type: "topic", durable: true },
            { name: EXCHANGES.WALLET_DLX, type: "fanout", durable: true },
          ],
          queuesToAssert: [
            {
              name: QUEUES.WALLET_COMMANDS,
              deliveryLimit: env.RMQ_DELIVERY_LIMIT_MAIN,
              dlx: EXCHANGES.WALLET_DLX,
            },
            {
              name: QUEUES.WALLET_DLQ,
              deliveryLimit: env.RMQ_DELIVERY_LIMIT_DLQ,
            },
          ],
          bindings: [
            {
              queue: QUEUES.WALLET_COMMANDS,
              exchange: EXCHANGES.WALLET_COMMANDS,
              routingKey: "wallet.debit",
            },
            {
              queue: QUEUES.WALLET_COMMANDS,
              exchange: EXCHANGES.WALLET_COMMANDS,
              routingKey: "wallet.credit",
            },
            {
              queue: QUEUES.WALLET_DLQ,
              exchange: EXCHANGES.WALLET_DLX,
              routingKey: "",
            },
          ],
        },
      }),
    }),
  ],
  controllers: [WalletsController, HealthController],
  providers: [WalletsDeadLetterConsumer],
})
export class AppModule {}
