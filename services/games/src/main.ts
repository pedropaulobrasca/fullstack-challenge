import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { env } from "./config/defaults";
import { JwtVerifierService } from "./presentation/auth/jwt-verifier.service";
import { JwtIoAdapter } from "./presentation/adapters/jwt-io.adapter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const verifier = app.get(JwtVerifierService);
  app.useWebSocketAdapter(new JwtIoAdapter(app, verifier));
  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
