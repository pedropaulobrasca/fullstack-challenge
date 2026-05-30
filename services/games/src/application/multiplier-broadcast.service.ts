import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { RoundId } from "@crash/shared-kernel";
import { env } from "../config/defaults";
import type { RoundLoopService } from "./round-loop.service";
import { ROUND_LOOP_SERVICE } from "./tokens";
import { GAME_EVENTS, type RoundTickPayload } from "./game-events";
import type { GameWsGateway } from "../presentation/gateways/game-ws.gateway";

type DirectDeps = {
  roundLoop: RoundLoopService;
  gateway: GameWsGateway;
  eventEmitter: EventEmitter2;
};

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
  private gatewayRef: GameWsGateway | null = null;
  private roundLoopRef: RoundLoopService | null = null;
  private readonly moduleRef: ModuleRef | null;
  private readonly direct: DirectDeps | null;
  private readonly eventEmitter: EventEmitter2;

  constructor(moduleRef: ModuleRef, eventEmitter: EventEmitter2);
  constructor(
    roundLoop: RoundLoopService,
    gateway: GameWsGateway,
    eventEmitter: EventEmitter2,
  );
  constructor(
    a: ModuleRef | RoundLoopService,
    b: EventEmitter2 | GameWsGateway,
    c?: EventEmitter2,
  ) {
    if (c === undefined) {
      this.moduleRef = a as ModuleRef;
      this.direct = null;
      this.eventEmitter = b as EventEmitter2;
    } else {
      this.moduleRef = null;
      this.direct = {
        roundLoop: a as RoundLoopService,
        gateway: b as GameWsGateway,
        eventEmitter: c,
      };
      this.eventEmitter = c;
    }
  }

  private resolveGateway(): GameWsGateway | null {
    if (this.direct !== null) return this.direct.gateway;
    if (this.gatewayRef !== null) return this.gatewayRef;
    if (this.moduleRef === null) return null;
    const { GameWsGateway } = require("../presentation/gateways/game-ws.gateway");
    this.gatewayRef = this.moduleRef.get(GameWsGateway, { strict: false });
    return this.gatewayRef;
  }

  private resolveRoundLoop(): RoundLoopService {
    if (this.direct !== null) return this.direct.roundLoop;
    if (this.roundLoopRef !== null) return this.roundLoopRef;
    if (this.moduleRef === null) {
      throw new Error("MultiplierBroadcastService has no resolution path");
    }
    this.roundLoopRef = this.moduleRef.get<RoundLoopService>(
      ROUND_LOOP_SERVICE,
      { strict: false },
    );
    return this.roundLoopRef;
  }

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
      const multiplier = this.resolveRoundLoop().getMultiplierAt(now);
      const gateway = this.resolveGateway();
      if (roundId !== null && gateway !== null) {
        const multiplierNumber = multiplier.toNumber();
        const tickTime = now.getTime();
        gateway.server.to("lobby").volatile.emit("round:tick", {
          roundId,
          multiplier: multiplierNumber,
          t: tickTime,
        });
        try {
          const payload: RoundTickPayload = {
            roundId: RoundId(roundId),
            multiplier: multiplierNumber,
            t: tickTime,
          };
          this.eventEmitter.emit(GAME_EVENTS.ROUND_TICK, payload);
        } catch (err) {
          this.log.error(
            "ROUND_TICK in-process emit failed — broadcast loop continues",
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    } catch {
      // Round transitioned out of RUNNING between schedule and fire — drop tick silently.
    } finally {
      this.scheduleNext();
    }
  }
}
