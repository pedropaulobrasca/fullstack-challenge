import { Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Gauge } from "prom-client";
import { PlayerId } from "@crash/shared-kernel/identity";
import { env } from "../../config/defaults";
import { GetWsSnapshotUseCase } from "../../application/use-cases/get-ws-snapshot.use-case";
import {
  GAME_EVENTS,
  type LeaderboardUpdatedPayload,
} from "../../application/game-events";
import { leaderboardSnapshotEntryToWire } from "../../application/use-cases/get-leaderboard.use-case";
import { ACTIVE_WS_CONNECTIONS } from "../../observability/metrics/active-ws-connections.metric";
import type {
  RoundStartedPayload,
  RoundRunningPayload,
  RoundCrashedPayload,
  RoundSettledPayload,
} from "../dtos/ws-event.payloads";

@WebSocketGateway({
  path: env.WS_PATH,
  cors: { origin: true, credentials: true },
})
export class GameWsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly log = new Logger(GameWsGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly snapshot: GetWsSnapshotUseCase,
    @InjectMetric(ACTIVE_WS_CONNECTIONS)
    private readonly wsConnections: Gauge<string>,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const playerId = socket.data?.playerId;
    if (typeof playerId !== "string" || playerId.length === 0) {
      this.log.warn(`socket ${socket.id} missing playerId — disconnecting`);
      socket.disconnect(true);
      return;
    }

    socket.join("lobby");
    socket.join(`user:${playerId}`);
    this.wsConnections.inc();

    try {
      const payload = await this.snapshot.execute(PlayerId(playerId));
      socket.emit("round:snapshot", payload);
    } catch (err) {
      this.log.error(
        `snapshot assembly failed for socket ${socket.id}`,
        err instanceof Error ? err.stack : String(err),
      );
      socket.disconnect(true);
    }
  }

  handleDisconnect(_socket: Socket): void {
    this.wsConnections.dec();
  }

  emitToLobby(event: string, payload: unknown): void {
    this.server.to("lobby").emit(event, payload);
  }

  emitToPlayer(playerId: string, event: string, payload: unknown): void {
    this.server.to(`user:${playerId}`).emit(event, payload);
  }

  @OnEvent(GAME_EVENTS.ROUND_STARTED)
  onRoundStarted(payload: RoundStartedPayload): void {
    this.server.to("lobby").emit("round:started", payload);
  }

  @OnEvent(GAME_EVENTS.ROUND_RUNNING)
  onRoundRunning(payload: RoundRunningPayload): void {
    this.server.to("lobby").emit("round:running", payload);
  }

  @OnEvent(GAME_EVENTS.ROUND_CRASHED)
  onRoundCrashed(payload: RoundCrashedPayload): void {
    this.server.to("lobby").emit("round:crashed", payload);
  }

  @OnEvent(GAME_EVENTS.ROUND_SETTLED)
  onRoundSettled(payload: RoundSettledPayload): void {
    this.server.to("lobby").emit("round:settled", payload);
  }

  @OnEvent(GAME_EVENTS.LEADERBOARD_UPDATED)
  onLeaderboardUpdated(payload: LeaderboardUpdatedPayload): void {
    const entries = payload.entries.map(leaderboardSnapshotEntryToWire);
    this.server.to("lobby").emit("leaderboard:updated", {
      entries,
      updatedAt: payload.updatedAt,
    });
  }
}
