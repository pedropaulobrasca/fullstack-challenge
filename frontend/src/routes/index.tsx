import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import { enforceLogin } from "@/auth/oidc";
import { CrashCurve } from "@/components/crash-curve";
import { BetPanel } from "@/components/bet-panel";
import { CashoutButton } from "@/components/cashout-button";
import { Countdown } from "@/components/countdown";
import { LiveFeed } from "@/components/live-feed";
import { LeaderboardPanel } from "@/components/leaderboard-panel";
import { HistoryStrip } from "@/components/history-strip";
import { CurveSkeleton, HistorySkeleton } from "@/components/game-skeletons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CrashFlash } from "@/features/juice/crash-flash";
import { celebrate } from "@/features/juice/celebrate";
import { useWallet } from "@/features/wallet/use-wallet";
import { useHistory } from "@/features/history/use-history";
import { useRoundStore } from "@/stores/round.store";
import { useBetStore } from "@/stores/bet.store";
import { useConnectionStore } from "@/ws/use-game-socket";
import { toastNetwork, clearToastKey } from "@/lib/toast";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: enforceLogin,
  component: GameRoute,
});

function GameRoute() {
  useWallet();
  const history = useHistory();
  const hasRound = useRoundStore((state) => state.roundId !== null);
  const roundStatus = useRoundStore((state) => state.status);
  const lastBetOutcome = useBetStore((state) => state.lastOutcome);
  const celebrating = useBetStore((state) => state.celebrate);
  const clearCelebration = useBetStore((state) => state.clearCelebration);
  const connectionStatus = useConnectionStore((state) => state.status);
  const [feedTab, setFeedTab] = useState<"live-feed" | "leaderboard">("live-feed");

  useEffect(() => {
    if (celebrating) {
      celebrate();
      clearCelebration();
    }
  }, [celebrating, clearCelebration]);

  useEffect(() => {
    if (connectionStatus === "reconnecting") {
      toastNetwork();
    } else if (connectionStatus === "connected") {
      clearToastKey("network");
    }
  }, [connectionStatus]);

  return (
    <div
      data-testid="game-root"
      data-round-status={roundStatus}
      data-last-bet-outcome={lastBetOutcome ?? "none"}
      className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 pb-28 pt-6 lg:px-6 lg:pb-6"
    >
      <section
        data-region="history-strip"
        className="min-h-12 rounded-lg border border-border bg-card"
      >
        {history.isLoading ? <HistorySkeleton /> : <HistoryStrip />}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)_320px] lg:min-h-[calc(100vh-12rem)]">
        <aside
          data-region="bet-rail"
          className="sticky bottom-0 z-10 order-2 flex flex-col gap-4 border-t border-border bg-background py-3 lg:static lg:order-none lg:border-t-0 lg:bg-transparent lg:py-0"
        >
          <Countdown />
          <BetPanel />
          <CashoutButton />
        </aside>

        <section
          data-region="curve-stage"
          className="relative order-1 min-h-[40vh] overflow-hidden rounded-lg border border-border bg-card lg:order-none lg:min-h-0 lg:h-full"
        >
          {hasRound ? (
            <>
              <CrashCurve />
              <CrashFlash />
            </>
          ) : (
            <CurveSkeleton />
          )}
        </section>

        <aside
          data-region="feed-rail"
          className="order-3 flex min-h-40 flex-col lg:order-none lg:min-h-0 lg:h-full"
        >
          <Tabs
            value={feedTab}
            onValueChange={(value) => setFeedTab(value as "live-feed" | "leaderboard")}
            className="flex h-full flex-col"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="live-feed">Live Feed</TabsTrigger>
              <TabsTrigger value="leaderboard">
                <Trophy className="size-3.5" aria-hidden="true" />
                Leaderboard
              </TabsTrigger>
            </TabsList>
            <TabsContent value="live-feed" className="min-h-0 flex-1">
              <LiveFeed />
            </TabsContent>
            <TabsContent value="leaderboard" className="min-h-0 flex-1">
              <LeaderboardPanel isActive={feedTab === "leaderboard"} />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
