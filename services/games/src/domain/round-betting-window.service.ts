import type { Round } from "./round.aggregate";

export function isBettingOpen(round: Round, now: Date): boolean {
  return round.status === "BETTING" && round.bettingEndsAt.getTime() > now.getTime();
}
