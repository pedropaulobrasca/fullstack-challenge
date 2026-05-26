import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { RoundId } from "@crash/shared-kernel";
import { GetCurrentRoundUseCase } from "../../application/use-cases/get-current-round.use-case";
import { GetRoundHistoryUseCase } from "../../application/use-cases/get-round-history.use-case";
import { VerifyRoundUseCase } from "../../application/use-cases/verify-round.use-case";
import {
  RoundHistoryDto,
  roundHistoryQuerySchema,
} from "../dtos/round-history.dto";
import { CurrentRoundDto } from "../dtos/current-round.dto";
import { VerifyRoundDto } from "../dtos/verify-round.dto";
import { z } from "zod";

const roundIdParamSchema = z.string().uuid();

@Controller("games/rounds")
export class RoundsController {
  constructor(
    private readonly getCurrentRound: GetCurrentRoundUseCase,
    private readonly getRoundHistory: GetRoundHistoryUseCase,
    private readonly verifyRound: VerifyRoundUseCase,
  ) {}

  @Get("current")
  async current(): Promise<CurrentRoundDto> {
    const view = await this.getCurrentRound.execute();
    if (!view) {
      throw new NotFoundException({ code: "NO_OPEN_ROUND" });
    }
    return view as unknown as CurrentRoundDto;
  }

  @Get("history")
  async history(
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<RoundHistoryDto> {
    const parsed = roundHistoryQuerySchema.safeParse({ limit, offset });
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_QUERY",
        message: parsed.error.message,
      });
    }
    const view = await this.getRoundHistory.execute(
      parsed.data.limit,
      parsed.data.offset,
    );
    return view as unknown as RoundHistoryDto;
  }

  @Get(":roundId/verify")
  async verify(@Param("roundId") roundIdRaw: string): Promise<VerifyRoundDto> {
    const parsed = roundIdParamSchema.safeParse(roundIdRaw);
    if (!parsed.success) {
      throw new BadRequestException({ code: "INVALID_ROUND_ID" });
    }
    const view = await this.verifyRound.execute(RoundId(parsed.data));
    return view as unknown as VerifyRoundDto;
  }
}
