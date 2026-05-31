import { makeGaugeProvider } from "@willsoto/nestjs-prometheus";

export const ACTIVE_WS_CONNECTIONS = "crash_active_ws_connections";

export const activeWsConnectionsProvider = makeGaugeProvider({
  name: ACTIVE_WS_CONNECTIONS,
  help: "Currently connected WebSocket clients",
});
