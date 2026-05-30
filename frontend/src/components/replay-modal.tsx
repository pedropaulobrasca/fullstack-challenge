import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, ShieldAlert } from "lucide-react";
import { crashTimeMs } from "@crash/contracts/multiplier";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CrashCurve } from "@/components/crash-curve";
import { ReplaySpeedToggle } from "@/components/replay-speed-toggle";
import { ReplayOverlays } from "@/features/replay/replay-overlays";
import { makeReplayDriver } from "@/features/replay/replay-driver";
import { useRoundDetail } from "@/features/replay/use-round-detail";
import { useReplayStore } from "@/features/replay/replay.store";
import { getConfig } from "@/lib/config";
import type { useRoundDetail as UseRoundDetailType } from "@/features/replay/use-round-detail";

const DIALOG_DESCRIPTION =
  "Reproduced from serverSeed + clientSeed + bets[]. Same renderer as the live game.";

type ReplayModalProps = {
  useRoundDetailImpl?: typeof UseRoundDetailType;
};

function shortRoundId(roundId: string): string {
  const tail = roundId.slice(-8);
  return tail.length > 0 ? tail : roundId;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ReplayModal({
  useRoundDetailImpl = useRoundDetail,
}: ReplayModalProps = {}) {
  const roundId = useReplayStore((state) => state.roundId);
  const playing = useReplayStore((state) => state.playing);
  const speed = useReplayStore((state) => state.speed);
  const setPlaying = useReplayStore((state) => state.setPlaying);
  const setSpeed = useReplayStore((state) => state.setSpeed);
  const closeReplay = useReplayStore((state) => state.closeReplay);

  if (roundId === null) {
    return null;
  }

  return (
    <ReplayModalBody
      roundId={roundId}
      playing={playing}
      speed={speed}
      setPlaying={setPlaying}
      setSpeed={setSpeed}
      closeReplay={closeReplay}
      useRoundDetailImpl={useRoundDetailImpl}
    />
  );
}

type ReplayModalBodyProps = {
  roundId: string;
  playing: boolean;
  speed: number;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  closeReplay: () => void;
  useRoundDetailImpl: typeof UseRoundDetailType;
};

function ReplayModalBody({
  roundId,
  playing,
  speed,
  setPlaying,
  setSpeed,
  closeReplay,
  useRoundDetailImpl,
}: ReplayModalBodyProps) {
  const config = getConfig();
  const detail = useRoundDetailImpl(roundId);

  const data = detail.data ?? null;
  const growthRate = data?.growthRate ?? null;
  const crashPoint = data?.crashPoint ?? null;

  const driver = useMemo(() => {
    if (growthRate === null || crashPoint === null) return null;
    return makeReplayDriver({
      growthRate,
      crashPoint,
      speed: () => useReplayStore.getState().speed,
      paused: () => !useReplayStore.getState().playing,
    });
  }, [roundId, growthRate, crashPoint]);

  const totalMs = useMemo(() => {
    if (growthRate === null || crashPoint === null) return 0;
    try {
      return crashTimeMs(growthRate, crashPoint);
    } catch {
      return 0;
    }
  }, [growthRate, crashPoint]);

  const startedAtRef = useRef<number>(performance.now());
  useEffect(() => {
    startedAtRef.current = performance.now();
  }, [roundId]);

  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const next = Math.min(totalMs, (now - startedAtRef.current) * speed);
      setElapsedMs(next);
      if (next < totalMs) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, totalMs, roundId]);

  return (
    <Dialog open onOpenChange={(open) => !open && closeReplay()}>
      <DialogContent
        data-slot="replay-modal"
        className="grid max-h-[min(720px,calc(100vh-64px))] w-full max-w-[min(960px,calc(100vw-64px))] grid-rows-[auto_1fr_auto] gap-4 bg-background p-6"
      >
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2 text-foreground">
            <span>Replay · Round #{shortRoundId(roundId)}</span>
            {crashPoint !== null ? (
              <span className="font-mono text-base font-normal text-muted-foreground">
                @ {crashPoint.toFixed(2)}x
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription>{DIALOG_DESCRIPTION}</DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <ReplayLoading />
        ) : detail.isError ? (
          <ReplayError
            roundId={roundId}
            onRetry={() => detail.refetch()}
          />
        ) : driver !== null && data !== null ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="relative aspect-[16/11] w-full overflow-hidden rounded-md border border-border bg-card">
              <CrashCurve driver={driver} ariaLabel="Replay curve" />
            </div>
            <ReplayOverlays bets={data.bets} />
          </div>
        ) : (
          <ReplayLoading />
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={playing ? "outline" : "default"}
              size="sm"
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? "Pause replay" : "Play replay"}
              className="min-h-11 min-w-11"
              disabled={detail.isLoading || detail.isError}
            >
              {playing ? (
                <>
                  <Pause aria-hidden="true" className="size-4" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play aria-hidden="true" className="size-4" />
                  <span>Play</span>
                </>
              )}
            </Button>
            <ReplaySpeedToggle
              speeds={config.replay.speeds}
              currentSpeed={speed}
              onChange={setSpeed}
              disabled={detail.isLoading || detail.isError}
            />
          </div>
          <div
            className="font-mono text-sm tabular-nums text-muted-foreground"
            aria-label="Replay elapsed time"
          >
            {formatTime(elapsedMs)} / {formatTime(totalMs)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReplayLoading() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Skeleton className="aspect-[16/11] w-full rounded-md" />
      <Skeleton className="h-full min-h-40 rounded-md" />
    </div>
  );
}

type ReplayErrorProps = {
  roundId: string;
  onRetry: () => void;
};

function ReplayError({ roundId, onRetry }: ReplayErrorProps) {
  return (
    <Alert variant="destructive">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>Replay unavailable</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>Couldn't load replay data for Round #{shortRoundId(roundId)}.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="self-start"
        >
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
