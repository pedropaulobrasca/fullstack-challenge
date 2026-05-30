import type { BetId, Money, PlayerId, RoundId } from "@crash/shared-kernel";
import { Multiplier } from "./value-objects/multiplier";
import type { BetStatus } from "./value-objects/bet-status";
import { IllegalBetTransitionError } from "./errors";

export type BetProps = {
  id: BetId;
  roundId: RoundId;
  playerId: PlayerId;
  amount: Money;
  status: BetStatus;
  cashedOutAt: Date | null;
  cashedOutMultiplier: Multiplier | null;
  payout: Money | null;
  refundReason: string | null;
  createdAt: Date;
  autoCashoutTarget: Multiplier | null;
};

export type BetCashOutResult = {
  next: Bet;
  payout: Money;
};

export class Bet {
  private constructor(private readonly props: BetProps) {}

  static place(
    id: BetId,
    roundId: RoundId,
    playerId: PlayerId,
    amount: Money,
    now: Date,
    autoCashoutTarget: Multiplier | null = null,
  ): Bet {
    return new Bet({
      id,
      roundId,
      playerId,
      amount,
      status: "PENDING",
      cashedOutAt: null,
      cashedOutMultiplier: null,
      payout: null,
      refundReason: null,
      createdAt: now,
      autoCashoutTarget,
    });
  }

  static rehydrate(props: BetProps): Bet {
    return new Bet(props);
  }

  get id(): BetId {
    return this.props.id;
  }

  get roundId(): RoundId {
    return this.props.roundId;
  }

  get playerId(): PlayerId {
    return this.props.playerId;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get status(): BetStatus {
    return this.props.status;
  }

  get cashedOutAt(): Date | null {
    return this.props.cashedOutAt;
  }

  get cashedOutMultiplier(): Multiplier | null {
    return this.props.cashedOutMultiplier;
  }

  get payout(): Money | null {
    return this.props.payout;
  }

  get refundReason(): string | null {
    return this.props.refundReason;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get autoCashoutTarget(): Multiplier | null {
    return this.props.autoCashoutTarget;
  }

  confirm(): Bet {
    if (this.props.status !== "PENDING") {
      throw new IllegalBetTransitionError(this.props.status, "ACTIVE");
    }
    return new Bet({ ...this.props, status: "ACTIVE" });
  }

  cashOut(multiplier: Multiplier, time: Date): BetCashOutResult {
    if (this.props.status !== "ACTIVE") {
      throw new IllegalBetTransitionError(this.props.status, "CASHED_OUT");
    }
    const payout = this.props.amount.multiplyRounded({
      numerator: multiplier.tenThousandths,
      denominator: 10_000n,
    });
    const next = new Bet({
      ...this.props,
      status: "CASHED_OUT",
      cashedOutAt: time,
      cashedOutMultiplier: multiplier,
      payout,
    });
    return { next, payout };
  }

  lose(): Bet {
    if (this.props.status !== "ACTIVE") {
      throw new IllegalBetTransitionError(this.props.status, "LOST");
    }
    return new Bet({ ...this.props, status: "LOST" });
  }

  refund(reason: string): Bet {
    if (this.props.status !== "PENDING") {
      throw new IllegalBetTransitionError(this.props.status, "REFUNDED");
    }
    return new Bet({ ...this.props, status: "REFUNDED", refundReason: reason });
  }
}
