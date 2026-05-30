import { Money } from "@crash/shared-kernel";
import { cn } from "@/lib/utils";
import type { RoundBetView } from "@/features/replay/round-detail.types";

type ReplayOverlaysProps = {
  bets: RoundBetView[];
};

const STATUS_LABEL: Record<RoundBetView["status"], string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  CASHED_OUT: "Cashed out",
  LOST: "Lost",
  REFUNDED: "Refunded",
};

const STATUS_CLASS: Record<RoundBetView["status"], string> = {
  PENDING: "border-l-muted text-muted-foreground",
  ACTIVE: "border-l-muted text-foreground",
  CASHED_OUT: "border-l-accent bg-accent/10 text-accent",
  LOST: "border-l-destructive text-destructive",
  REFUNDED: "border-l-muted text-muted-foreground",
};

export function ReplayOverlays({ bets }: ReplayOverlaysProps) {
  if (bets.length === 0) {
    return (
      <div
        data-slot="replay-overlays-empty"
        className="flex flex-col gap-1 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground"
      >
        <p className="font-semibold text-foreground">No bets this round</p>
        <p>This round settled with zero placed bets.</p>
      </div>
    );
  }

  return (
    <div
      data-slot="replay-overlays"
      className="flex flex-col gap-2 rounded-md border border-border bg-card p-3"
    >
      <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Bets · {bets.length}
      </div>
      <ul className="flex flex-col gap-1">
        {bets.map((bet) => {
          const amountLabel = Money.fromSnapshot(bet.amount).toString();
          const payoutLabel = bet.payout
            ? Money.fromSnapshot(bet.payout).toString()
            : null;
          return (
            <li
              key={bet.betId}
              data-slot="replay-overlay-row"
              data-status={bet.status}
              className={cn(
                "flex items-center justify-between gap-3 border-l-2 px-3 py-2 text-sm",
                STATUS_CLASS[bet.status],
              )}
            >
              <span className="truncate text-muted-foreground">
                {bet.playerIdMasked}
              </span>
              <span className="flex items-center gap-2 font-mono tabular-nums">
                <span>{amountLabel}</span>
                {bet.cashedOutMultiplier !== null ? (
                  <span aria-label={`Cashed out at ${bet.cashedOutMultiplier}x`}>
                    {bet.cashedOutMultiplier.toFixed(2)}x
                  </span>
                ) : null}
                {payoutLabel ? <span>→ {payoutLabel}</span> : null}
                <span className="text-xs text-muted-foreground">
                  {STATUS_LABEL[bet.status]}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
