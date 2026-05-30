import { CheckCircle2, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type VerdictKind = "MATCH" | "MISMATCH" | "PENDING";

type VerdictChipProps = {
  verdict: VerdictKind;
  matchText: string;
  mismatchText: string;
  pendingText: string;
  className?: string;
};

export function VerdictChip({
  verdict,
  matchText,
  mismatchText,
  pendingText,
  className,
}: VerdictChipProps) {
  if (verdict === "PENDING") {
    return (
      <Skeleton
        data-slot="verdict-chip-pending"
        className={cn("h-8 w-48", className)}
        aria-label={pendingText}
      />
    );
  }

  if (verdict === "MATCH") {
    return (
      <div
        data-slot="verdict-chip"
        data-verdict="match"
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent",
          className,
        )}
      >
        <CheckCircle2 aria-hidden="true" className="size-4" />
        <span>{matchText}</span>
      </div>
    );
  }

  return (
    <div
      data-slot="verdict-chip"
      data-verdict="mismatch"
      role="status"
      aria-live="assertive"
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive",
        className,
      )}
    >
      <XCircle aria-hidden="true" className="size-4" />
      <span>{mismatchText}</span>
    </div>
  );
}
