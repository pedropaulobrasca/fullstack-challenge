import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { PlayerId } from "@crash/shared-kernel";

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
}
import { ProvisionWalletUseCase } from "../../application/use-cases/provision-wallet.use-case";
import { WALLET_REPOSITORY } from "../../application/use-cases/tokens";
import type { WalletRepository } from "../../domain/wallet.repository";
import { WalletViewDto } from "../dtos/wallet-view.dto";
import { JwtGuard, type AuthenticatedRequest } from "../guards/jwt.guard";
import { WalletView } from "../mappers/wallet-view.mapper";

@Controller("wallets")
@UseGuards(JwtGuard)
export class WalletsController {
  constructor(
    private readonly provision: ProvisionWalletUseCase,
    @Inject(WALLET_REPOSITORY) private readonly walletRepo: WalletRepository,
  ) {}

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: HttpResponseLike,
  ): Promise<WalletViewDto> {
    const playerId = PlayerId(req.user!.playerId);
    const { created, wallet } = await this.provision.execute(playerId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return WalletView.from(wallet);
  }

  @Get("me")
  async getMe(@Req() req: AuthenticatedRequest): Promise<WalletViewDto> {
    const playerId = PlayerId(req.user!.playerId);
    const wallet = await this.walletRepo.findByPlayerId(playerId);
    if (!wallet) {
      throw new NotFoundException({
        code: "WALLET_NOT_PROVISIONED",
        message: "Wallet not provisioned for player; call POST /wallets first.",
      });
    }
    return WalletView.from(wallet);
  }
}
