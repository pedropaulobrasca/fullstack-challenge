import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { OpenTelemetryModule } from "nestjs-otel";
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
    LoggerModule.forRootAsync({
      inject: [ClsService],
      useFactory: (cls: ClsService) => ({ pinoHttp: buildPinoOptions(cls) }),
    }),
  ],
  exports: [LoggerModule, OpenTelemetryModule],
})
export class ObservabilityModule {}
