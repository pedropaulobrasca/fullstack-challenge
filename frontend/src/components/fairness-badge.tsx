import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRoundStore } from "@/stores/round.store";
import { useHistoryStore } from "@/stores/history.store";
import {
  selectRecentlyVerified,
  useFairnessStore,
} from "@/features/fairness/fairness.store";
import { cn } from "@/lib/utils";

export function FairnessBadge() {
  const status = useRoundStore((state) => state.status);
  const mostRecentChip = useHistoryStore((state) => state.entries[0] ?? null);
  const recentlyVerified = useFairnessStore((state) =>
    selectRecentlyVerified(state, mostRecentChip?.roundId ?? "", Date.now()),
  );
  const openDrawer = useFairnessStore((state) => state.openDrawer);

  const commitmentLive = status === "BETTING" || status === "RUNNING";
  const tooltipCopy = recentlyVerified
    ? `Round #${mostRecentChip?.roundId} verified ✓`
    : commitmentLive
      ? "Commitment ready. Click to verify."
      : "Waiting for next round commitment.";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openDrawer}
            aria-label="Open fairness verification panel"
            className="min-h-11 min-w-11 gap-2"
          >
            <ShieldCheck aria-hidden="true" className="size-4 text-accent" />
            <span className="font-sans text-sm font-semibold">Fairness</span>
            {recentlyVerified ? (
              <CheckCircle2
                aria-label="verified"
                className="size-4 text-accent"
                data-slot="fairness-verified-mark"
              />
            ) : (
              <span
                data-slot="fairness-dot"
                aria-hidden="true"
                className={cn(
                  "inline-block size-2 rounded-full",
                  commitmentLive
                    ? "bg-accent motion-safe:animate-pulse"
                    : "bg-muted-foreground",
                )}
              />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipCopy}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
