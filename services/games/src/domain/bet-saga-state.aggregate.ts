import type { BetId } from "@crash/shared-kernel";
import { IllegalBetSagaTransitionError } from "./errors";

export type BetSagaStatus =
  | "DEBIT_PENDING"
  | "CONFIRMED"
  | "REFUNDED"
  | "TIMED_OUT"
  | "COMPENSATED";

export type BetSagaStateProps = {
  betId: BetId;
  correlationId: string;
  status: BetSagaStatus;
  deadlineAt: Date;
  updatedAt: Date;
};

export type BetSagaStateCreateInput = {
  betId: BetId;
  correlationId: string;
  deadlineAt: Date;
};

export class BetSagaState {
  private constructor(private readonly props: BetSagaStateProps) {}

  static create(input: BetSagaStateCreateInput): BetSagaState {
    return new BetSagaState({
      betId: input.betId,
      correlationId: input.correlationId,
      status: "DEBIT_PENDING",
      deadlineAt: input.deadlineAt,
      updatedAt: new Date(),
    });
  }

  static rehydrate(props: BetSagaStateProps): BetSagaState {
    return new BetSagaState(props);
  }

  get betId(): BetId {
    return this.props.betId;
  }

  get correlationId(): string {
    return this.props.correlationId;
  }

  get status(): BetSagaStatus {
    return this.props.status;
  }

  get deadlineAt(): Date {
    return this.props.deadlineAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  confirm(): BetSagaState {
    return this.transitionTo("CONFIRMED", "DEBIT_PENDING");
  }

  refund(): BetSagaState {
    return this.transitionTo("REFUNDED", "DEBIT_PENDING");
  }

  timeOut(): BetSagaState {
    return this.transitionTo("TIMED_OUT", "DEBIT_PENDING");
  }

  compensate(): BetSagaState {
    return this.transitionTo("COMPENSATED", "TIMED_OUT");
  }

  private transitionTo(target: BetSagaStatus, expectedFrom: BetSagaStatus): BetSagaState {
    if (this.props.status !== expectedFrom) {
      throw new IllegalBetSagaTransitionError(this.props.status, target);
    }
    return new BetSagaState({
      ...this.props,
      status: target,
      updatedAt: new Date(),
    });
  }
}
