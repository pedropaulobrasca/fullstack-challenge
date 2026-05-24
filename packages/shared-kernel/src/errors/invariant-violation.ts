import { DomainError } from "./domain-error";

export class InvariantViolation extends DomainError {
  readonly code = "INVARIANT_VIOLATION";
}
