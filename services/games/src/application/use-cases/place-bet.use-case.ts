import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import {
  buildEnvelope,
  EXCHANGES,
  OutboxRepository,
} from "@crash/messaging-spine";
import { BetId, type Money, type PlayerId } from "@crash/shared-kernel";
import { Bet } from "../../domain/bet.aggregate";
import type { BetRepository } from "../../domain/bet.repository";
import type { BetSagaStateRepository } from "../../domain/bet-saga-state.repository";
import type { RoundRepository } from "../../domain/round.repository";
import { BetAlreadyActiveError, RoundNotInBettingPhaseError } from "../../domain/errors";
import { env } from "../../config/defaults";
import {
  BET_REPOSITORY,
  BET_SAGA_REPOSITORY,
  ROUND_REPOSITORY,
} from "../tokens";

export type PlaceBetInput = {
  playerId: PlayerId;
  amount: Money;
  now: Date;
};

export type PlaceBetResult = {
  betId: BetId;
  status: "PENDING";
};

@Injectable()
export class PlaceBetUseCase {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxRepository,
    @Inject(ROUND_REPOSITORY) private readonly rounds: RoundRepository,
    @Inject(BET_REPOSITORY) private readonly bets: BetRepository,
    @Inject(BET_SAGA_REPOSITORY) private readonly sagas: BetSagaStateRepository,
  ) {}

  async execute(input: PlaceBetInput): Promise<PlaceBetResult> {
    return this.em.transactional(async (txEm) => {
      const open = await this.rounds.findOpen();
      if (open === null) {
        throw new RoundNotInBettingPhaseError("NO_OPEN_ROUND");
      }

      open.acceptBet(input.now);

      const existing = await this.bets.findActiveByRoundAndPlayer(open.id, input.playerId);
      if (existing !== null) {
        throw new BetAlreadyActiveError(existing.id);
      }

      const betId = BetId(randomUUID());
      const correlationId = randomUUID();
      const bet = Bet.place(betId, open.id, input.playerId, input.amount, input.now);
      await this.bets.save(bet, txEm);

      const deadlineAt = new Date(input.now.getTime() + env.SAGA_TIMEOUT_MS);
      await this.sagas.create({ betId, correlationId, deadlineAt }, txEm);

      await this.outbox.add(
        buildEnvelope({
          type: "wallet.debit",
          version: 1,
          correlationId,
          causationId: correlationId,
          payload: {
            playerId: input.playerId as unknown as string,
            amount: input.amount.toSnapshot(),
          },
        }),
        {
          exchange: EXCHANGES.WALLET_COMMANDS,
          routingKey: "wallet.debit",
          aggregateType: "Bet",
          aggregateId: betId as unknown as string,
        },
        txEm,
      );

      return { betId, status: "PENDING" as const };
    });
  }
}
