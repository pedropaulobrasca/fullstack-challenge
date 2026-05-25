import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { AmqpConnection } from "@golevelup/nestjs-rabbitmq";
import type { Channel, ChannelModel } from "amqplib";

import {
  MESSAGING_OPTIONS,
  type MessagingOptions,
} from "../outbox/messaging-options";
import { buildQuorumArgs } from "./topology-defaults";

@Injectable()
export class TopologyBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(TopologyBootstrap.name);

  constructor(
    private readonly amqp: AmqpConnection,
    @Inject(MESSAGING_OPTIONS) private readonly opts: MessagingOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const connection = this.amqp.connection as unknown as ChannelModel;
    const channel: Channel = await connection.createChannel();
    try {
      for (const ex of this.opts.topology.exchangesToAssert) {
        await channel.assertExchange(ex.name, ex.type, { durable: ex.durable });
        this.logger.log(`assertExchange ${ex.name} (${ex.type})`);
      }

      for (const q of this.opts.topology.queuesToAssert) {
        await channel.assertQueue(q.name, {
          durable: true,
          arguments: buildQuorumArgs(q.deliveryLimit, q.dlx),
        });
        this.logger.log(
          `assertQueue ${q.name} (deliveryLimit=${q.deliveryLimit}, dlx=${q.dlx ?? "none"})`,
        );
      }

      for (const b of this.opts.topology.bindings) {
        await channel.bindQueue(b.queue, b.exchange, b.routingKey);
        this.logger.log(
          `bindQueue ${b.queue} <- ${b.exchange} :: ${b.routingKey}`,
        );
      }
    } finally {
      await channel.close().catch((err) =>
        this.logger.warn(
          `topology channel close failed: ${(err as Error).message}`,
        ),
      );
    }
  }
}
