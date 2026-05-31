import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import { PlayerId, maskPlayerId } from "@crash/shared-kernel/identity";
import type { LeaderboardEntryWire } from "@crash/contracts/ws";
import { getConfig } from "@/lib/config";
import { useOidc } from "@/auth/oidc";
import { useLeaderboard } from "@/features/leaderboard/use-leaderboard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { LeaderboardRow } from "./leaderboard-row";

type LeaderboardPanelProps = {
  isActive: boolean;
};

function useOwnMasked(): string | null {
  const oidc = useOidc();
  return useMemo(() => {
    if (!oidc.isUserLoggedIn) return null;
    const tokens = (oidc as unknown as {
      oidcTokens?: { decodedIdToken?: { sub?: string } };
    }).oidcTokens;
    const sub = tokens?.decodedIdToken?.sub;
    if (!sub) return null;
    return maskPlayerId(PlayerId(sub));
  }, [oidc]);
}

function formatRelative(diffMs: number): string {
  if (diffMs < 5_000) return "Just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / (60 * 60_000))}h ago`;
}

function useRelativeFooter(updatedAt: string | undefined, isActive: boolean): string {
  const { relativeRefreshMs } = getConfig().leaderboard;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive || !updatedAt) return;
    const id = setInterval(() => setNow(Date.now()), relativeRefreshMs);
    return () => clearInterval(id);
  }, [isActive, updatedAt, relativeRefreshMs]);

  if (!updatedAt) return "";
  const ts = Date.parse(updatedAt);
  if (Number.isNaN(ts)) return "";
  return formatRelative(now - ts);
}

function SkeletonRows() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          data-slot="leaderboard-skeleton"
          className="flex items-center gap-3 border-b border-b-border/40 px-4 py-2 min-h-11"
        >
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function LeaderboardPanel({ isActive }: LeaderboardPanelProps) {
  const { sizeN, windowHours } = getConfig().leaderboard;
  const { data, isLoading, isError, refetch } = useLeaderboard("24h");
  const ownMasked = useOwnMasked();
  const previousRanks = useRef<Map<string, number>>(new Map());
  const announcement = useRef<string>("");
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!data || !ownMasked) return;
    const next = new Map<string, number>();
    let ownPrev: number | null = null;
    let ownNext: number | null = null;
    for (const entry of data.entries) {
      next.set(entry.playerIdMasked, entry.rank);
      if (entry.playerIdMasked === ownMasked) ownNext = entry.rank;
    }
    const prevRank = previousRanks.current.get(ownMasked);
    if (prevRank !== undefined) ownPrev = prevRank;
    if (ownPrev !== null && ownNext !== null && ownNext < ownPrev) {
      announcement.current = `You moved up to rank ${ownNext}`;
      forceTick((n) => n + 1);
    }
    previousRanks.current = next;
  }, [data, ownMasked]);

  const relative = useRelativeFooter(data?.updatedAt, isActive);

  return (
    <div
      data-slot="leaderboard-panel"
      className="flex h-full min-h-40 flex-col rounded-md border bg-card"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">
          Top {sizeN} · last {windowHours}h
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Refresh leaderboard"
          title="Refresh now"
          className="size-11"
          onClick={() => {
            void refetch();
          }}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <SkeletonRows />
        ) : isError ? (
          <div className="px-4 py-4">
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Couldn't load leaderboard.</AlertTitle>
              <AlertDescription>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 min-h-11"
                  onClick={() => {
                    void refetch();
                  }}
                >
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 py-8 text-center">
            <p className="font-semibold text-foreground">
              No rounds settled in the last {windowHours}h yet.
            </p>
            <p className="text-sm text-muted-foreground">
              The leaderboard updates as players cash out.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {data.entries.map((entry: LeaderboardEntryWire) => {
              const previous =
                previousRanks.current.get(entry.playerIdMasked) ?? null;
              const isOwn =
                ownMasked !== null && entry.playerIdMasked === ownMasked;
              return (
                <LeaderboardRow
                  key={entry.playerIdMasked}
                  entry={entry}
                  isOwnRow={isOwn}
                  previousRank={previous}
                />
              );
            })}
          </div>
        )}
      </ScrollArea>

      {data?.updatedAt && (
        <div className="border-t border-border/60 px-4 py-2 text-sm text-muted-foreground">
          Updated {relative}
        </div>
      )}

      <div role="status" aria-live="polite" className="sr-only">
        {announcement.current}
      </div>
    </div>
  );
}
