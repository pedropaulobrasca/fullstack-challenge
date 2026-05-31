import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { OpenTelemetryModule } from "nestjs-otel";
import { PrometheusModule } from "@willsoto/nestjs-prometheus";
import { ClsService } from "nestjs-cls";

import { buildPinoOptions } from "./pino-config";

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
  exports: [LoggerModule, OpenTelemetryModule, PrometheusModule],
})
export class ObservabilityModule {}
