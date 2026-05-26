export type BetStatus = "PENDING" | "ACTIVE" | "CASHED_OUT" | "LOST" | "REFUNDED";

export const BET_STATUSES: readonly BetStatus[] = [
  "PENDING",
  "ACTIVE",
  "CASHED_OUT",
  "LOST",
  "REFUNDED",
] as const;
