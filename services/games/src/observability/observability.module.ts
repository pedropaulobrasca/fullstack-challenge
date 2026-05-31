import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { OpenTelemetryModule } from "nestjs-otel";
import { PrometheusModule } from "@willsoto/nestjs-prometheus";
import { ClsService } from "nestjs-cls";

import { buildPinoOptions } from "./pino-config";
import { betVolumeTotalProvider } from "./metrics/bet-volume.metric";
import { crashRtpWindowProvider } from "./metrics/crash-rtp-window.metric";
import { multiplierDriftSecondsProvider } from "./metrics/multiplier-drift.metric";
import { wsBroadcastLatencySecondsProvider } from "./metrics/ws-broadcast-latency.metric";
import { activeWsConnectionsProvider } from "./metrics/active-ws-connections.metric";

@Module({
  imports: [
    OpenTelemetryModule.forRoot({
      metrics: {
        hostMetrics: false,
        apiMetrics: { enable: true },
      },
    }),
    PrometheusModule.register({
      path: "/metrics",
      defaultMetrics: { enabled: true },
    }),
    LoggerModule.forRootAsync({
      inject: [ClsService],
      useFactory: (cls: ClsService) => ({ pinoHttp: buildPinoOptions(cls) }),
    }),
  ],
  providers: [
    betVolumeTotalProvider,
    crashRtpWindowProvider,
    multiplierDriftSecondsProvider,
    wsBroadcastLatencySecondsProvider,
    activeWsConnectionsProvider,
  ],
  exports: [
    LoggerModule,
    OpenTelemetryModule,
    PrometheusModule,
    betVolumeTotalProvider,
    crashRtpWindowProvider,
    multiplierDriftSecondsProvider,
    wsBroadcastLatencySecondsProvider,
    activeWsConnectionsProvider,
  ],
})
export class ObservabilityModule {}
