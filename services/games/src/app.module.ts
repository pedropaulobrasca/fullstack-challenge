import { Module } from "@nestjs/common";
import { GamesController } from "./presentation/controllers/games.controller";
import { HealthController } from "./presentation/controllers/health.controller";

@Module({
  controllers: [GamesController, HealthController],
})
export class AppModule {}
