import { Inject, Injectable, Logger } from "@nestjs/common";
import { env } from "../config/defaults";
import type { RoundLoopService } from "./round-loop.service";
import { ROUND_LOOP_SERVICE } from "./tokens";
import { GameWsGateway } from "../presentation/gateways/game-ws.gateway";

@Injectable()
export class MultiplierBroadcastService {
  private readonly log = new Logger(MultiplierBroadcastService.name);
  private readonly intervalMs: number = Math.max(
    1,
    Math.round(1000 / env.SERVER_TICK_HZ),
  );
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentRoundId: string | null = null;

  constructor(
    @Inject(ROUND_LOOP_SERVICE)
    private readonly roundLoop: RoundLoopService,
    private readonly gateway: GameWsGateway,
  ) {}

  start(roundId: string): void {
    if (this.running) return;
    this.running = true;
    this.currentRoundId = roundId;
    this.scheduleNext();
  }

  stop(): void {
    if (!this.running && this.timer === null) return;
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.currentRoundId = null;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.fireTick(), this.intervalMs);
  }

  private fireTick(): void {
    if (!this.running) return;
    const now = new Date();
    const roundId = this.currentRoundId;
    try {
      const multiplier = this.roundLoop.getMultiplierAt(now);
      if (roundId !== null) {
        this.gateway.server.to("lobby").volatile.emit("round:tick", {
          roundId,
          multiplier: multiplier.toNumber(),
          t: now.getTime(),
        });
      }
    } catch {
      // Round transitioned out of RUNNING between schedule and fire — drop tick silently.
    } finally {
      this.scheduleNext();
    }
  }
}
