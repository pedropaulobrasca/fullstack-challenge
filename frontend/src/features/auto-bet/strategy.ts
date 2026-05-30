import { Money } from "@crash/shared-kernel";

export type AutoBetStrategy = "fixed" | "martingale";

export type LastOutcome = "win" | "loss" | null;

export type StrategyContext = {
  lastBet: Money | null;
};

export function nextBetAmount(
  strategy: AutoBetStrategy,
  baseAmount: Money,
  lastOutcome: LastOutcome,
  ctx: StrategyContext = { lastBet: null },
): Money {
  if (strategy === "fixed") {
    return baseAmount;
  }
  if (lastOutcome === "loss" && ctx.lastBet !== null) {
    return ctx.lastBet.multiplyRounded({ numerator: 2n, denominator: 1n });
  }
  return baseAmount;
}
