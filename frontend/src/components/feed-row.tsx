import { Money } from "@crash/shared-kernel";
import type { FeedEntry } from "@/stores/feed.store";
import { useBetStore } from "@/stores/bet.store";
import { cn } from "@/lib/utils";

type FeedRowProps = {
  entry: FeedEntry;
};

export function FeedRow({ entry }: FeedRowProps) {
  const ownAmount = useBetStore((state) =>
    entry.isOwn && state.myBet?.betId === entry.betId
      ? state.myBet.amount
      : null,
  );
  const displayAmount = ownAmount ?? entry.amount;
  const isMaskedZero =
    !entry.isOwn &&
    displayAmount !== undefined &&
    displayAmount !== null &&
    BigInt(displayAmount.amount) === 0n;
  const amountLabel =
    displayAmount && !isMaskedZero
      ? Money.fromSnapshot(displayAmount).toString()
      : null;
  const showPlaceholder =
    entry.kind === "placed" && !entry.isOwn && isMaskedZero;

  return (
    <div
      data-testid={`feed-row-${entry.id}`}
      data-slot="feed-row"
      data-own={entry.isOwn}
      className={cn(
        "flex items-center justify-between gap-3 border-l-2 px-3 py-2 text-base",
        entry.isOwn
          ? "border-l-accent bg-accent/10 text-accent"
          : "border-l-transparent text-foreground",
      )}
    >
      <span className="truncate text-muted-foreground">
        {entry.playerIdMasked}
      </span>
      <span className="flex items-center gap-2 font-mono tabular-nums">
        {entry.kind === "cashed_out" && entry.multiplier !== undefined ? (
          <span>{entry.multiplier.toFixed(2)}x</span>
        ) : null}
        {amountLabel ? <span>{amountLabel}</span> : null}
        {showPlaceholder ? (
          <span className="text-muted-foreground">Bet placed</span>
        ) : null}
      </span>
    </div>
  );
}
