import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { bandChipClass, classifyBand } from "@/features/history/history-band";
import { useHistoryStore } from "@/stores/history.store";
import { cn } from "@/lib/utils";

export function HistoryStrip() {
  const points = useHistoryStore((state) => state.entries);

  if (points.length === 0) {
    return (
      <div
        data-slot="history-strip-empty"
        className="flex flex-col gap-1 px-4 py-3 text-left"
      >
        <p className="font-semibold text-foreground">No rounds yet</p>
        <p className="text-sm text-muted-foreground">
          Crash history will appear after the first round settles.
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div
        data-slot="history-strip"
        className="flex items-center gap-2 overflow-x-auto px-4 py-3"
      >
        {points.map((entry) => {
          const band = classifyBand(entry.crashPoint);
          return (
            <Tooltip key={entry.roundId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  data-slot="history-chip"
                  data-band={band}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border px-3 font-mono text-sm font-semibold tabular-nums",
                    bandChipClass[band],
                  )}
                >
                  {entry.crashPoint.toFixed(2)}x
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Crashed @ {entry.crashPoint.toFixed(2)}x
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
