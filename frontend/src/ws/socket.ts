import { io, type Socket } from "socket.io-client";
import { getConfig } from "@/lib/config";
import { getOidc } from "@/auth/oidc";

let socket: Socket | undefined;

async function resolveAuthToken(): Promise<{ token: string } | Record<string, never>> {
  const oidc = await getOidc();
  if (!oidc.isUserLoggedIn) {
    return {};
  }
  const accessToken = await oidc.getAccessToken();
  return { token: accessToken };
}

export function getSocket(): Socket {
  if (socket === undefined) {
    const { ws } = getConfig();
    socket = io(ws.url, {
      path: "/ws",
      transports: ["websocket"],
      auth: (cb) => {
        void resolveAuthToken().then(cb);
      },
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket !== undefined) {
    socket.disconnect();
    socket = undefined;
  }
}
