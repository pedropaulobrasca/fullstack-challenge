import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { GetLeaderboardUseCase } from "../../application/use-cases/get-leaderboard.use-case";
import { leaderboardQuerySchema } from "../dtos/leaderboard.query.dto";
import { LeaderboardResponseDto } from "../dtos/leaderboard.response.dto";
import { JwtGuard } from "../guards/jwt.guard";

@Controller("games/leaderboard")
@UseGuards(JwtGuard)
export class LeaderboardController {
  constructor(private readonly getLeaderboard: GetLeaderboardUseCase) {}

  @Get()
  async get(@Query("window") windowRaw?: string): Promise<LeaderboardResponseDto> {
    const parsed = leaderboardQuerySchema.safeParse(
      windowRaw === undefined ? {} : { window: windowRaw },
    );
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_QUERY",
        message: parsed.error.message,
      });
    }
    const view = await this.getLeaderboard.execute({ window: parsed.data.window });
    return view as unknown as LeaderboardResponseDto;
  }
}
