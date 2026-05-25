import { Injectable, Logger } from "@nestjs/common";
import { RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import type { ConsumeMessage } from "amqplib";
import {
  DeadLetterConsumer,
  DeadLetterRepository,
  EXCHANGES,
  QUEUES,
  buildQuorumArgs,
} from "@crash/messaging-spine";
import { env } from "../../config/defaults";

@Injectable()
export class GamesDeadLetterConsumer extends DeadLetterConsumer {
  protected readonly consumerName = "games.dlq";

  constructor(repo: DeadLetterRepository) {
    super(repo, new Logger(GamesDeadLetterConsumer.name));
  }

  @RabbitSubscribe({
    exchange: EXCHANGES.GAME_DLX,
    routingKey: "",
    queue: QUEUES.GAMES_DLQ,
    queueOptions: {
      durable: true,
      arguments: buildQuorumArgs(env.RMQ_DELIVERY_LIMIT_DLQ),
    },
  })
  async handle(
    rawPayload: unknown,
    msg: ConsumeMessage,
  ): Promise<undefined> {
    return this.handleDeadLetter(rawPayload, msg);
  }
}
