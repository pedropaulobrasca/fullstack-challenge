import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { crashTimeMs, deriveCrashPoint } from "@crash/contracts";
import { env } from "../config/defaults";
import { Round } from "../domain/round.aggregate";
import { CrashPoint } from "../domain/value-objects/crash-point";
import type { RoundRepository } from "../domain/round.repository";
import type { SeedChainRepository } from "../domain/seed-chain.repository";
import { ROUND_REPOSITORY, SEED_CHAIN_REPOSITORY } from "./tokens";
import { StartNewRoundUseCase } from "./use-cases/start-new-round.use-case";
import { TransitionToRunningUseCase } from "./use-cases/transition-to-running.use-case";
import { CrashRoundUseCase } from "./use-cases/crash-round.use-case";
import { SettleRoundUseCase } from "./use-cases/settle-round.use-case";

const ERROR_BACKOFF_MS = 1000;

@Injectable()
export class RoundLoopService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger(RoundLoopService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(SEED_CHAIN_REPOSITORY) private readonly chain: SeedChainRepository,
    private readonly startNewRoundUseCase: StartNewRoundUseCase,
    private readonly transitionToRunningUseCase: TransitionToRunningUseCase,
    private readonly crashRoundUseCase: CrashRoundUseCase,
    private readonly settleRoundUseCase: SettleRoundUseCase,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.running = true;
    try {
      await this.recoverInFlightRound();
    } catch (err) {
      this.log.error(
        `round loop bootstrap failed; retrying in ${ERROR_BACKOFF_MS}ms`,
        err instanceof Error ? err.stack : String(err),
      );
      this.scheduleAt(ERROR_BACKOFF_MS, () => this.recoverInFlightRound());
    }
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.log.log(`round loop shutting down on ${signal ?? "unknown"}`);
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async recoverInFlightRound(): Promise<void> {
    const open = await this.rounds.findOpen();
    if (open === null) {
      await this.startNewRound(new Date());
      return;
    }

    const now = Date.now();
    switch (open.status) {
      case "BETTING": {
        const remaining = open.bettingEndsAt.getTime() - now;
        if (remaining <= 0) {
          await this.transitionToRunning(open);
        } else {
          this.scheduleAt(remaining, () => this.transitionToRunning(open));
        }
        return;
      }
      case "RUNNING": {
        const recovered = await this.recoverRunningRound(open);
        const elapsed = now - (open.startedAt?.getTime() ?? now);
        if (elapsed >= recovered.crashTimeMs) {
          await this.crashRound(open, recovered.crashPoint);
        } else {
          this.scheduleAt(recovered.crashTimeMs - elapsed, () =>
            this.crashRound(open, recovered.crashPoint),
          );
        }
        return;
      }
      case "CRASHED": {
        if (open.crashPoint === null) {
          throw new Error(
            `CRASHED round ${open.id as unknown as string} has no crashPoint persisted`,
          );
        }
        const reswept = await this.crashRoundUseCase.execute(
          open,
          open.crashPoint,
          new Date(),
        );
        await this.settleRound(reswept);
        return;
      }
      case "SETTLED": {
        await this.startNewRound(new Date());
        return;
      }
    }
  }

  private async recoverRunningRound(
    round: Round,
  ): Promise<{ crashPoint: CrashPoint; crashTimeMs: number }> {
    const serverSeed = await this.chain.findSeedByNonce(round.nonce);
    if (serverSeed === null) {
      throw new Error(
        `cannot recover RUNNING round ${round.id as unknown as string}: seed missing at nonce ${round.nonce.toString()}`,
      );
    }
    const value = deriveCrashPoint({
      serverSeed,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      instantCrashBucket: env.INSTANT_CRASH_BUCKET,
    });
    return {
      crashPoint: CrashPoint.of(value),
      crashTimeMs: crashTimeMs(env.GROWTH_RATE, value),
    };
  }

  private async startNewRound(now: Date): Promise<void> {
    const round = await this.startNewRoundUseCase.execute(now);
    this.log.log(
      `round ${round.id as unknown as string} scheduled (nonce=${round.nonce.toString()}, bettingEndsAt=${round.bettingEndsAt.toISOString()})`,
    );
    this.scheduleAt(env.BETTING_WINDOW_MS, () =>
      this.transitionToRunning(round),
    );
  }

  private async transitionToRunning(round: Round): Promise<void> {
    const result = await this.transitionToRunningUseCase.execute(
      round,
      new Date(),
    );
    this.log.log(
      `round ${result.round.id as unknown as string} running (crashPoint=${result.crashPoint.toNumber()}, crashTimeMs=${result.crashTimeMs})`,
    );
    this.scheduleAt(result.crashTimeMs, () =>
      this.crashRound(result.round, result.crashPoint),
    );
  }

  private async crashRound(
    round: Round,
    crashPoint: CrashPoint,
  ): Promise<void> {
    const crashed = await this.crashRoundUseCase.execute(
      round,
      crashPoint,
      new Date(),
    );
    this.log.log(
      `round ${crashed.id as unknown as string} crashed at ${crashPoint.toNumber()}x`,
    );
    this.scheduleAt(0, () => this.settleRound(crashed));
  }

  private async settleRound(round: Round): Promise<void> {
    const settled = await this.settleRoundUseCase.execute(round, new Date());
    this.log.log(
      `round ${settled.id as unknown as string} settled (seed revealed)`,
    );
    this.scheduleAt(env.COOLDOWN_MS, () => this.startNewRound(new Date()));
  }

  private scheduleAt(ms: number, fn: () => Promise<void>): void {
    if (!this.running) return;
    const delay = Math.max(0, ms);
    this.timer = setTimeout(() => {
      if (!this.running) return;
      fn().catch((err) => {
        this.log.error(
          `round loop step failed; retrying in ${ERROR_BACKOFF_MS}ms`,
          err instanceof Error ? err.stack : String(err),
        );
        this.scheduleAt(ERROR_BACKOFF_MS, fn);
      });
    }, delay);
  }
}
