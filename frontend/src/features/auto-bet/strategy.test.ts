import { describe, expect, it } from "vitest";
import { Money } from "@crash/shared-kernel";
import { nextBetAmount } from "@/features/auto-bet/strategy";

const cents = (n: bigint) => Money.of(n);

describe("nextBetAmount — fixed strategy", () => {
  it("returns base when no last outcome", () => {
    const next = nextBetAmount("fixed", cents(1000n), null);
    expect(next.toCents()).toBe(1000n);
  });

  it("returns base after a win", () => {
    const next = nextBetAmount("fixed", cents(1000n), "win", {
      lastBet: cents(8000n),
    });
    expect(next.toCents()).toBe(1000n);
  });

  it("returns base after a loss (fixed never changes)", () => {
    const next = nextBetAmount("fixed", cents(1000n), "loss", {
      lastBet: cents(8000n),
    });
    expect(next.toCents()).toBe(1000n);
  });
});

describe("nextBetAmount — martingale strategy", () => {
  it("resets to BASE after a win (REQ-AUTO-02 — base is configured initial, not previous bet)", () => {
    const next = nextBetAmount("martingale", cents(1000n), "win", {
      lastBet: cents(8000n),
    });
    expect(next.toCents()).toBe(1000n);
  });

  it("doubles the previous bet after a loss", () => {
    const next = nextBetAmount("martingale", cents(1000n), "loss", {
      lastBet: cents(2000n),
    });
    expect(next.toCents()).toBe(4000n);
  });

  it("returns base on the first round (no previous outcome)", () => {
    const next = nextBetAmount("martingale", cents(1000n), null, {
      lastBet: null,
    });
    expect(next.toCents()).toBe(1000n);
  });
});
