import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { crashTimeMs, deriveCrashPoint } from "@crash/contracts";
import { env } from "../config/defaults";
import { Round } from "../domain/round.aggregate";
import { CrashPoint } from "../domain/value-objects/crash-point";
import { Multiplier } from "../domain/value-objects/multiplier";
import type { RoundRepository } from "../domain/round.repository";
import type { SeedChainRepository } from "../domain/seed-chain.repository";
import {
  MULTIPLIER_BROADCAST_SERVICE,
  ROUND_REPOSITORY,
  SEED_CHAIN_REPOSITORY,
} from "./tokens";
import { StartNewRoundUseCase } from "./use-cases/start-new-round.use-case";
import { TransitionToRunningUseCase } from "./use-cases/transition-to-running.use-case";
import { CrashRoundUseCase } from "./use-cases/crash-round.use-case";
import { SettleRoundUseCase } from "./use-cases/settle-round.use-case";
import type { MultiplierBroadcastService } from "./multiplier-broadcast.service";
import { GAME_EVENTS } from "./game-events";

const ERROR_BACKOFF_MS = 1000;

@Injectable()
export class RoundLoopService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly log = new Logger(RoundLoopService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private currentRound: Round | null = null;
  private currentCrashPoint: CrashPoint | null = null;

  constructor(
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(SEED_CHAIN_REPOSITORY) private readonly chain: SeedChainRepository,
    private readonly startNewRoundUseCase: StartNewRoundUseCase,
    private readonly transitionToRunningUseCase: TransitionToRunningUseCase,
    private readonly crashRoundUseCase: CrashRoundUseCase,
    private readonly settleRoundUseCase: SettleRoundUseCase,
    private readonly eventEmitter: EventEmitter2,
    @Inject(MULTIPLIER_BROADCAST_SERVICE)
    private readonly multiplierBroadcast: MultiplierBroadcastService,
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

    this.currentRound = open;
    this.currentCrashPoint = open.crashPoint;
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
        this.currentCrashPoint = recovered.crashPoint;
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
        this.currentRound = reswept;
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
    this.currentRound = round;
    this.currentCrashPoint = null;
    this.log.log(
      `round ${round.id as unknown as string} scheduled (nonce=${round.nonce.toString()}, bettingEndsAt=${round.bettingEndsAt.toISOString()})`,
    );
    this.scheduleAt(env.BETTING_WINDOW_MS, () =>
      this.transitionToRunning(round),
    );
    this.eventEmitter.emit(GAME_EVENTS.ROUND_STARTED, {
      roundId: round.id as unknown as string,
      nonce: round.nonce.toString(),
      seedHash: round.seedHash,
      bettingEndsAt: round.bettingEndsAt.toISOString(),
    });
  }

  private async transitionToRunning(round: Round): Promise<void> {
    const result = await this.transitionToRunningUseCase.execute(
      round,
      new Date(),
    );
    this.currentRound = result.round;
    this.currentCrashPoint = result.crashPoint;
    this.log.log(
      `round ${result.round.id as unknown as string} running (crashPoint=${result.crashPoint.toNumber()}, crashTimeMs=${result.crashTimeMs})`,
    );
    this.scheduleAt(result.crashTimeMs, () =>
      this.crashRound(result.round, result.crashPoint),
    );
    this.multiplierBroadcast.start(result.round.id as unknown as string);
    this.eventEmitter.emit(GAME_EVENTS.ROUND_RUNNING, {
      roundId: result.round.id as unknown as string,
      startedAt: result.round.startedAt!.toISOString(),
    });
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
    this.currentRound = crashed;
    this.currentCrashPoint = crashPoint;
    this.log.log(
      `round ${crashed.id as unknown as string} crashed at ${crashPoint.toNumber()}x`,
    );
    this.multiplierBroadcast.stop();
    this.eventEmitter.emit(GAME_EVENTS.ROUND_CRASHED, {
      roundId: crashed.id as unknown as string,
      crashPoint: crashPoint.toNumber(),
      crashedAt: (crashed.crashedAt ?? new Date()).toISOString(),
    });
    this.scheduleAt(0, () => this.settleRound(crashed));
  }

  private async settleRound(round: Round): Promise<void> {
    const settled = await this.settleRoundUseCase.execute(round, new Date());
    this.currentRound = settled;
    this.log.log(
      `round ${settled.id as unknown as string} settled (seed revealed)`,
    );
    this.scheduleAt(env.COOLDOWN_MS, () => this.startNewRound(new Date()));
    this.eventEmitter.emit(GAME_EVENTS.ROUND_SETTLED, {
      roundId: settled.id as unknown as string,
      serverSeed: settled.serverSeed!,
      settledAt: (settled.settledAt ?? new Date()).toISOString(),
    });
  }

  public getMultiplierAt(at: Date): Multiplier {
    const round = this.currentRound;
    if (round === null || round.status !== "RUNNING" || round.startedAt === null) {
      throw new Error("no RUNNING round available for multiplier query");
    }
    const elapsedMs = Math.max(0, at.getTime() - round.startedAt.getTime());
    const raw = Math.exp((env.GROWTH_RATE * elapsedMs) / 1000);
    const cap = this.currentCrashPoint;
    if (cap !== null && raw >= cap.toNumber()) {
      return Multiplier.of(cap.toNumber());
    }
    return Multiplier.of(raw);
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
