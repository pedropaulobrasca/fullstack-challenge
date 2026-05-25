import { expect, test } from "bun:test";
import fc from "fast-check";
import { CorrelationId, Money, PlayerId, WalletId } from "@crash/shared-kernel";
import { Wallet } from "../../src/domain/wallet.aggregate";

type Op = { kind: "DEBIT" | "CREDIT"; cents: bigint };

const opAmountCents = fc.bigInt({ min: 1n, max: 1_000_000n });

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<"DEBIT" | "CREDIT">("DEBIT", "CREDIT"),
  cents: opAmountCents,
});

const opsArb = fc.array(opArb, { minLength: 0, maxLength: 100 });

const initialBalanceArb = fc.bigInt({ min: 1_000_000n, max: 1_000_000_000n });

const baseDate = new Date("2026-05-25T12:00:00Z");

test(
  "zero-net sequence of debits and credits returns wallet to original balance",
  async () => {
    await fc.assert(
      fc.asyncProperty(initialBalanceArb, opsArb, async (initialCents, ops) => {
        let wallet = Wallet.provision(
          WalletId("w-prop"),
          PlayerId("p-prop"),
          Money.of(initialCents),
          baseDate,
        );

        let netCents = 0n;
        let seq = 0;

        for (const op of ops) {
          if (op.kind === "DEBIT") {
            if (wallet.balance.toCents() < op.cents) {
              wallet = wallet.credit(
                Money.of(op.cents),
                CorrelationId(`cid-pad-${seq}`),
                `mid-pad-${seq}`,
                baseDate,
              ).next;
              netCents += op.cents;
              seq += 1;
            }
            wallet = wallet.debit(
              Money.of(op.cents),
              CorrelationId(`cid-${seq}`),
              `mid-${seq}`,
              baseDate,
            ).next;
            netCents -= op.cents;
          } else {
            wallet = wallet.credit(
              Money.of(op.cents),
              CorrelationId(`cid-${seq}`),
              `mid-${seq}`,
              baseDate,
            ).next;
            netCents += op.cents;
          }
          seq += 1;
        }

        if (netCents > 0n) {
          wallet = wallet.debit(
            Money.of(netCents),
            CorrelationId(`cid-bal-${seq}`),
            `mid-bal-${seq}`,
            baseDate,
          ).next;
        } else if (netCents < 0n) {
          wallet = wallet.credit(
            Money.of(-netCents),
            CorrelationId(`cid-bal-${seq}`),
            `mid-bal-${seq}`,
            baseDate,
          ).next;
        }

        expect(wallet.balance.toCents()).toBe(initialCents);
      }),
      { numRuns: 10_000 },
    );
  },
  30_000,
);

test("sanity: an off-by-one bug in the predicate makes the property fail", async () => {
  await expect(
    fc.assert(
      fc.asyncProperty(initialBalanceArb, async (initialCents) => {
        const wallet = Wallet.provision(
          WalletId("w-sanity"),
          PlayerId("p-sanity"),
          Money.of(initialCents),
          baseDate,
        );
        const credited = wallet.credit(
          Money.of(100n),
          CorrelationId("cid-sanity"),
          "mid-sanity",
          baseDate,
        ).next;
        const debited = credited.debit(
          Money.of(101n),
          CorrelationId("cid-sanity-2"),
          "mid-sanity-2",
          baseDate,
        ).next;
        expect(debited.balance.toCents()).toBe(initialCents);
      }),
      { numRuns: 10 },
    ),
  ).rejects.toThrow();
});
