import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  buildEnvelope,
  EXCHANGES,
  OutboxRepository,
} from "@crash/messaging-spine";
import type { Money, PlayerId } from "@crash/shared-kernel";
import type { Multiplier } from "../../domain/value-objects/multiplier";
import type { BetRepository } from "../../domain/bet.repository";
import type { RoundRepository } from "../../domain/round.repository";
import {
  BetNotCashableError,
  NoActiveBetError,
  RoundNotRunningError,
} from "../../domain/errors";
import { BET_REPOSITORY, ROUND_REPOSITORY } from "../tokens";

export type CashOutInput = {
  playerId: PlayerId;
  multiplier: Multiplier;
  acceptedAt: Date;
};

export type CashOutResult = {
  multiplier: Multiplier;
  payout: Money;
};

@Injectable()
export class CashOutUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxRepository,
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
  ) {}

  async execute(input: CashOutInput): Promise<CashOutResult> {
    return this.em.transactional(async (txEm) => {
      const open = await this.rounds.findOpen();
      if (open === null) {
        throw new RoundNotRunningError("NO_OPEN_ROUND");
      }
      if (open.status !== "RUNNING") {
        throw new RoundNotRunningError(open.status);
      }

      const active = await this.bets.findActiveByRoundAndPlayer(open.id, input.playerId);
      if (active === null) {
        throw new NoActiveBetError();
      }
      if (active.status !== "ACTIVE") {
        throw new BetNotCashableError(active.status);
      }

      const { next, payout } = active.cashOut(input.multiplier, input.acceptedAt);

      const transitioned = await this.bets.tryTransition(
        active.id,
        "ACTIVE",
        "CASHED_OUT",
        {
          cashedOutAt: next.cashedOutAt,
          cashedOutMultiplier: next.cashedOutMultiplier,
          payout: next.payout,
        },
        txEm,
      );
      if (transitioned === null) {
        throw new BetNotCashableError("RACE");
      }

      const correlationId = randomUUID();
      await this.outbox.add(
        buildEnvelope({
          type: "wallet.credit",
          version: 1,
          correlationId,
          causationId: correlationId,
          payload: {
            playerId: input.playerId as unknown as string,
            amount: payout.toSnapshot(),
          },
        }),
        {
          exchange: EXCHANGES.WALLET_COMMANDS,
          routingKey: "wallet.credit",
          aggregateType: "Bet",
          aggregateId: active.id as unknown as string,
        },
        txEm,
      );

      return { multiplier: input.multiplier, payout };
    });
  }
}
