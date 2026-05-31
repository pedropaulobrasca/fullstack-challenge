import { makeHistogramProvider } from "@willsoto/nestjs-prometheus";

export const WS_BROADCAST_LATENCY_SECONDS = "crash_ws_broadcast_latency_seconds";

export const wsBroadcastLatencySecondsProvider = makeHistogramProvider({
  name: WS_BROADCAST_LATENCY_SECONDS,
  help: "Time between tick computation and socket.io emit() return, in seconds. Proxy for client RTT — true ack-RTT requires per-client ping which is out of scope here.",
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
});
