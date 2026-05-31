import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Money } from "@crash/shared-kernel";
import type { LeaderboardEntryWire } from "@crash/contracts/ws";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import { RankChip } from "./rank-chip";

type LeaderboardRowProps = {
  entry: LeaderboardEntryWire;
  isOwnRow: boolean;
  previousRank: number | null;
};

type ProfitSign = "positive" | "negative" | "zero";

function profitSign(snapshot: { amount: string }): ProfitSign {
  if (snapshot.amount.startsWith("-")) return "negative";
  if (snapshot.amount === "0" || /^0+$/.test(snapshot.amount)) return "zero";
  return "positive";
}

function rankRailClass(rank: number, isOwnRow: boolean): string {
  if (isOwnRow) return "border-l-accent";
  if (rank === 1) return "border-l-accent";
  if (rank === 2) return "border-l-[var(--accent-cyan,#22d3ee)]";
  if (rank === 3) return "border-l-muted-foreground";
  return "border-l-transparent";
}

function formatNetProfit(snapshot: {
  amount: string;
  currency: string;
  scale: number;
}): string {
  const negative = snapshot.amount.startsWith("-");
  const absSnapshot = negative
    ? { ...snapshot, amount: snapshot.amount.slice(1) }
    : snapshot;
  const formatted = Money.fromSnapshot(absSnapshot).toString();
  if (negative) return `−${formatted}`;
  if (absSnapshot.amount === "0" || /^0+$/.test(absSnapshot.amount)) return formatted;
  return `+${formatted}`;
}

export function LeaderboardRow({
  entry,
  isOwnRow,
  previousRank,
}: LeaderboardRowProps) {
  const sign = profitSign(entry.netProfit);
  const profitTone =
    sign === "positive" ? "text-accent" : "text-muted-foreground";
  const [rankUp, setRankUp] = useState(false);
  const rankRef = useRef<number | null>(previousRank);

  useEffect(() => {
    const previous = rankRef.current;
    if (previous !== null && entry.rank < previous) {
      setRankUp(true);
      const t = setTimeout(
        () => setRankUp(false),
        getConfig().leaderboard.rankUpTransitionMs + 600,
      );
      return () => clearTimeout(t);
    }
    rankRef.current = entry.rank;
  }, [entry.rank]);

  useEffect(() => {
    if (!rankUp) rankRef.current = entry.rank;
  }, [rankUp, entry.rank]);

  const idLabel = isOwnRow
    ? `YOU (${entry.playerIdMasked.slice(0, 5)}…)`
    : `${entry.playerIdMasked}…`;

  return (
    <div
      data-slot="leaderboard-row"
      data-own={isOwnRow}
      data-rank-up={rankUp ? "true" : undefined}
      className={cn(
        "flex flex-col gap-1 border-l-2 border-b border-b-border/40 px-4 py-2 min-h-11",
        rankRailClass(entry.rank, isOwnRow),
        isOwnRow && "bg-accent/[0.06]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <RankChip rank={entry.rank} />
          <span className="truncate font-mono text-sm tabular-nums text-foreground">
            {idLabel}
          </span>
        </div>
        <div
          data-slot="leaderboard-profit"
          className={cn(
            "flex items-center gap-1 font-mono text-sm tabular-nums",
            profitTone,
          )}
        >
          {sign === "positive" && (
            <TrendingUp
              data-trend="up"
              aria-hidden="true"
              className="size-3"
            />
          )}
          {sign === "negative" && (
            <TrendingDown
              data-trend="down"
              aria-hidden="true"
              className="size-3"
            />
          )}
          <span>{formatNetProfit(entry.netProfit)}</span>
        </div>
      </div>
      <div className="pl-9 text-sm font-semibold text-muted-foreground">
        {entry.winCount}w
      </div>
    </div>
  );
}
