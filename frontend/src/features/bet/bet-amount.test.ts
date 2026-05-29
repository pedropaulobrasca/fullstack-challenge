import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    bet: { minCents: 100, maxCents: 100000 },
    currencyCode: "CRD",
  }),
}));

import { parseBetAmount } from "@/features/bet/bet-amount";

describe("parseBetAmount", () => {
  it("parses a valid decimal within bounds to a Money VO of the expected cents", () => {
    const result = parseBetAmount("10.00");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.money.toSnapshot().amount).toBe("1000");
      expect(result.money.toSnapshot().currency).toBe("CRD");
    }
  });

  it("rejects negative input as invalid before constructing Money", () => {
    const result = parseBetAmount("-5");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects scientific notation as invalid", () => {
    const result = parseBetAmount("1e3");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects empty input as invalid", () => {
    const result = parseBetAmount("");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects more fraction digits than the currency exponent", () => {
    const result = parseBetAmount("10.001");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a value below the configured minimum", () => {
    const result = parseBetAmount("0.50");
    expect(result).toEqual({ ok: false, reason: "below-min" });
  });

  it("rejects a value above the configured maximum", () => {
    const result = parseBetAmount("2000.00");
    expect(result).toEqual({ ok: false, reason: "above-max" });
  });
});
