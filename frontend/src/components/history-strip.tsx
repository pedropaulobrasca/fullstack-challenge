import { History } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { bandChipClass, classifyBand } from "@/features/history/history-band";
import { useHistoryStore } from "@/stores/history.store";
import { useReplayStore } from "@/features/replay/replay.store";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

function shortRoundId(roundId: string): string {
  const tail = roundId.slice(-8);
  return tail.length > 0 ? tail : roundId;
}

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

  const openReplay = (roundId: string) => {
    const config = getConfig();
    useReplayStore
      .getState()
      .openReplay(roundId, config.replay.autostart, config.replay.speeds[0] ?? 1);
  };

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
                  aria-label={`Replay Round #${shortRoundId(entry.roundId)}, crashed at ${entry.crashPoint.toFixed(2)}x`}
                  onClick={() => openReplay(entry.roundId)}
                  className={cn(
                    "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md border px-3 font-mono text-sm font-semibold tabular-nums",
                    bandChipClass[band],
                  )}
                >
                  <span>{entry.crashPoint.toFixed(2)}x</span>
                  <History
                    aria-hidden="true"
                    className="size-3 text-muted-foreground"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-0.5">
                  <span>Crashed @ {entry.crashPoint.toFixed(2)}x</span>
                  <span className="text-muted-foreground">Click to replay</span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
