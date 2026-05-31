import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { useRoundStore } from "@/stores/round.store";

const TICK_MS = 250;
const MS_PER_SECOND = 1000;

export function Countdown() {
  const status = useRoundStore((state) => state.status);
  const bettingEndsAt = useRoundStore((state) => state.bettingEndsAt);
  const crashValue = useRoundStore((state) => state.crashValue);
  const [now, setNow] = useState(() => Date.now());
  const windowMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "BETTING") {
      windowMsRef.current = null;
      return;
    }
    if (windowMsRef.current === null && bettingEndsAt !== null) {
      windowMsRef.current = Math.max(bettingEndsAt - Date.now(), 0);
    }
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, [status, bettingEndsAt]);

  if (status === "BETTING" && bettingEndsAt !== null) {
    const remainingMs = Math.max(bettingEndsAt - now, 0);
    const remainingSeconds = Math.ceil(remainingMs / MS_PER_SECOND);
    const windowMs = windowMsRef.current ?? remainingMs;
    const fraction =
      windowMs > 0 ? Math.min(Math.max(remainingMs / windowMs, 0), 1) : 0;
    return (
      <div
        data-slot="phase-banner"
        data-phase="betting"
        className="flex flex-col gap-2 rounded-md border border-accent/40 bg-accent/5 p-3"
      >
        <p className="text-sm font-semibold text-accent">
          Bets open — closes in {remainingSeconds}s
        </p>
        <Progress className="h-1.5" value={fraction * 100} />
      </div>
    );
  }

  if (status === "RUNNING") {
    return (
      <div
        data-slot="phase-banner"
        data-phase="running"
        className="rounded-md border border-accent/30 bg-accent/5 p-3"
      >
        <p className="text-sm font-semibold text-accent">
          Round running — bets closed
        </p>
      </div>
    );
  }

  if (status === "CRASHED" || status === "SETTLED") {
    return (
      <div
        data-slot="phase-banner"
        data-phase="crashed"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-3"
      >
        <p className="text-sm font-semibold text-destructive">
          {crashValue !== null
            ? `Crashed @ ${crashValue.toFixed(2)}x — next round soon`
            : "Round ended — next round soon"}
        </p>
      </div>
    );
  }

  return (
    <div
      data-slot="phase-banner"
      data-phase="idle"
      className="rounded-md border border-border bg-card/40 p-3"
    >
      <p className="text-sm font-semibold text-muted-foreground">
        Waiting for next round…
      </p>
    </div>
  );
}
