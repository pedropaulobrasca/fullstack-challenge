import { useMemo, useState } from "react";
import { Play, Pause } from "lucide-react";
import { Money } from "@crash/shared-kernel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseBetAmount } from "@/features/bet/bet-amount";
import {
  useAutoBetStore,
  type AutoBetConfig,
} from "@/features/auto-bet/auto-bet.store";
import type { AutoBetStrategy } from "@/features/auto-bet/strategy";
import { AutoBetSessionPanel } from "@/components/auto-bet-session-panel";
import { getConfig } from "@/lib/config";

type MoneyValidation =
  | { ok: true; money: Money }
  | { ok: false; message: string };

const moneyReasonCopy = {
  invalid: "Enter a valid amount.",
  "below-min": "Below the minimum bet.",
  "above-max": "Above the maximum bet.",
} as const;

function validateMoney(raw: string): MoneyValidation {
  if (raw.trim() === "") {
    return { ok: false, message: "Enter a valid amount." };
  }
  const parsed = parseBetAmount(raw);
  if (parsed.ok) {
    return { ok: true, money: parsed.money };
  }
  return { ok: false, message: moneyReasonCopy[parsed.reason] };
}

function validateTarget(raw: string): {
  ok: boolean;
  value: number;
  message: string | null;
} {
  const cfg = getConfig().autoBet;
  if (raw.trim() === "") {
    return { ok: false, value: NaN, message: "Enter a target multiplier." };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, value: NaN, message: "Enter a valid number." };
  }
  if (value < cfg.minTarget) {
    return {
      ok: false,
      value,
      message: `Target must be at least ${cfg.minTarget}x.`,
    };
  }
  if (value > cfg.maxTarget) {
    return {
      ok: false,
      value,
      message: `Target must be at most ${cfg.maxTarget}x.`,
    };
  }
  return { ok: true, value, message: null };
}

const inputClass = "min-h-11";
const inputDisabledClass = `${inputClass} disabled:opacity-50`;

