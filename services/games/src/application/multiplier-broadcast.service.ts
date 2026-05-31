import { Injectable, Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { getToken } from "@willsoto/nestjs-prometheus";
import type { Histogram } from "prom-client";
import { RoundId } from "@crash/shared-kernel/identity";
import { env } from "../config/defaults";
import type { RoundLoopService } from "./round-loop.service";
import { ROUND_LOOP_SERVICE } from "./tokens";
import { GAME_EVENTS, type RoundTickPayload } from "./game-events";
import type { GameWsGateway } from "../presentation/gateways/game-ws.gateway";
import { MULTIPLIER_DRIFT_SECONDS } from "../observability/metrics/multiplier-drift.metric";
import { WS_BROADCAST_LATENCY_SECONDS } from "../observability/metrics/ws-broadcast-latency.metric";

type NoopObserver = { observe(value: number): void };

const noopHistogram: NoopObserver = { observe: () => undefined };

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
  private multiplierDriftRef: NoopObserver | null = null;
  private wsBroadcastLatencyRef: NoopObserver | null = null;
  private expectedNextTickAt: number = 0;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  setTestDeps(deps: {
    roundLoop: RoundLoopService;
    gateway: GameWsGateway;
    multiplierDrift?: NoopObserver;
    wsBroadcastLatency?: NoopObserver;
  }): void {
    this.roundLoopRef = deps.roundLoop;
    this.gatewayRef = deps.gateway;
    this.multiplierDriftRef = deps.multiplierDrift ?? noopHistogram;
    this.wsBroadcastLatencyRef = deps.wsBroadcastLatency ?? noopHistogram;
  }

  private resolveGateway(): GameWsGateway | null {
    if (this.gatewayRef !== null) return this.gatewayRef;
    const { GameWsGateway } = require("../presentation/gateways/game-ws.gateway");
    this.gatewayRef = this.moduleRef.get(GameWsGateway, { strict: false });
    return this.gatewayRef;
  }

  private resolveRoundLoop(): RoundLoopService {
    if (this.roundLoopRef !== null) return this.roundLoopRef;
    this.roundLoopRef = this.moduleRef.get<RoundLoopService>(
      ROUND_LOOP_SERVICE,
      { strict: false },
    );
    return this.roundLoopRef;
  }

  private resolveMultiplierDrift(): NoopObserver {
    if (this.multiplierDriftRef !== null) return this.multiplierDriftRef;
    try {
      const histogram = this.moduleRef.get<Histogram<string>>(
        getToken(MULTIPLIER_DRIFT_SECONDS),
        { strict: false },
      );
      this.multiplierDriftRef = histogram ?? noopHistogram;
    } catch {
      this.multiplierDriftRef = noopHistogram;
    }
    return this.multiplierDriftRef;
  }

  private resolveWsBroadcastLatency(): NoopObserver {
    if (this.wsBroadcastLatencyRef !== null) return this.wsBroadcastLatencyRef;
    try {
      const histogram = this.moduleRef.get<Histogram<string>>(
        getToken(WS_BROADCAST_LATENCY_SECONDS),
        { strict: false },
      );
      this.wsBroadcastLatencyRef = histogram ?? noopHistogram;
    } catch {
      this.wsBroadcastLatencyRef = noopHistogram;
    }
    return this.wsBroadcastLatencyRef;
  }

  start(roundId: string): void {
    if (this.running) return;
    this.running = true;
    this.currentRoundId = roundId;
    this.expectedNextTickAt = Date.now() + this.intervalMs;
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
    this.expectedNextTickAt = 0;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => this.fireTick(), this.intervalMs);
  }

  private fireTick(): void {
    if (!this.running) return;

    const tickEntryMs = Date.now();
    const driftSeconds =
      this.expectedNextTickAt > 0
        ? Math.max(0, (tickEntryMs - this.expectedNextTickAt) / 1000)
        : 0;
    this.resolveMultiplierDrift().observe(driftSeconds);

    const now = new Date(tickEntryMs);
    const roundId = this.currentRoundId;
    try {
      const multiplier = this.resolveRoundLoop().getMultiplierAt(now);
      const gateway = this.resolveGateway();
      if (roundId !== null && gateway !== null) {
        const multiplierNumber = multiplier.toNumber();
        const tickTime = now.getTime();
        const emitStart = performance.now();
        gateway.server.to("lobby").volatile.emit("round:tick", {
          roundId,
          multiplier: multiplierNumber,
          t: tickTime,
        });
        const emitDurationSeconds = (performance.now() - emitStart) / 1000;
        this.resolveWsBroadcastLatency().observe(emitDurationSeconds);
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
      this.expectedNextTickAt = tickEntryMs + this.intervalMs;
      this.scheduleNext();
    }
  }
}
