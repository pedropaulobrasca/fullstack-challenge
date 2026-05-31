/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeAll, describe, expect, test } from "bun:test";
import { setupGamesTestEnv } from "../../../setup";

setupGamesTestEnv();

import { randomUUID } from "node:crypto";
import { RoundId } from "@crash/shared-kernel";
import type { RoundRepository } from "../../../../src/domain/round.repository";
import type { SeedChainRepository } from "../../../../src/domain/seed-chain.repository";
import type { BetRepository } from "../../../../src/domain/bet.repository";
import type { Round } from "../../../../src/domain/round.aggregate";

type SettleCtor = typeof import("../../../../src/application/use-cases/settle-round.use-case")["SettleRoundUseCase"];
type RoundExport = typeof import("../../../../src/domain/round.aggregate")["Round"];

let SettleRoundUseCase: SettleCtor;
let RoundAgg: RoundExport;
let CrashPoint: typeof import("../../../../src/domain/value-objects/crash-point")["CrashPoint"];

beforeAll(async () => {
  ({ SettleRoundUseCase } = await import(
    "../../../../src/application/use-cases/settle-round.use-case"
  ));
  ({ Round: RoundAgg } = await import("../../../../src/domain/round.aggregate"));
  ({ CrashPoint } = await import("../../../../src/domain/value-objects/crash-point"));
});

class FakeGauge {
  public setCalls: number[] = [];
  set(value: number): void {
    this.setCalls.push(value);
  }
}

function buildCrashedRound(): Round {
  const now = new Date();
  const scheduled = RoundAgg.schedule(
    RoundId(randomUUID()),
    0n,
    "a".repeat(64),
    "client",
    1,
    new Date(now.getTime() + 1000),
    now,
  );
  return scheduled.start(now).crash(CrashPoint.of(150), new Date(now.getTime() + 500));
}

describe("crash_rtp_window gauge — observation sites", () => {
  test("SettleRoundUseCase sets gauge to sum(payouts)/sum(bets) over the env-driven window", async () => {
    const round = buildCrashedRound();
    const gauge = new FakeGauge();

    const rounds: Partial<RoundRepository> = {
      async transitionFromCrashedToSettled(): Promise<Round | null> {
        return round;
      },
    };
    const chain: Partial<SeedChainRepository> = {
      async findSeedByNonce(): Promise<string | null> {
        return "deadbeef".repeat(8);
      },
      async revealSeedAtNonce(): Promise<void> {},
    };

    let windowArg: number | null = null;
    const bets: Partial<BetRepository> & {
      getRollingRtp: (window: number) => Promise<{ payoutTotalCents: bigint; betTotalCents: bigint }>;
    } = {
      async getRollingRtp(window: number) {
        windowArg = window;
        return { payoutTotalCents: 9700n, betTotalCents: 10000n };
      },
    } as never;

    const useCase = new SettleRoundUseCase(
      rounds as RoundRepository,
      chain as SeedChainRepository,
      bets as unknown as BetRepository,
      gauge as unknown as never,
    );

    await useCase.execute(round, new Date());

    expect(windowArg).toBe(100);
    expect(gauge.setCalls).toHaveLength(1);
    expect(gauge.setCalls[0]).toBeCloseTo(0.97, 5);
  });

  test("guards against division by zero when no bets fall in the window", async () => {
    const round = buildCrashedRound();
    const gauge = new FakeGauge();

    const rounds: Partial<RoundRepository> = {
      async transitionFromCrashedToSettled(): Promise<Round | null> {
        return round;
      },
    };
    const chain: Partial<SeedChainRepository> = {
      async findSeedByNonce(): Promise<string | null> {
        return "deadbeef".repeat(8);
      },
      async revealSeedAtNonce(): Promise<void> {},
    };
    const bets = {
      async getRollingRtp() {
        return { payoutTotalCents: 0n, betTotalCents: 0n };
      },
    };

    const useCase = new SettleRoundUseCase(
      rounds as RoundRepository,
      chain as SeedChainRepository,
      bets as unknown as BetRepository,
      gauge as unknown as never,
    );

    await useCase.execute(round, new Date());

    expect(gauge.setCalls).toHaveLength(1);
    expect(gauge.setCalls[0]).toBe(0);
  });
});
