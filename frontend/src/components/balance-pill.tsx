import { useWalletStore } from "@/stores/wallet.store";
import { useCountUp } from "@/features/juice/use-count-up";
import { Badge } from "@/components/ui/badge";

export function BalancePill() {
  const balance = useWalletStore((state) => state.balance);
  const targetCents = balance === null ? 0n : BigInt(balance.amount);
  const displayed = useCountUp(targetCents);

  return (
    <Badge
      variant="outline"
      data-slot="balance-pill"
      data-testid="balance-pill"
      data-loading={balance === null ? "true" : "false"}
      className="font-mono text-sm font-semibold tabular-nums"
    >
      {balance === null ? "— CRD" : displayed.toString()}
    </Badge>
  );
}
