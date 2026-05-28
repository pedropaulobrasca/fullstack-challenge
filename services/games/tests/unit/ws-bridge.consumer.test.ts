import { beforeAll, describe, expect, mock, test } from "bun:test";
import { setupGamesTestEnv } from "../setup";

setupGamesTestEnv();

import { createHash, randomUUID } from "node:crypto";
import type { ConsumeMessage } from "amqplib";
import {
  betCashedOutPayloadSchema,
  betMyActivePayloadSchema,
  betMyCashedOutPayloadSchema,
  betMyRefundedPayloadSchema,
  betPlacedPayloadSchema,
} from "../../src/presentation/dtos/ws-event.payloads";
import type { GameWsGateway } from "../../src/presentation/gateways/game-ws.gateway";

type ConsumerCtor =
  typeof import("../../src/infrastructure/messaging/ws-bridge.consumer")["WsBridgeConsumer"];

let WsBridgeConsumer: ConsumerCtor;

beforeAll(async () => {
  ({ WsBridgeConsumer } = await import(
    "../../src/infrastructure/messaging/ws-bridge.consumer"
  ));
});

type EmitCall = { event: string; payload: unknown };

function buildGatewayStub(): {
  gateway: GameWsGateway;
  emitsByRoom: Map<string, EmitCall[]>;
  toCalls: string[];
} {
  const emitsByRoom = new Map<string, EmitCall[]>();
  const toCalls: string[] = [];

  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "to") {
        return (room: string) => {
          toCalls.push(room);
          const bucket = emitsByRoom.get(room) ?? [];
          emitsByRoom.set(room, bucket);
          return {
            emit: (event: string, payload: unknown) => {
              bucket.push({ event, payload });
              return true;
            },
            get volatile() {
              throw new Error(
                "WsBridgeConsumer must NOT use volatile.emit (volatile is for ticks only)",
              );
            },
          };
        };
      }
      if (prop === "volatile") {
        throw new Error(
          "WsBridgeConsumer must NOT access gateway.server.volatile",
        );
      }
      return undefined;
    },
  };

  const server = new Proxy({}, handler);
  const gateway = { server } as unknown as GameWsGateway;
  return { gateway, emitsByRoom, toCalls };
}

function buildEnvelope(type: string, payload: unknown) {
  return {
    messageId: randomUUID(),
    correlationId: randomUUID(),
    causationId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    payload,
  };
}

function buildAmqpMessage(): ConsumeMessage {
  return {
    content: Buffer.from(""),
    fields: {
      consumerTag: "",
      deliveryTag: 0,
      redelivered: false,
      exchange: "game.events",
      routingKey: "",
    },
    properties: { headers: {} },
  } as unknown as ConsumeMessage;
}

function expectedMask(playerId: string): string {
  return createHash("sha256").update(playerId).digest("hex").substring(0, 8);
}

