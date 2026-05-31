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
import { Money } from "@crash/shared-kernel";
import { PlayerId } from "@crash/shared-kernel/identity";
import { env } from "../../config/defaults";
import { PlaceBetUseCase } from "../../application/use-cases/place-bet.use-case";
import { CashOutUseCase } from "../../application/use-cases/cash-out.use-case";
import { RoundLoopService } from "../../application/round-loop.service";
import type { Multiplier } from "../../domain/value-objects/multiplier";
import {
  BetAlreadyActiveError,
  BetAmountOutOfBoundsError,
  BetNotCashableError,
  NoActiveBetError,
  RoundNotInBettingPhaseError,
  RoundNotRunningError,
} from "../../domain/errors";
import { PlaceBetRequestDto } from "../dtos/place-bet.request.dto";
import { PlaceBetResponseDto } from "../dtos/place-bet.response.dto";
import type { CashoutResponseDto } from "../dtos/cashout.response.dto";
import { JwtGuard, type AuthenticatedRequest } from "../guards/jwt.guard";

@Controller("games/bet")
@UseGuards(JwtGuard)
export class BetCommandController {
  constructor(
    private readonly placeBet: PlaceBetUseCase,
    private readonly cashOut: CashOutUseCase,
    private readonly roundLoop: RoundLoopService,
  ) {}

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
        autoCashoutTarget: body.autoCashoutTarget,
      });
      return {
        betId: result.betId as unknown as string,
        status: result.status,
      };
    } catch (err) {
      this.translatePlaceError(err);
    }
  }

  @Post("cashout")
  @HttpCode(200)
  async cashout(@Req() req: AuthenticatedRequest): Promise<CashoutResponseDto> {
    const acceptedAt = new Date();
    const playerId = PlayerId(req.user!.playerId);
    let multiplier: Multiplier;
    try {
      multiplier = this.roundLoop.getMultiplierAt(acceptedAt);
    } catch {
      throw new ConflictException({ code: "ROUND_NOT_RUNNING", phase: "UNKNOWN" });
    }
    try {
      const result = await this.cashOut.execute({ playerId, multiplier, acceptedAt });
      return {
        multiplier: result.multiplier.toNumber(),
        payoutCents: result.payout.toSnapshot(),
      };
    } catch (err) {
      this.translateCashoutError(err);
    }
  }

  private translatePlaceError(err: unknown): never {
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

  private translateCashoutError(err: unknown): never {
    if (err instanceof RoundNotRunningError) {
      throw new ConflictException({
        code: "ROUND_NOT_RUNNING",
        phase: err.actual,
      });
    }
    if (err instanceof NoActiveBetError) {
      throw new ConflictException({ code: "NO_ACTIVE_BET" });
    }
    if (err instanceof BetNotCashableError) {
      throw new ConflictException({
        code: "BET_NOT_CASHABLE",
        status: err.status,
      });
    }
    throw err;
  }
}
