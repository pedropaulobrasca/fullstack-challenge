import "./tracing";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { env } from "./config/defaults";
import { JwtVerifierService } from "./presentation/auth/jwt-verifier.service";
import { JwtIoAdapter } from "./presentation/adapters/jwt-io.adapter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const verifier = app.get(JwtVerifierService);
  app.useWebSocketAdapter(new JwtIoAdapter(app, verifier));
  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
