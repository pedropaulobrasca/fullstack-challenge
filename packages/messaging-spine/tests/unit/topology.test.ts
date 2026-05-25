import { describe, test, expect } from "bun:test";

import {
  EXCHANGES,
  QUEUES,
  buildQuorumArgs,
  deriveDlxFromExchange,
  topologyConfigSchema,
} from "../../src/index";

describe("EXCHANGES constants", () => {
  test("WALLET_COMMANDS maps to wallet.commands", () => {
    expect(EXCHANGES.WALLET_COMMANDS).toBe("wallet.commands");
  });

  test("WALLET_EVENTS maps to wallet.events", () => {
    expect(EXCHANGES.WALLET_EVENTS).toBe("wallet.events");
  });

  test("GAME_EVENTS maps to game.events", () => {
    expect(EXCHANGES.GAME_EVENTS).toBe("game.events");
  });

  test("WALLET_DLX maps to wallet.dlx", () => {
    expect(EXCHANGES.WALLET_DLX).toBe("wallet.dlx");
  });

  test("GAME_DLX maps to game.dlx", () => {
    expect(EXCHANGES.GAME_DLX).toBe("game.dlx");
  });
});

describe("QUEUES constants", () => {
  test("WALLET_COMMANDS maps to wallet.commands.q", () => {
    expect(QUEUES.WALLET_COMMANDS).toBe("wallet.commands.q");
  });

  test("GAMES_WALLET_EVENTS maps to games.wallet-events.q", () => {
    expect(QUEUES.GAMES_WALLET_EVENTS).toBe("games.wallet-events.q");
  });

  test("WALLET_DLQ maps to wallet.dlq", () => {
    expect(QUEUES.WALLET_DLQ).toBe("wallet.dlq");
  });

  test("GAMES_DLQ maps to games.dlq", () => {
    expect(QUEUES.GAMES_DLQ).toBe("games.dlq");
  });
});

describe("buildQuorumArgs", () => {
  test("returns x-queue-type=quorum and x-delivery-limit", () => {
    const args = buildQuorumArgs(5);
    expect(args["x-queue-type"]).toBe("quorum");
    expect(args["x-delivery-limit"]).toBe(5);
  });

  test("includes x-dead-letter-exchange when dlxName provided", () => {
    const args = buildQuorumArgs(5, EXCHANGES.WALLET_DLX);
    expect(args["x-dead-letter-exchange"]).toBe("wallet.dlx");
  });

  test("omits x-dead-letter-exchange when dlxName undefined", () => {
    const args = buildQuorumArgs(3);
    expect("x-dead-letter-exchange" in args).toBe(false);
  });

  test("deliveryLimit value matches input", () => {
    expect(buildQuorumArgs(1)["x-delivery-limit"]).toBe(1);
    expect(buildQuorumArgs(99)["x-delivery-limit"]).toBe(99);
  });
});

describe("deriveDlxFromExchange", () => {
  test("maps wallet.commands to wallet.dlx", () => {
    expect(deriveDlxFromExchange(EXCHANGES.WALLET_COMMANDS)).toBe("wallet.dlx");
  });

  test("maps wallet.events to wallet.dlx", () => {
    expect(deriveDlxFromExchange(EXCHANGES.WALLET_EVENTS)).toBe("wallet.dlx");
  });

  test("maps game.events to game.dlx", () => {
    expect(deriveDlxFromExchange(EXCHANGES.GAME_EVENTS)).toBe("game.dlx");
  });

  test("throws on unknown exchange", () => {
    expect(() => deriveDlxFromExchange("unknown.exchange")).toThrow(
      /Unknown exchange/,
    );
  });

  test("throws on a DLX exchange itself (no chained DLX)", () => {
    expect(() => deriveDlxFromExchange(EXCHANGES.WALLET_DLX)).toThrow();
    expect(() => deriveDlxFromExchange(EXCHANGES.GAME_DLX)).toThrow();
  });
});

describe("topologyConfigSchema", () => {
  test("accepts the canonical wallet topology shape", () => {
    const config = {
      exchangesToAssert: [
        { name: EXCHANGES.WALLET_COMMANDS, type: "direct" as const },
        { name: EXCHANGES.WALLET_EVENTS, type: "topic" as const },
        { name: EXCHANGES.WALLET_DLX, type: "fanout" as const },
      ],
      queuesToAssert: [
        {
          name: QUEUES.WALLET_COMMANDS,
          deliveryLimit: 5,
          dlx: EXCHANGES.WALLET_DLX,
        },
        { name: QUEUES.WALLET_DLQ, deliveryLimit: 3 },
      ],
      bindings: [
        {
          queue: QUEUES.WALLET_COMMANDS,
          exchange: EXCHANGES.WALLET_COMMANDS,
          routingKey: "wallet.debit",
        },
      ],
    };
    expect(() => topologyConfigSchema.parse(config)).not.toThrow();
  });

  test("accepts the canonical games topology shape", () => {
    const config = {
      exchangesToAssert: [
        { name: EXCHANGES.GAME_EVENTS, type: "topic" as const },
        { name: EXCHANGES.WALLET_EVENTS, type: "topic" as const },
        { name: EXCHANGES.GAME_DLX, type: "fanout" as const },
      ],
      queuesToAssert: [
        {
          name: QUEUES.GAMES_WALLET_EVENTS,
          deliveryLimit: 5,
          dlx: EXCHANGES.GAME_DLX,
        },
        { name: QUEUES.GAMES_DLQ, deliveryLimit: 3 },
      ],
      bindings: [
        {
          queue: QUEUES.GAMES_WALLET_EVENTS,
          exchange: EXCHANGES.WALLET_EVENTS,
          routingKey: "wallet.debited.v1",
        },
      ],
    };
    expect(() => topologyConfigSchema.parse(config)).not.toThrow();
  });

  test("rejects deliveryLimit of zero", () => {
    const config = {
      exchangesToAssert: [],
      queuesToAssert: [{ name: "q", deliveryLimit: 0 }],
      bindings: [],
    };
    expect(() => topologyConfigSchema.parse(config)).toThrow();
  });

  test("rejects negative deliveryLimit", () => {
    const config = {
      exchangesToAssert: [],
      queuesToAssert: [{ name: "q", deliveryLimit: -1 }],
      bindings: [],
    };
    expect(() => topologyConfigSchema.parse(config)).toThrow();
  });

  test("rejects missing required fields on exchange entry", () => {
    const config = {
      exchangesToAssert: [{ name: "x" }],
      queuesToAssert: [],
      bindings: [],
    };
    expect(() => topologyConfigSchema.parse(config)).toThrow();
  });

  test("rejects invalid exchange type", () => {
    const config = {
      exchangesToAssert: [{ name: "x", type: "headers" }],
      queuesToAssert: [],
      bindings: [],
    };
    expect(() => topologyConfigSchema.parse(config)).toThrow();
  });

  test("defaults durable to true on exchange entries", () => {
    const parsed = topologyConfigSchema.parse({
      exchangesToAssert: [{ name: "x", type: "direct" }],
      queuesToAssert: [],
      bindings: [],
    });
    expect(parsed.exchangesToAssert[0]?.durable).toBe(true);
  });
});
