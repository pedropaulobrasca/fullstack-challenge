import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { useRoundStore } from "@/stores/round.store";

const TICK_MS = 250;
const MS_PER_SECOND = 1000;

export function Countdown() {
  const status = useRoundStore((state) => state.status);
  const bettingEndsAt = useRoundStore((state) => state.bettingEndsAt);
  const [now, setNow] = useState(() => Date.now());
  const windowMsRef = useRef<number | null>(null);

  const isBetting = status === "BETTING" && bettingEndsAt !== null;

  useEffect(() => {
    if (!isBetting) {
      windowMsRef.current = null;
      return;
    }
    if (windowMsRef.current === null && bettingEndsAt !== null) {
      windowMsRef.current = Math.max(bettingEndsAt - Date.now(), 0);
    }
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
  }, [isBetting, bettingEndsAt]);

  if (!isBetting || bettingEndsAt === null) {
    return null;
  }

  const remainingMs = Math.max(bettingEndsAt - now, 0);
  const remainingSeconds = Math.ceil(remainingMs / MS_PER_SECOND);
  const windowMs = windowMsRef.current ?? remainingMs;
  const fraction =
    windowMs > 0 ? Math.min(Math.max(remainingMs / windowMs, 0), 1) : 0;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">
        Betting closes in {remainingSeconds}s
      </p>
      <Progress className="h-1" value={fraction * 100} />
    </div>
  );
}
