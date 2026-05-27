import { DomainError } from "@crash/shared-kernel";
import type { BetId, RoundId } from "@crash/shared-kernel";
import type { RoundStatus } from "./value-objects/round-status";
import type { BetStatus } from "./value-objects/bet-status";
import type { BetSagaStatus } from "./bet-saga-state.aggregate";

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

export class RoundNotInBettingPhaseError extends DomainError {
  readonly code = "ROUND_NOT_IN_BETTING_PHASE";
  readonly actual: RoundStatus | "NO_OPEN_ROUND";

  constructor(actual: RoundStatus | "NO_OPEN_ROUND") {
    super(`Round is not in BETTING phase (actual=${actual})`);
    this.actual = actual;
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

export class IllegalBetSagaTransitionError extends DomainError {
  readonly code = "ILLEGAL_BET_SAGA_TRANSITION";
  readonly from: BetSagaStatus;
  readonly to: BetSagaStatus;

  constructor(from: BetSagaStatus, to: BetSagaStatus) {
    super(`Illegal BetSagaState transition: ${from} -> ${to}`);
    this.from = from;
    this.to = to;
  }
}

export class BetSagaNotFoundError extends DomainError {
  readonly code = "BET_SAGA_NOT_FOUND";
  readonly correlationId: string;

  constructor(correlationId: string) {
    super(`No BetSagaState found for correlationId=${correlationId}`);
    this.correlationId = correlationId;
  }
}

export class SagaTimeoutError extends DomainError {
  readonly code = "SAGA_TIMEOUT";

  constructor(message = "Saga deadline elapsed before terminal event arrived") {
    super(message);
  }
}

export class BetAlreadyActiveError extends DomainError {
  readonly code = "BET_ALREADY_ACTIVE";
  readonly existingBetId: BetId;

  constructor(existingBetId: BetId) {
    super(`Player already has an active or pending bet (existingBetId=${existingBetId as unknown as string})`);
    this.existingBetId = existingBetId;
  }
}

export class RoundNotRunningError extends DomainError {
  readonly code = "ROUND_NOT_RUNNING";
  readonly actual: RoundStatus | "NO_OPEN_ROUND";

  constructor(actual: RoundStatus | "NO_OPEN_ROUND") {
    super(`Round is not RUNNING (actual=${actual})`);
    this.actual = actual;
  }
}

export class NoActiveBetError extends DomainError {
  readonly code = "NO_ACTIVE_BET";

  constructor() {
    super("Player has no active bet on the current round");
  }
}

export class BetNotCashableError extends DomainError {
  readonly code = "BET_NOT_CASHABLE";
  readonly status: BetStatus | "RACE";

  constructor(status: BetStatus | "RACE") {
    super(`Bet cannot be cashed out (status=${status})`);
    this.status = status;
  }
}
