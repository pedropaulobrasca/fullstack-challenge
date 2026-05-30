import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { describe, expect, test } from "bun:test";
import { placeBetRequestSchema } from "../../src/presentation/dtos/place-bet.request.dto";

describe("placeBetRequestSchema — autoCashoutTarget (Phase 9 Plan 02)", () => {
  test("omitted autoCashoutTarget parses (backwards-compat)", () => {
    const parsed = placeBetRequestSchema.parse({ amountCents: "1000" });
    expect(parsed.amountCents).toBe(1000n);
    expect(parsed.autoCashoutTarget).toBeUndefined();
  });

  test("autoCashoutTarget = 2.0 parses successfully", () => {
    const parsed = placeBetRequestSchema.parse({
      amountCents: "1000",
      autoCashoutTarget: 2.0,
    });
    expect(parsed.autoCashoutTarget).toBe(2.0);
  });

  test("autoCashoutTarget = 1.00 throws (below env-derived min 1.01)", () => {
    expect(() =>
      placeBetRequestSchema.parse({
        amountCents: "1000",
        autoCashoutTarget: 1.0,
      }),
    ).toThrow();
  });

  test("autoCashoutTarget = 100.01 throws (above env max 100.00)", () => {
    expect(() =>
      placeBetRequestSchema.parse({
        amountCents: "1000",
        autoCashoutTarget: 100.01,
      }),
    ).toThrow();
  });

  test("autoCashoutTarget = 1.01 parses (boundary inclusive)", () => {
    const parsed = placeBetRequestSchema.parse({
      amountCents: "1000",
      autoCashoutTarget: 1.01,
    });
    expect(parsed.autoCashoutTarget).toBe(1.01);
  });

  test("autoCashoutTarget = 100 parses (upper boundary inclusive)", () => {
    const parsed = placeBetRequestSchema.parse({
      amountCents: "1000",
      autoCashoutTarget: 100,
    });
    expect(parsed.autoCashoutTarget).toBe(100);
  });

  test("non-numeric autoCashoutTarget rejected", () => {
    expect(() =>
      placeBetRequestSchema.parse({
        amountCents: "1000",
        autoCashoutTarget: "2.0",
      }),
    ).toThrow();
  });

  test("strict() rejects unknown keys", () => {
    expect(() =>
      placeBetRequestSchema.parse({
        amountCents: "1000",
        somethingElse: "x",
      }),
    ).toThrow();
  });
});
