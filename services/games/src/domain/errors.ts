import { DomainError } from "@crash/shared-kernel";
import type { RoundId } from "@crash/shared-kernel";
import type { RoundStatus } from "./value-objects/round-status";
import type { BetStatus } from "./value-objects/bet-status";

export class IllegalRoundTransitionError extends DomainError {
  readonly code = "ILLEGAL_ROUND_TRANSITION";
  readonly from: RoundStatus;
  readonly to: RoundStatus;

  constructor(from: RoundStatus, to: RoundStatus) {
    super(`Illegal Round transition: ${from} -> ${to}`);
    this.from = from;
    this.to = to;
  }
}

export class IllegalBetTransitionError extends DomainError {
  readonly code = "ILLEGAL_BET_TRANSITION";
  readonly from: BetStatus;
  readonly to: BetStatus;

  constructor(from: BetStatus, to: BetStatus) {
    super(`Illegal Bet transition: ${from} -> ${to}`);
    this.from = from;
    this.to = to;
  }
}

export class BetAmountOutOfBoundsError extends DomainError {
  readonly code = "BET_AMOUNT_OUT_OF_BOUNDS";
  readonly amountCents: bigint;
  readonly min: bigint;
  readonly max: bigint;

  constructor(params: { amountCents: bigint; min: bigint; max: bigint }) {
    super(
      `Bet amount ${params.amountCents.toString()} cents is out of bounds [${params.min.toString()}, ${params.max.toString()}]`,
    );
    this.amountCents = params.amountCents;
    this.min = params.min;
    this.max = params.max;
  }
}

export class MultiplierOutOfBoundsError extends DomainError {
  readonly code = "MULTIPLIER_OUT_OF_BOUNDS";
  readonly value: number;

  constructor(value: number) {
    super(`Multiplier ${value} is out of bounds (must be finite and >= 1.00)`);
    this.value = value;
  }
}

export class CrashPointOutOfBoundsError extends DomainError {
  readonly code = "CRASH_POINT_OUT_OF_BOUNDS";
  readonly value: number;

  constructor(value: number) {
    super(`CrashPoint ${value} is out of bounds (must be finite and in [1.00, 1e9])`);
    this.value = value;
  }
}

export class SeedNotYetRevealedError extends DomainError {
  readonly code = "SEED_NOT_YET_REVEALED";
  readonly roundId: RoundId;

  constructor(roundId: RoundId) {
    super(`Server seed for round ${roundId} not yet revealed (round not SETTLED)`);
    this.roundId = roundId;
  }
}
