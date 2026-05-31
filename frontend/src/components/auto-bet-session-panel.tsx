import { useAutoBetStore } from "@/features/auto-bet/auto-bet.store";
import { nextBetAmount } from "@/features/auto-bet/strategy";

function signedSessionPLLabel(magnitude: string, sign: -1 | 0 | 1): string {
  if (sign === 1) {
    return `+${magnitude}`;
  }
  if (sign === -1) {
    return `-${magnitude}`;
  }
  return magnitude;
}

export function AutoBetSessionPanel() {
  const isRunning = useAutoBetStore((state) => state.isRunning);
  const config = useAutoBetStore((state) => state.config);
  const sessionPL = useAutoBetStore((state) => state.sessionPL);
  const sessionPLSign = useAutoBetStore((state) => state.sessionPLSign);
  const roundCount = useAutoBetStore((state) => state.roundCount);
  const lastOutcome = useAutoBetStore((state) => state.lastOutcome);
  const lastBetAmount = useAutoBetStore((state) => state.lastBetAmount);

  if (!isRunning || config === null) {
    return null;
  }

  const plMagnitudeLabel = sessionPL.toString();
  const plLabel = signedSessionPLLabel(plMagnitudeLabel, sessionPLSign);
  const plClass =
    sessionPLSign === 1 ? "text-accent" : "text-muted-foreground";

  const next = nextBetAmount(config.strategy, config.baseAmount, lastOutcome, {
    lastBet: lastBetAmount,
  });
  const strategyLabel =
    config.strategy === "fixed"
      ? "fixed"
      : lastOutcome === "loss"
        ? "martingale, after loss"
        : lastOutcome === "win"
          ? "martingale, after win, reset"
          : "martingale";

  const roundsLabel = roundCount === 1 ? "1 round" : `${roundCount} rounds`;

  return (
    <div
      data-testid="auto-bet-session-panel"
      className="flex flex-col gap-1 border-t border-border pt-4"
    >
      <p className="font-mono text-sm tabular-nums text-foreground">
        Session P/L:{" "}
        <span
          data-testid="session-pl-value"
          className={`${plClass} font-semibold`}
        >
          {plLabel}
        </span>{" "}
        <span className="text-muted-foreground">({roundsLabel})</span>
      </p>
      <p className="font-mono text-sm tabular-nums text-muted-foreground">
        Next bet: {next.toString()} ({strategyLabel})
      </p>
    </div>
  );
}
