import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import {
  MessagingSpineModule,
  EXCHANGES,
  QUEUES,
} from "@crash/messaging-spine";
import mikroOrmConfig from "../mikro-orm.config";
import { env } from "./config/defaults";
import { GamesController } from "./presentation/controllers/games.controller";
import { HealthController } from "./presentation/controllers/health.controller";
import { GamesDeadLetterConsumer } from "./infrastructure/messaging/games-dead-letter.consumer";

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    MessagingSpineModule.forRootAsync({
      useFactory: () => ({
        amqpUrl: env.RABBITMQ_URL,
        databaseUrl: env.DATABASE_URL,
        serviceName: "games",
        outbox: {
          pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
          batchSize: env.OUTBOX_POLL_BATCH_SIZE,
        },
        topology: {
          exchangesToAssert: [
            { name: EXCHANGES.GAME_EVENTS, type: "topic", durable: true },
            { name: EXCHANGES.GAME_DLX, type: "fanout", durable: true },
            { name: EXCHANGES.WALLET_EVENTS, type: "topic", durable: true },
          ],
          queuesToAssert: [
            {
              name: QUEUES.GAMES_WALLET_EVENTS,
              deliveryLimit: env.RMQ_DELIVERY_LIMIT_MAIN,
              dlx: EXCHANGES.GAME_DLX,
            },
            {
              name: QUEUES.GAMES_DLQ,
              deliveryLimit: env.RMQ_DELIVERY_LIMIT_DLQ,
            },
          ],
          bindings: [
            {
              queue: QUEUES.GAMES_WALLET_EVENTS,
              exchange: EXCHANGES.WALLET_EVENTS,
              routingKey: "wallet.*",
            },
            {
              queue: QUEUES.GAMES_DLQ,
              exchange: EXCHANGES.GAME_DLX,
              routingKey: "",
            },
          ],
        },
      }),
    }),
  ],
  controllers: [GamesController, HealthController],
  providers: [GamesDeadLetterConsumer],
})
export class AppModule {}
