import { makeCounterProvider } from "@willsoto/nestjs-prometheus";

export const BET_VOLUME_TOTAL = "crash_bet_volume_total";

export const betVolumeTotalProvider = makeCounterProvider({
  name: BET_VOLUME_TOTAL,
  help: "Total bet volume in cents, labeled by terminal status",
  labelNames: ["status"] as const,
});
