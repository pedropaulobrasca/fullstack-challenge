import { useEffect, useState } from "react";
import { useRoundStore } from "@/stores/round.store";
import { useReducedMotion } from "@/features/juice/use-reduced-motion";
import { cn } from "@/lib/utils";

const FLASH_MS = 200;
const FREEZE_MS = 700;

export function CrashFlash() {
  const status = useRoundStore((state) => state.status);
  const crashValue = useRoundStore((state) => state.crashValue);
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "flash" | "freeze">("idle");

  useEffect(() => {
    if (status !== "CRASHED") {
      setPhase("idle");
      return;
    }

    if (reducedMotion) {
      setPhase("freeze");
      const freezeTimer = setTimeout(() => setPhase("idle"), FREEZE_MS);
      return () => clearTimeout(freezeTimer);
    }

    setPhase("flash");
    const flashTimer = setTimeout(() => setPhase("freeze"), FLASH_MS);
    const freezeTimer = setTimeout(() => setPhase("idle"), FLASH_MS + FREEZE_MS);
    return () => {
      clearTimeout(flashTimer);
      clearTimeout(freezeTimer);
    };
  }, [status, reducedMotion]);

  if (phase === "idle") {
    return null;
  }

  return (
    <div
      data-slot="crash-flash"
      data-phase={phase}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg",
        phase === "flash" && "bg-destructive/40 transition-opacity duration-200",
        phase === "freeze" && "bg-destructive/10",
      )}
    >
      {crashValue !== null ? (
        <span className="font-mono text-4xl font-semibold tabular-nums text-destructive">
          Crashed @ {crashValue.toFixed(2)}x
        </span>
      ) : null}
    </div>
  );
}
