import { Module } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { SeedChainEntitySchema } from "../infrastructure/persistence/seed-chain.entity";
import { RoundEntitySchema } from "../infrastructure/persistence/round.entity";
import { BetEntitySchema } from "../infrastructure/persistence/bet.entity";
import { BetSagaStateEntitySchema } from "../infrastructure/persistence/bet-saga-state.entity";
import { MikroSeedChainRepository } from "../infrastructure/repositories/mikro-seed-chain.repository";
import { MikroRoundRepository } from "../infrastructure/repositories/mikro-round.repository";
import { MikroBetRepository } from "../infrastructure/repositories/mikro-bet.repository";
import { MikroBetSagaStateRepository } from "../infrastructure/repositories/mikro-bet-saga-state.repository";
import {
  BET_REPOSITORY,
  BET_SAGA_REPOSITORY,
  ROUND_REPOSITORY,
  SEED_CHAIN_REPOSITORY,
} from "./tokens";
import { SeedChainBootstrap } from "./seed-chain-bootstrap.service";
import { GetCurrentRoundUseCase } from "./use-cases/get-current-round.use-case";
import { GetPlayerBetsUseCase } from "./use-cases/get-player-bets.use-case";
import { GetWsSnapshotUseCase } from "./use-cases/get-ws-snapshot.use-case";
import { GetRoundHistoryUseCase } from "./use-cases/get-round-history.use-case";
import { VerifyRoundUseCase } from "./use-cases/verify-round.use-case";
import { StartNewRoundUseCase } from "./use-cases/start-new-round.use-case";
import { TransitionToRunningUseCase } from "./use-cases/transition-to-running.use-case";
import { CrashRoundUseCase } from "./use-cases/crash-round.use-case";
import { SettleRoundUseCase } from "./use-cases/settle-round.use-case";
import { PlaceBetUseCase } from "./use-cases/place-bet.use-case";
import { CashOutUseCase } from "./use-cases/cash-out.use-case";
import { RoundLoopService } from "./round-loop.service";
import { SagaTimeoutSweeper } from "./saga-timeout-sweeper.service";
import { WalletDebitedHandler } from "./handlers/wallet-debited.handler";
import { WalletDebitRejectedHandler } from "./handlers/wallet-debit-rejected.handler";

@Module({
  imports: [
    MikroOrmModule.forFeature([
      SeedChainEntitySchema,
      RoundEntitySchema,
      BetEntitySchema,
      BetSagaStateEntitySchema,
    ]),
  ],
  providers: [
    { provide: SEED_CHAIN_REPOSITORY, useClass: MikroSeedChainRepository },
    { provide: ROUND_REPOSITORY, useClass: MikroRoundRepository },
    { provide: BET_REPOSITORY, useClass: MikroBetRepository },
    { provide: BET_SAGA_REPOSITORY, useClass: MikroBetSagaStateRepository },
    SeedChainBootstrap,
    GetCurrentRoundUseCase,
    GetRoundHistoryUseCase,
    VerifyRoundUseCase,
    GetPlayerBetsUseCase,
    GetWsSnapshotUseCase,
    StartNewRoundUseCase,
    TransitionToRunningUseCase,
    CrashRoundUseCase,
    SettleRoundUseCase,
    PlaceBetUseCase,
    CashOutUseCase,
    RoundLoopService,
    SagaTimeoutSweeper,
    WalletDebitedHandler,
    WalletDebitRejectedHandler,
  ],
  exports: [
    SEED_CHAIN_REPOSITORY,
    ROUND_REPOSITORY,
    BET_REPOSITORY,
    BET_SAGA_REPOSITORY,
    GetCurrentRoundUseCase,
    GetRoundHistoryUseCase,
    VerifyRoundUseCase,
    GetPlayerBetsUseCase,
    GetWsSnapshotUseCase,
    PlaceBetUseCase,
    CashOutUseCase,
    RoundLoopService,
  ],
})
export class GameCoreModule {}
