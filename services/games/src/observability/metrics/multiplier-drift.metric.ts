import { makeHistogramProvider } from "@willsoto/nestjs-prometheus";

export const MULTIPLIER_DRIFT_SECONDS = "crash_multiplier_drift_seconds";

export const multiplierDriftSecondsProvider = makeHistogramProvider({
  name: MULTIPLIER_DRIFT_SECONDS,
  help: "Difference between expected tick time and actual emit time, in seconds",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});
