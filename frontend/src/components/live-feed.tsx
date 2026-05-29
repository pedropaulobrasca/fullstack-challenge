import { ScrollArea } from "@/components/ui/scroll-area";
import { FeedRow } from "@/components/feed-row";
import { useFeedStore } from "@/stores/feed.store";

export function LiveFeed() {
  const entries = useFeedStore((state) => state.entries);

  if (entries.length === 0) {
    return (
      <div
        data-slot="live-feed-empty"
        className="flex h-full flex-col justify-center gap-1 rounded-md border bg-card px-4 py-3 text-left"
      >
        <p className="font-semibold text-foreground">No bets yet this round</p>
        <p className="text-sm text-muted-foreground">
          Place a bet during the betting window to see the action here.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea
      data-slot="live-feed"
      className="h-full rounded-md border bg-card"
    >
      <div className="flex flex-col">
        {entries.map((entry) => (
          <FeedRow key={entry.id} entry={entry} />
        ))}
      </div>
    </ScrollArea>
  );
}
