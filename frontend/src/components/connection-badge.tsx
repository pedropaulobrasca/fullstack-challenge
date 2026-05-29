import { useConnectionStore } from "@/ws/use-game-socket";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ConnectionBadge() {
  const status = useConnectionStore((state) => state.status);
  const connected = status === "connected";

  return (
    <Badge
      variant="outline"
      data-slot="connection-badge"
      data-status={connected ? "live" : "reconnecting"}
      className="gap-2 font-sans text-xs font-semibold"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          connected ? "bg-accent" : "bg-warning",
        )}
      />
      {connected ? "Live" : "Reconnecting…"}
    </Badge>
  );
}
