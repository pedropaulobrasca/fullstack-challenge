import { cn } from "@/lib/utils";

type RankChipProps = {
  rank: number;
  className?: string;
};

type RankColor = "rank-1" | "rank-2" | "rank-3" | "rank-default";

function rankColor(rank: number): RankColor {
  if (rank === 1) return "rank-1";
  if (rank === 2) return "rank-2";
  if (rank === 3) return "rank-3";
  return "rank-default";
}

const colorClasses: Record<RankColor, string> = {
  "rank-1": "border-accent bg-accent/10 text-accent",
  "rank-2": "border-[var(--accent-cyan,#22d3ee)] bg-[color-mix(in_oklab,var(--accent-cyan,#22d3ee)_12%,transparent)] text-[var(--accent-cyan,#22d3ee)]",
  "rank-3": "border-muted-foreground text-muted-foreground",
  "rank-default": "border-border text-foreground",
};

export function RankChip({ rank, className }: RankChipProps) {
  const color = rankColor(rank);
  const shape = rank >= 10 ? "rect" : "circle";
  return (
    <span
      data-slot="rank-chip"
      data-rank-color={color}
      data-shape={shape}
      className={cn(
        "inline-flex h-6 items-center justify-center border font-mono text-sm tabular-nums transition-[border-color] duration-200",
        shape === "circle" ? "w-6 rounded-full" : "w-8 rounded-md",
        colorClasses[color],
        className,
      )}
    >
      {rank}
    </span>
  );
}
