import { z } from "zod";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HashBlock } from "@/components/hash-block";
import { VerdictChip, type VerdictKind } from "@/components/verdict-chip";
import { VerificationExplainer } from "@/features/fairness/verification-explainer";
import {
  useRecomputeCrashpoint,
  type RecomputeState,
} from "@/features/verify/use-recompute-crashpoint";

const MATCH_COPY = "MATCH · Computed crash point equals reported crash point";
const MISMATCH_COPY = "MISMATCH · Computed crash point differs from reported";
const PENDING_COPY = "Computing in your browser…";

const ROUND_ID_SCHEMA = z.string().uuid();

const FORMULA_VERSION_NAMES: Record<number, string> = {
  1: "bustabit-52bit-instant-101",
};

type RouteProps = {
  useRecomputeImpl?: typeof useRecomputeCrashpoint;
};

export const Route = createFileRoute("/verify/$roundId")({
  ssr: false,
  component: VerifyRoutePage,
});

function VerifyRoutePage() {
  const { roundId } = Route.useParams();
  return <VerifyPage roundId={roundId} />;
}

export function VerifyPage({
  roundId,
  useRecomputeImpl = useRecomputeCrashpoint,
}: { roundId: string } & RouteProps) {
  const parsed = ROUND_ID_SCHEMA.safeParse(roundId);
  const validRoundId = parsed.success ? parsed.data : null;
  const state = useRecomputeImpl(validRoundId);
  const shortId = roundId.length > 8 ? roundId.slice(-8) : roundId;

  return (
    <div
      data-region="verify-route"
      className="mx-auto flex w-full flex-col gap-6 px-4 py-12"
      style={{ maxWidth: "min(720px, 100vw - 64px)" }}
    >
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-mono text-2xl font-semibold tracking-tight text-foreground">
          Verifying Round #{shortId}
        </h1>
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span>Live game</span>
        </Link>
      </header>

      {validRoundId === null ? (
        <NotFoundAlert shortId={shortId} />
      ) : (
        <VerifyBody state={state} shortId={shortId} />
      )}

      <section
        data-region="verify-explainer"
        className="flex flex-col gap-3"
      >
        <h2 className="text-lg font-semibold text-foreground">How this works</h2>
        <VerificationExplainer />
      </section>

      <section
        data-region="verify-recruiter-example"
        className="flex flex-col gap-3"
      >
        <h2 className="text-lg font-semibold text-foreground">Verify outside the app</h2>
        <pre
          data-slot="recruiter-example-block"
          className="overflow-x-auto rounded-md border border-border bg-popover p-4 font-mono text-sm text-muted-foreground"
        >
{`# README example will land in Plan 08-09 — see README.md`}
        </pre>
      </section>
    </div>
  );
}

function VerifyBody({ state, shortId }: { state: RecomputeState; shortId: string }) {
  if (state.status === "loading" || state.status === "computing") {
    return <LoadingCards />;
  }
  if (state.status === "not-settled") {
    return <NotSettledAlert />;
  }
  if (state.status === "not-found") {
    return <NotFoundAlert shortId={shortId} />;
  }
  if (state.status === "error") {
    return <ErrorAlert state={state} />;
  }
  if (state.verifyResponse === null) {
    return <LoadingCards />;
  }
  return <VerdictCards state={state} />;
}

function LoadingCards() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Inputs (from server)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-64" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Computed in your browser</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-6 w-32" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reported by server</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24" />
        </CardContent>
      </Card>
    </div>
  );
}

function VerdictCards({ state }: { state: RecomputeState }) {
  const response = state.verifyResponse;
  if (response === null) return null;

  const formula =
    FORMULA_VERSION_NAMES[response.formulaVersion] ??
    `formula-v${response.formulaVersion}`;

  const verdict: VerdictKind = state.status === "match" ? "MATCH" : "MISMATCH";
  const computedCrash = state.computedCrashPoint;
  const hmacHex = state.computedHmacHex;
  const first13 = state.computedFirst13Hex;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Inputs (from server)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              serverSeed
            </span>
            <HashBlock label="server seed" value={response.serverSeed} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              clientSeed
            </span>
            <HashBlock label="client seed" value={response.clientSeed} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              nonce
            </span>
            <code className="rounded-md border border-border bg-popover px-4 py-2 font-mono text-sm text-foreground">
              {response.nonce}
            </code>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              formula
            </span>
            <code className="rounded-md border border-border bg-popover px-4 py-2 font-mono text-sm text-foreground">
              {formula}
            </code>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Computed in your browser</CardTitle>
          <p className="text-sm text-muted-foreground">
            HMAC-SHA-256(serverSeed, clientSeed:nonce)
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {hmacHex !== null ? (
            <HashBlock label="computed HMAC" value={hmacHex} />
          ) : null}
          {first13 !== null ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                52-bit slice (first 13 hex)
              </span>
              <code className="rounded-md border border-border bg-popover px-4 py-2 font-mono text-sm text-foreground">
                0x{first13}
              </code>
            </div>
          ) : null}
          {computedCrash !== null ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                computed crash point
              </span>
              <code className="rounded-md border border-border bg-popover px-4 py-2 font-mono text-xl font-semibold tabular-nums text-foreground">
                {computedCrash.toFixed(2)}x
              </code>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reported by server</CardTitle>
        </CardHeader>
        <CardContent>
          <code className="rounded-md border border-border bg-popover px-4 py-2 font-mono text-xl font-semibold tabular-nums text-foreground">
            {response.crashPoint.toFixed(2)}x
          </code>
        </CardContent>
      </Card>

      <VerdictChip
        verdict={verdict}
        matchText={MATCH_COPY}
        mismatchText={MISMATCH_COPY}
        pendingText={PENDING_COPY}
      />
    </div>
  );
}

function NotSettledAlert() {
  return (
    <Alert>
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>Round not yet revealed</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          This round has not crashed yet. The serverSeed will be revealed automatically after it settles.
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Refresh
          </Button>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent/10"
          >
            Go to live game
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function NotFoundAlert({ shortId }: { shortId: string }) {
  return (
    <Alert variant="destructive">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>Round #{shortId} not found.</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>The round id is invalid or no longer available.</span>
        <Link
          to="/"
          className="inline-flex items-center justify-center self-start rounded-md border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent/10"
        >
          Back to live game
        </Link>
      </AlertDescription>
    </Alert>
  );
}

function ErrorAlert({ state }: { state: RecomputeState }) {
  return (
    <Alert variant="destructive">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>Couldn't load round data.</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          {state.errorMessage ?? "Check your connection and try again."}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => state.retry()}
          className="self-start"
        >
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
