export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}
