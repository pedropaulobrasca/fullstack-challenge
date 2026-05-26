export type RoundStatus = "BETTING" | "RUNNING" | "CRASHED" | "SETTLED";

export const ROUND_STATUSES: readonly RoundStatus[] = [
  "BETTING",
  "RUNNING",
  "CRASHED",
  "SETTLED",
] as const;
