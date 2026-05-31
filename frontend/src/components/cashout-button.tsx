import { Money } from "@crash/shared-kernel";
import { Button } from "@/components/ui/button";
import { useRoundStore } from "@/stores/round.store";
import { useMultiplierStore } from "@/stores/multiplier.store";
import { useBetStore } from "@/stores/bet.store";
import { useCashout } from "@/features/bet/use-cashout";

export function CashoutButton() {
  const status = useRoundStore((state) => state.status);
  const myBet = useBetStore((state) => state.myBet);
  const renderedMultiplier = useMultiplierStore(
    (state) => state.renderedMultiplier,
  );
  const cashout = useCashout();

  const canCashout = status === "RUNNING" && myBet?.status === "ACTIVE";
  if (!canCashout || myBet === null) {
    return null;
  }

  const payout = Money.fromSnapshot(myBet.amount).multiplyRounded(
    renderedMultiplier,
  );

  return (
    <Button
      type="button"
      data-testid="cashout-button"
      onClick={() => cashout.mutate()}
      disabled={cashout.isPending}
      className="min-h-11 w-full bg-accent font-semibold text-accent-foreground shadow-[0_0_24px_rgba(0,255,133,0.35)] hover:bg-accent/90"
    >
      Cash Out {renderedMultiplier.toFixed(2)}x · {payout.toString()}
    </Button>
  );
}
