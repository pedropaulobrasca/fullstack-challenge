import { Skeleton } from "@/components/ui/skeleton";

export function CurveSkeleton() {
  return (
    <div
      data-slot="curve-skeleton"
      className="flex h-full w-full flex-col items-center justify-center gap-4 p-6"
    >
      <Skeleton className="h-12 w-40" />
      <Skeleton className="h-40 w-full max-w-2xl" />
    </div>
  );
}

export function HistorySkeleton() {
  return (
    <div
      data-slot="history-skeleton"
      className="flex items-center gap-2 overflow-hidden px-4 py-3"
    >
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-11 w-16 shrink-0 rounded-md" />
      ))}
    </div>
  );
}
