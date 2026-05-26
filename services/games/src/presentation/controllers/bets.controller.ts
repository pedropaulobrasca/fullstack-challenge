import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { PlayerId } from "@crash/shared-kernel";
import { GetPlayerBetsUseCase } from "../../application/use-cases/get-player-bets.use-case";
import { PlayerBetsDto, playerBetsQuerySchema } from "../dtos/player-bets.dto";
import { JwtGuard, type AuthenticatedRequest } from "../guards/jwt.guard";

@Controller("games/bets")
@UseGuards(JwtGuard)
export class BetsController {
  constructor(private readonly getPlayerBets: GetPlayerBetsUseCase) {}

  @Get("me")
  async me(
    @Req() req: AuthenticatedRequest,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<PlayerBetsDto> {
    const parsed = playerBetsQuerySchema.safeParse({ limit, offset });
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_QUERY",
        message: parsed.error.message,
      });
    }
    const playerId = PlayerId(req.user!.playerId);
    const view = await this.getPlayerBets.execute(
      playerId,
      parsed.data.limit,
      parsed.data.offset,
    );
    return view as unknown as PlayerBetsDto;
  }
}
