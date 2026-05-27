import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Money, PlayerId } from "@crash/shared-kernel";
import { env } from "../../config/defaults";
import { PlaceBetUseCase } from "../../application/use-cases/place-bet.use-case";
import {
  BetAlreadyActiveError,
  BetAmountOutOfBoundsError,
  RoundNotInBettingPhaseError,
} from "../../domain/errors";
import { PlaceBetRequestDto } from "../dtos/place-bet.request.dto";
import { PlaceBetResponseDto } from "../dtos/place-bet.response.dto";
import { JwtGuard, type AuthenticatedRequest } from "../guards/jwt.guard";

@Controller("games/bet")
@UseGuards(JwtGuard)
export class BetCommandController {
  constructor(private readonly placeBet: PlaceBetUseCase) {}

  @Post()
  @HttpCode(202)
  async place(
    @Req() req: AuthenticatedRequest,
    @Body() body: PlaceBetRequestDto,
  ): Promise<PlaceBetResponseDto> {
    const playerId = PlayerId(req.user!.playerId);
    const amount = Money.fromSnapshot({
      amount: body.amountCents.toString(),
      currency: env.CURRENCY_CODE,
      scale: env.CURRENCY_EXPONENT,
    });
    try {
      const result = await this.placeBet.execute({
        playerId,
        amount,
        now: new Date(),
      });
      return {
        betId: result.betId as unknown as string,
        status: result.status,
      };
    } catch (err) {
      this.translateError(err);
    }
  }

  private translateError(err: unknown): never {
    if (err instanceof RoundNotInBettingPhaseError) {
      throw new ConflictException({
        code: "ROUND_NOT_IN_BETTING_PHASE",
        phase: err.actual,
      });
    }
    if (err instanceof BetAlreadyActiveError) {
      throw new ConflictException({
        code: "BET_ALREADY_ACTIVE",
        existingBetId: err.existingBetId as unknown as string,
      });
    }
    if (err instanceof BetAmountOutOfBoundsError) {
      throw new BadRequestException({
        code: "BET_AMOUNT_OUT_OF_BOUNDS",
        amountCents: err.amountCents.toString(),
        min: err.min.toString(),
        max: err.max.toString(),
      });
    }
    throw err;
  }
}
