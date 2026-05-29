import { createFileRoute } from "@tanstack/react-router";
import { enforceLogin } from "@/auth/oidc";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: enforceLogin,
  component: GameRoute,
});

function GameRoute() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 lg:px-6">
      <HistoryStrip />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)_320px]">
        <BetRail />
        <CurveStage />
        <FeedRail />
      </div>
    </div>
  );
}

function HistoryStrip() {
  return (
    <section
      data-region="history-strip"
      className="flex min-h-12 items-center gap-2 overflow-x-auto rounded-lg border border-border bg-card px-4 py-2"
    >
      <span className="text-sm text-muted-foreground">
        Crash history will appear after the first round settles.
      </span>
    </section>
  );
}

function CurveStage() {
  return (
    <section
      data-region="curve-stage"
      className="order-first flex min-h-[40vh] items-center justify-center rounded-lg border border-border bg-card lg:order-none lg:min-h-[520px]"
    >
      <span className="font-mono text-2xl font-semibold text-muted-foreground">Waiting for round</span>
    </section>
  );
}

function BetRail() {
  return (
    <aside
      data-region="bet-rail"
      className="flex min-h-40 flex-col gap-4 rounded-lg border border-border bg-card p-6"
    >
      <h2 className="font-sans text-sm font-semibold text-muted-foreground">Place Bet</h2>
    </aside>
  );
}

function FeedRail() {
  return (
    <aside
      data-region="feed-rail"
      className="flex min-h-40 flex-col gap-4 rounded-lg border border-border bg-card p-6"
    >
      <h2 className="font-sans text-sm font-semibold text-muted-foreground">No bets yet this round</h2>
      <p className="text-sm text-muted-foreground">
        Place a bet during the betting window to see the action here.
      </p>
    </aside>
  );
}
