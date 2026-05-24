import { Module } from "@nestjs/common";
import { WalletsController } from "./presentation/controllers/wallets.controller";
import { HealthController } from "./presentation/controllers/health.controller";

@Module({
  controllers: [WalletsController, HealthController],
})
export class AppModule {}
