import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  BET_LOST_EVENT_TYPE,
  betLostEventSchema,
  type BetLostEventV1,
} from "../../src/events/bet-lost.event";

const validPayload = (): unknown => ({
  betId: randomUUID(),
  playerId: "keycloak-sub-id",
  roundId: randomUUID(),
  amount: { amount: "10000", currency: "CRD", scale: 2 },
  settledAt: "2026-05-30T00:00:00.000Z",
});

describe("bet.lost contract event", () => {
  test("parses a well-formed payload", () => {
    const result = betLostEventSchema.parse(validPayload());
    expect(result.amount.amount).toBe("10000");
    expect(result.amount.currency).toBe("CRD");
  });

  test("rejects payload missing roundId", () => {
    const payload = validPayload() as Record<string, unknown>;
    delete payload.roundId;
    expect(() => betLostEventSchema.parse(payload)).toThrow();
  });

  test("rejects payload where amount is a number (Money discipline)", () => {
    const payload = { ...(validPayload() as Record<string, unknown>), amount: 100 };
    expect(() => betLostEventSchema.parse(payload)).toThrow();
  });

  test("rejects payload with non-uuid betId", () => {
    const payload = { ...(validPayload() as Record<string, unknown>), betId: "not-uuid" };
    expect(() => betLostEventSchema.parse(payload)).toThrow();
  });

  test("rejects payload with non-iso settledAt", () => {
    const payload = { ...(validPayload() as Record<string, unknown>), settledAt: "yesterday" };
    expect(() => betLostEventSchema.parse(payload)).toThrow();
  });

  test("exports the routing key constant 'bet.lost'", () => {
    expect(BET_LOST_EVENT_TYPE).toBe("bet.lost");
  });

  test("inferred type is structurally compatible with parsed payload", () => {
    const parsed: BetLostEventV1 = betLostEventSchema.parse(validPayload());
    expect(typeof parsed.betId).toBe("string");
    expect(typeof parsed.playerId).toBe("string");
    expect(typeof parsed.roundId).toBe("string");
    expect(typeof parsed.settledAt).toBe("string");
    expect(parsed.amount.scale).toBe(2);
  });
});
