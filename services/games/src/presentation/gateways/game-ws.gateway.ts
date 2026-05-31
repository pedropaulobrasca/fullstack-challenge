import { Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { PlayerId, maskPlayerId } from "@crash/shared-kernel";
import { env } from "../../config/defaults";
import { GetWsSnapshotUseCase } from "../../application/use-cases/get-ws-snapshot.use-case";
import {
  GAME_EVENTS,
  type LeaderboardUpdatedPayload,
} from "../../application/game-events";
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

  constructor(private readonly snapshot: GetWsSnapshotUseCase) {}

  async handleConnection(socket: Socket): Promise<void> {
    const playerId = socket.data?.playerId;
    if (typeof playerId !== "string" || playerId.length === 0) {
      this.log.warn(`socket ${socket.id} missing playerId — disconnecting`);
      socket.disconnect(true);
      return;
    }

    socket.join("lobby");
    socket.join(`user:${playerId}`);

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

  handleDisconnect(_socket: Socket): void {}

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
    const entries = payload.entries.map((entry) => ({
      playerIdMasked: maskPlayerId(PlayerId(entry.playerId)),
      rank: entry.rank,
      netProfitCents: entry.netProfitCents.toString(),
    }));
    this.server.to("lobby").emit("leaderboard:updated", {
      entries,
      updatedAt: payload.updatedAt,
    });
  }
}
