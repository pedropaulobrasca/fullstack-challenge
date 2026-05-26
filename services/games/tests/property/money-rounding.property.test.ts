import { setupGamesTestEnv } from "../setup";
setupGamesTestEnv();

import { expect, test } from "bun:test";
import fc from "fast-check";
import { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import { Bet } from "../../src/domain/bet.aggregate";
import { Multiplier } from "../../src/domain/value-objects/multiplier";

const baseDate = new Date("2026-05-25T12:00:00Z");
const cashOutDate = new Date("2026-05-25T12:00:03Z");

const betCentsArb = fc.bigInt({ min: 100n, max: 100_000n });

const multiplierTenThousandthsArb = fc.bigInt({ min: 10_000n, max: 10_000_000n });

test(
  "10k cashouts: payout is finite, non-negative, and equals amount.multiplyRounded(multiplier)",
  () => {
    fc.assert(
      fc.property(betCentsArb, multiplierTenThousandthsArb, (betCents, multTenThousandths) => {
        const amount = Money.of(betCents);
        const multiplier = Multiplier.fromTenThousandths(multTenThousandths);

        const bet = Bet.place(
          BetId("bet-prop"),
          RoundId("round-prop"),
          PlayerId("player-prop"),
          amount,
          baseDate,
        ).confirm();
        const { payout } = bet.cashOut(multiplier, cashOutDate);

        const expected = amount.multiplyRounded({
          numerator: multTenThousandths,
          denominator: 10_000n,
        });

        const payoutCents = payout.toCents();
        expect(payoutCents).toBe(expected.toCents());
        expect(payoutCents >= 0n).toBe(true);

        const multiplierOneOrMore = multTenThousandths >= 10_000n;
        if (multiplierOneOrMore) {
          expect(payoutCents >= betCents - 1n).toBe(true);
        }
      }),
      { numRuns: 10_000 },
    );
  },
  60_000,
);

function bankersDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = remainder * 2n;
  if (twice < denominator) return quotient;
  if (twice > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

test(
  "loss-free inverse: payout * (10000 / multiplier) recovers original within 1 cent",
  () => {
    fc.assert(
      fc.property(betCentsArb, multiplierTenThousandthsArb, (betCents, multTenThousandths) => {
        const amount = Money.of(betCents);
        const multiplier = Multiplier.fromTenThousandths(multTenThousandths);

        const bet = Bet.place(
          BetId("bet-inv"),
          RoundId("round-inv"),
          PlayerId("player-inv"),
          amount,
          baseDate,
        ).confirm();
        const { payout } = bet.cashOut(multiplier, cashOutDate);

        const payoutCents = payout.toCents();
        const recovered = bankersDivide(payoutCents * 10_000n, multTenThousandths);
        const delta = recovered >= betCents ? recovered - betCents : betCents - recovered;

        expect(delta <= 1n).toBe(true);
      }),
      { numRuns: 10_000 },
    );
  },
  60_000,
);
