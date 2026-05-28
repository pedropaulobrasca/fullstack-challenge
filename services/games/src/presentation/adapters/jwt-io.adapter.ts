import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplicationContext } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import type { ServerOptions, Server, Socket } from "socket.io";
import { env } from "../../config/defaults";
import type { JwtVerifierService } from "../auth/jwt-verifier.service";

type HandshakeShape = {
  auth?: { token?: unknown };
  headers?: { authorization?: unknown };
};

export class JwtIoAdapter extends IoAdapter {
  private readonly log = new Logger(JwtIoAdapter.name);

  constructor(
    app: INestApplicationContext,
    private readonly verifier: JwtVerifierService,
  ) {
    super(app);
  }

  createIOServer(_port: number, options?: ServerOptions): Server {
    const standaloneOptions: Partial<ServerOptions> = {
      ...(options ?? {}),
      transports: ["websocket"],
      allowUpgrades: false,
    };
    const server: Server = super.createIOServer(
      env.WS_PORT,
      standaloneOptions as ServerOptions,
    );
    this.log.log(
      `socket.io listening on standalone port ${env.WS_PORT} (path ${env.WS_PATH})`,
    );
    server.use(async (socket: Socket, next: (err?: Error) => void) => {
      try {
        const token = this.extractToken(socket);
        if (!token) {
          return next(new Error("UNAUTHORIZED"));
        }
        const { playerId, tokenExp } = await this.verifier.verify(token);
        socket.data.playerId = playerId;
        socket.data.tokenExp = tokenExp;
        return next();
      } catch (err) {
        this.log.debug(
          `handshake rejected: ${err instanceof Error ? err.message : String(err)}`,
        );
        return next(new Error("UNAUTHORIZED"));
      }
    });
    return server;
  }

  private extractToken(socket: Socket): string | undefined {
    const handshake = socket.handshake as HandshakeShape | undefined;
    const authToken = handshake?.auth?.token;
    if (typeof authToken === "string" && authToken.length > 0) {
      return authToken;
    }
    const header = handshake?.headers?.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      const stripped = header.slice(7).trim();
      if (stripped.length > 0) return stripped;
    }
    return undefined;
  }
}
