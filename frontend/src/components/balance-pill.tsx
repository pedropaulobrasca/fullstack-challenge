import { Plus } from "lucide-react";
import { useWalletStore } from "@/stores/wallet.store";
import { useCountUp } from "@/features/juice/use-count-up";
import { useTopUp } from "@/features/wallet/use-wallet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function BalancePill() {
  const balance = useWalletStore((state) => state.balance);
  const targetCents = balance === null ? 0n : BigInt(balance.amount);
  const displayed = useCountUp(targetCents);
  const topUp = useTopUp();

  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        data-slot="balance-pill"
        data-testid="balance-pill"
        data-loading={balance === null ? "true" : "false"}
        className="font-mono text-sm font-semibold tabular-nums"
      >
        {balance === null ? "— CRD" : displayed.toString()}
      </Badge>
      <Button
        variant="ghost"
        size="icon-xs"
        title="Top up 1000 CRD (dev)"
        aria-label="Top up 1000 CRD"
        data-testid="balance-topup"
        disabled={topUp.isPending}
        onClick={() => topUp.mutate()}
      >
        <Plus />
      </Button>
    </div>
  );
}