describe("WsBridgeConsumer.handle", () => {
  test("bet.active emits bet:placed to lobby (masked) and bet:my_active to user room", async () => {
    const { gateway, emitsByRoom } = buildGatewayStub();
    const consumer = new WsBridgeConsumer(gateway);

    const playerId = "player-alice";
    const envelope = buildEnvelope("bet.active", {
      betId: "bet-1",
      playerId,
      roundId: "round-1",
    });

    await consumer.handle(envelope, buildAmqpMessage());

    const lobby = emitsByRoom.get("lobby") ?? [];
    const user = emitsByRoom.get(`user:${playerId}`) ?? [];

    expect(lobby).toHaveLength(1);
    expect(lobby[0].event).toBe("bet:placed");
    expect(user).toHaveLength(1);
    expect(user[0].event).toBe("bet:my_active");

    const lobbyPayload = betPlacedPayloadSchema.parse(lobby[0].payload);
    expect(lobbyPayload.playerIdMasked).toBe(expectedMask(playerId));
    expect(lobbyPayload.roundId).toBe("round-1");
    expect(lobbyPayload.betId).toBe("bet-1");

    const userPayload = betMyActivePayloadSchema.parse(user[0].payload);
    expect(userPayload.roundId).toBe("round-1");
    expect(userPayload.betId).toBe("bet-1");
  });

  test("bet.refunded emits bet:my_refunded to user room only", async () => {
    const { gateway, emitsByRoom } = buildGatewayStub();
    const consumer = new WsBridgeConsumer(gateway);

    const playerId = "player-bob";
    const envelope = buildEnvelope("bet.refunded", {
      betId: "bet-2",
      playerId,
      roundId: "round-2",
      reason: "INSUFFICIENT_FUNDS",
    });

    await consumer.handle(envelope, buildAmqpMessage());

    expect(emitsByRoom.get("lobby") ?? []).toHaveLength(0);
    const user = emitsByRoom.get(`user:${playerId}`) ?? [];
    expect(user).toHaveLength(1);
    expect(user[0].event).toBe("bet:my_refunded");

    const payload = betMyRefundedPayloadSchema.parse(user[0].payload);
    expect(payload.reason).toBe("INSUFFICIENT_FUNDS");
    expect(payload.betId).toBe("bet-2");
    expect(payload.roundId).toBe("round-2");
  });

  test("bet.cashed_out emits bet:cashed_out to lobby (masked, no payout) and bet:my_cashed_out to user (with payout)", async () => {
    const { gateway, emitsByRoom } = buildGatewayStub();
    const consumer = new WsBridgeConsumer(gateway);

    const playerId = "player-carol";
    const envelope = buildEnvelope("bet.cashed_out", {
      betId: "bet-3",
      playerId,
      roundId: "round-3",
      multiplier: 2.45,
      payout: { amount: "24500", currency: "CRD", scale: 2 },
      cashedOutAt: "2026-05-27T12:00:00.000Z",
    });

    await consumer.handle(envelope, buildAmqpMessage());

    const lobby = emitsByRoom.get("lobby") ?? [];
    const user = emitsByRoom.get(`user:${playerId}`) ?? [];

    expect(lobby).toHaveLength(1);
    expect(lobby[0].event).toBe("bet:cashed_out");
    expect(user).toHaveLength(1);
    expect(user[0].event).toBe("bet:my_cashed_out");

    const lobbyPayload = betCashedOutPayloadSchema.parse(lobby[0].payload);
    expect(lobbyPayload.playerIdMasked).toBe(expectedMask(playerId));
    expect(lobbyPayload.multiplier).toBe(2.45);
    expect((lobbyPayload as Record<string, unknown>).payout).toBeUndefined();

    const userPayload = betMyCashedOutPayloadSchema.parse(user[0].payload);
    expect(userPayload.multiplier).toBe(2.45);
    expect(userPayload.payout).toEqual({
      amount: "24500",
      currency: "CRD",
      scale: 2,
    });
  });

  test("playerId masking is deterministic across invocations", async () => {
    const { gateway, emitsByRoom } = buildGatewayStub();
    const consumer = new WsBridgeConsumer(gateway);

    const playerId = "player-dave";
    const envelope1 = buildEnvelope("bet.active", {
      betId: "bet-a",
      playerId,
      roundId: "round-x",
    });
    const envelope2 = buildEnvelope("bet.active", {
      betId: "bet-b",
      playerId,
      roundId: "round-x",
    });

    await consumer.handle(envelope1, buildAmqpMessage());
    await consumer.handle(envelope2, buildAmqpMessage());

    const lobby = emitsByRoom.get("lobby") ?? [];
    expect(lobby).toHaveLength(2);
    const masks = lobby.map(
      (call) => (call.payload as { playerIdMasked: string }).playerIdMasked,
    );
    expect(masks[0]).toBe(masks[1]);
    expect(masks[0]).toBe(expectedMask(playerId));
  });

  test("unknown routing key logs warn and does not throw", async () => {
    const { gateway, emitsByRoom } = buildGatewayStub();
    const consumer = new WsBridgeConsumer(gateway);
    const warnSpy = mock(() => undefined);
    (consumer as unknown as { log: { warn: typeof warnSpy } }).log = {
      warn: warnSpy,
    } as never;

    const envelope = buildEnvelope("bet.unknown", { betId: "x" });

    await expect(
      consumer.handle(envelope, buildAmqpMessage()),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(emitsByRoom.size).toBe(0);
  });

  test("never reads gateway.server.volatile", async () => {
    const { gateway } = buildGatewayStub();
    const consumer = new WsBridgeConsumer(gateway);

    const envelope = buildEnvelope("bet.active", {
      betId: "bet-1",
      playerId: "player-alice",
      roundId: "round-1",
    });

    await expect(
      consumer.handle(envelope, buildAmqpMessage()),
    ).resolves.toBeUndefined();
  });
});
