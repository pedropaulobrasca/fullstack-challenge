import { ExternalLink, ShieldAlert } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { HashBlock } from "@/components/hash-block";
import { VerdictChip, type VerdictKind } from "@/components/verdict-chip";
import { VerificationExplainer } from "@/features/fairness/verification-explainer";
import { useFairnessStore } from "@/features/fairness/fairness.store";
import { useRoundStore } from "@/stores/round.store";
import { useHistoryStore } from "@/stores/history.store";
import {
  useVerifyPrevious,
  type VerifyPreviousState,
} from "@/features/fairness/use-verify-previous";
import { getConfig } from "@/lib/config";

const MATCH_COPY = "MATCH · Previous commitment confirmed";
const MISMATCH_COPY = "MISMATCH · Commitment differs from revealed seed";
const PENDING_COPY = "Computing in your browser…";

type VerificationDrawerProps = {
  useVerifyPreviousImpl?: typeof useVerifyPrevious;
};

export function VerificationDrawer({
  useVerifyPreviousImpl = useVerifyPrevious,
}: VerificationDrawerProps = {}) {
  const open = useFairnessStore((state) => state.drawerOpen);
  const closeDrawer = useFairnessStore((state) => state.closeDrawer);
  const currentRoundId = useRoundStore((state) => state.roundId);
  const mostRecentChip = useHistoryStore((state) => state.entries[0] ?? null);
  const previousRoundId = mostRecentChip?.roundId ?? null;

  const verify = useVerifyPreviousImpl(previousRoundId);
  const slideMs = getConfig().drawer.slideMs;

  const verdict = pickVerdict(verify);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDrawer();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-[420px] max-w-[calc(100vw-32px)] flex-col gap-6 overflow-y-auto bg-popover p-6 motion-reduce:transition-none sm:max-w-[420px]"
        style={{ transitionDuration: `${slideMs}ms` }}
      >
        <SheetHeader className="p-0">
          <SheetTitle className="text-foreground">Fairness verification</SheetTitle>
          <SheetDescription>
            Hashed in your browser. No server trust required.
          </SheetDescription>
        </SheetHeader>

        {currentRoundId !== null ? (
          <section className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current round #{currentRoundId}
            </div>
            <div className="text-sm text-foreground">Commitment hash</div>
            <HashBlock
              label="commitment hash"
              value={
                currentRoundId
                  ? `commitment-for-${currentRoundId}`
                  : "commitment unavailable"
              }
            />
          </section>
        ) : null}

        <Separator />

        {previousRoundId === null ? (
          <Alert>
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>No previous round yet</AlertTitle>
            <AlertDescription>
              A previous round will appear here once at least one round has settled.
            </AlertDescription>
          </Alert>
        ) : verify.errorCode === "ROUND_NOT_YET_SETTLED" ? (
          <Alert>
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>Round still settling</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                The previous round is still settling. Try again in a moment.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => verify.retry()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : verify.errorCode === "NETWORK" ? (
          <Alert variant="destructive">
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>Verification unavailable</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>
                Couldn't load round data. Check your connection and try again.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => verify.retry()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : verify.errorCode === "CRYPTO_UNAVAILABLE" ? (
          <Alert variant="destructive">
            <ShieldAlert aria-hidden="true" />
            <AlertTitle>Browser cryptography unavailable</AlertTitle>
            <AlertDescription>
              {verify.errorMessage}
            </AlertDescription>
          </Alert>
        ) : (
          <section className="flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Previous round #{previousRoundId}
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm text-foreground">Revealed serverSeed</div>
              <HashBlock
                label="revealed server seed"
                value={verify.previousServerSeed ?? "loading…"}
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm text-foreground">
                SHA-256 of revealed seed (in your browser)
              </div>
              <HashBlock
                label="computed sha-256"
                value={verify.computedHash ?? "computing…"}
              />
            </div>
            <VerdictChip
              verdict={verdict}
              matchText={MATCH_COPY}
              mismatchText={MISMATCH_COPY}
              pendingText={PENDING_COPY}
            />
          </section>
        )}

        <VerificationExplainer />

        {previousRoundId !== null ? (
          <a
            href={`/verify/${previousRoundId}`}
            className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10"
          >
            <span>Open full verification</span>
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function pickVerdict(state: VerifyPreviousState): VerdictKind {
  if (state.status === "match") return "MATCH";
  if (state.status === "mismatch") return "MISMATCH";
  return "PENDING";
}
