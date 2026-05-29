import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { parseBetAmount } from "@/features/bet/bet-amount";
import { useRoundStore } from "@/stores/round.store";
import { useBetStore } from "@/stores/bet.store";
import { usePlaceBet } from "@/features/bet/use-place-bet";

const reasonCopy = {
  invalid: "Enter a valid amount.",
  "below-min": "Below the minimum bet.",
  "above-max": "Above the maximum bet.",
} as const;

export function BetPanel() {
  const [raw, setRaw] = useState("");
  const status = useRoundStore((state) => state.status);
  const myBet = useBetStore((state) => state.myBet);
  const pending = useBetStore((state) => state.pending);
  const placeBet = usePlaceBet();

  const parsed = parseBetAmount(raw);
  const showReason = raw.trim() !== "" && !parsed.ok;
  const canBet =
    status === "BETTING" && myBet === null && !pending && parsed.ok;

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="bet-amount">Bet amount</Label>
        <Input
          id="bet-amount"
          inputMode="decimal"
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          placeholder="0.00"
        />
        {showReason ? (
          <p className="text-sm text-muted-foreground">
            {!parsed.ok ? reasonCopy[parsed.reason] : null}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={!canBet}
        onClick={() => {
          if (parsed.ok) {
            placeBet.mutate(parsed.money);
          }
        }}
        className="min-h-11 w-full border"
      >
        {myBet !== null ? "Bet Active" : "Place Bet"}
      </Button>
    </Card>
  );
}
