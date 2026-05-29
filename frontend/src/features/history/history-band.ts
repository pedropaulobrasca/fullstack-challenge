import { getConfig } from "@/lib/config";

export type HistoryBand = "low" | "mid" | "high";

export function classifyBand(crashPoint: number): HistoryBand {
  const { redMaxX, yellowMaxX } = getConfig().history;
  if (crashPoint <= redMaxX) {
    return "low";
  }
  if (crashPoint <= yellowMaxX) {
    return "mid";
  }
  return "high";
}

export const bandChipClass: Record<HistoryBand, string> = {
  low: "border-destructive/40 bg-destructive/15 text-destructive",
  mid: "border-warning/40 bg-warning/15 text-warning",
  high: "border-accent/40 bg-accent/15 text-accent",
};