export function AutoBetForm() {
  const isRunning = useAutoBetStore((state) => state.isRunning);
  const start = useAutoBetStore((state) => state.start);
  const stop = useAutoBetStore((state) => state.stop);
  const config = useAutoBetStore((state) => state.config);

  const [target, setTarget] = useState<string>("");
  const [strategy, setStrategy] = useState<AutoBetStrategy>("fixed");
  const [baseRaw, setBaseRaw] = useState<string>("");
  const [stopLossRaw, setStopLossRaw] = useState<string>("");
  const [stopWinRaw, setStopWinRaw] = useState<string>("");

  const [touched, setTouched] = useState<{
    target: boolean;
    base: boolean;
    stopLoss: boolean;
    stopWin: boolean;
  }>({ target: false, base: false, stopLoss: false, stopWin: false });

  const targetValidation = useMemo(() => validateTarget(target), [target]);
  const baseValidation = useMemo(() => validateMoney(baseRaw), [baseRaw]);
  const stopLossValidation = useMemo(
    () => validateMoney(stopLossRaw),
    [stopLossRaw],
  );
  const stopWinValidation = useMemo(
    () => validateMoney(stopWinRaw),
    [stopWinRaw],
  );

  const formValid =
    targetValidation.ok &&
    baseValidation.ok &&
    stopLossValidation.ok &&
    stopWinValidation.ok;

  function onStart() {
    if (
      !targetValidation.ok ||
      !baseValidation.ok ||
      !stopLossValidation.ok ||
      !stopWinValidation.ok
    ) {
      return;
    }
    const nextConfig: AutoBetConfig = {
      target: targetValidation.value,
      strategy,
      baseAmount: baseValidation.money,
      stopLoss: stopLossValidation.money,
      stopWin: stopWinValidation.money,
    };
    start(nextConfig);
  }

  function onStop() {
    stop({ reason: "user" });
  }

  const showTargetError = touched.target && !targetValidation.ok;
  const showBaseError = touched.base && !baseValidation.ok;
  const showStopLossError = touched.stopLoss && !stopLossValidation.ok;
  const showStopWinError = touched.stopWin && !stopWinValidation.ok;

  const cfg = getConfig();
  const baseHelper = `Min ${(cfg.bet.minCents / 100).toFixed(2)} / Max ${(cfg.bet.maxCents / 100).toFixed(2)} ${cfg.currencyCode}`;

  const lockedTarget =
    isRunning && config !== null ? config.target.toString() : target;
  const lockedStrategy =
    isRunning && config !== null ? config.strategy : strategy;
  const lockedBase =
    isRunning && config !== null ? config.baseAmount.toString() : baseRaw;
  const lockedStopLoss =
    isRunning && config !== null ? config.stopLoss.toString() : stopLossRaw;
  const lockedStopWin =
    isRunning && config !== null ? config.stopWin.toString() : stopWinRaw;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="auto-bet-target">Target multiplier</Label>
          <Input
            id="auto-bet-target"
            type="number"
            step="0.01"
            min={cfg.autoBet.minTarget}
            max={cfg.autoBet.maxTarget}
            value={lockedTarget}
            disabled={isRunning}
            aria-disabled={isRunning}
            aria-describedby={
              showTargetError ? "auto-bet-target-error" : undefined
            }
            onChange={(event) => setTarget(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, target: true }))}
            placeholder="2.00"
            className={inputDisabledClass}
          />
          <p className="text-xs text-muted-foreground">
            Auto-cashout at this multiplier
          </p>
          {showTargetError ? (
            <p
              id="auto-bet-target-error"
              className="text-xs text-muted-foreground"
            >
              {targetValidation.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label asChild>
            <span id="auto-bet-strategy-label">Strategy</span>
          </Label>
          <RadioGroup
            aria-labelledby="auto-bet-strategy-label"
            aria-label="Strategy"
            value={lockedStrategy}
            disabled={isRunning}
            onValueChange={(value) => setStrategy(value as AutoBetStrategy)}
            className="flex min-h-11 flex-row items-center gap-6"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <RadioGroupItem value="fixed" id="auto-bet-strategy-fixed" />
                  <span>Fixed</span>
                </label>
              </TooltipTrigger>
              <TooltipContent>Same bet amount every round.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <RadioGroupItem
                    value="martingale"
                    id="auto-bet-strategy-martingale"
                  />
                  <span>Martingale</span>
                </label>
              </TooltipTrigger>
              <TooltipContent>
                Double the bet after each loss; reset to base after each win.
              </TooltipContent>
            </Tooltip>
          </RadioGroup>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="auto-bet-base">Base bet</Label>
          <Input
            id="auto-bet-base"
            inputMode="decimal"
            value={lockedBase}
            disabled={isRunning}
            aria-disabled={isRunning}
            aria-describedby={
              showBaseError ? "auto-bet-base-error" : undefined
            }
            onChange={(event) => setBaseRaw(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, base: true }))}
            placeholder="10.00"
            className={inputDisabledClass}
          />
          <p className="text-xs text-muted-foreground">{baseHelper}</p>
          {showBaseError ? (
            <p
              id="auto-bet-base-error"
              className="text-xs text-muted-foreground"
            >
              {baseValidation.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="auto-bet-stop-loss">Stop-loss</Label>
          <Input
            id="auto-bet-stop-loss"
            inputMode="decimal"
            value={lockedStopLoss}
            disabled={isRunning}
            aria-disabled={isRunning}
            aria-describedby={
              showStopLossError ? "auto-bet-stop-loss-error" : undefined
            }
            onChange={(event) => setStopLossRaw(event.target.value)}
            onBlur={() =>
              setTouched((prev) => ({ ...prev, stopLoss: true }))
            }
            placeholder="50.00"
            className={inputDisabledClass}
          />
          <p className="text-xs text-muted-foreground">
            Halt if session loss reaches this
          </p>
          {showStopLossError ? (
            <p
              id="auto-bet-stop-loss-error"
              className="text-xs text-muted-foreground"
            >
              {stopLossValidation.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="auto-bet-stop-win">Stop-win</Label>
          <Input
            id="auto-bet-stop-win"
            inputMode="decimal"
            value={lockedStopWin}
            disabled={isRunning}
            aria-disabled={isRunning}
            aria-describedby={
              showStopWinError ? "auto-bet-stop-win-error" : undefined
            }
            onChange={(event) => setStopWinRaw(event.target.value)}
            onBlur={() => setTouched((prev) => ({ ...prev, stopWin: true }))}
            placeholder="100.00"
            className={inputDisabledClass}
          />
          <p className="text-xs text-muted-foreground">
            Halt if session profit reaches this
          </p>
          {showStopWinError ? (
            <p
              id="auto-bet-stop-win-error"
              className="text-xs text-muted-foreground"
            >
              {stopWinValidation.message}
            </p>
          ) : null}
        </div>

        {isRunning ? (
          <Button
            type="button"
            variant="outline"
            onClick={onStop}
            className="min-h-11 w-full border-destructive text-destructive motion-safe:active:scale-95"
          >
            <Pause className="size-4" />
            Stop auto-bet
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            disabled={!formValid}
            onClick={onStart}
            className="min-h-11 w-full motion-safe:active:scale-95"
          >
            <Play className="size-4" />
            Start auto-bet
          </Button>
        )}

        <AutoBetSessionPanel />
      </div>
    </TooltipProvider>
  );
}
