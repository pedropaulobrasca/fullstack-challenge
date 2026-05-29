import { useEffect, useRef, useState } from "react";
import { Money } from "@crash/shared-kernel";
import { useReducedMotion } from "@/features/juice/use-reduced-motion";

const TWEEN_MS = 400;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function useCountUp(targetCents: bigint): Money {
  const reducedMotion = useReducedMotion();
  const [displayCents, setDisplayCents] = useState<bigint>(targetCents);
  const fromRef = useRef<bigint>(targetCents);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (displayCents === targetCents) {
      return;
    }

    if (reducedMotion || typeof window === "undefined" || !window.requestAnimationFrame) {
      setDisplayCents(targetCents);
      return;
    }

    const from = fromRef.current;
    const delta = targetCents - from;
    const start = performance.now();

    const step = (timestamp: number) => {
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / TWEEN_MS, 1);
      const eased = easeOutCubic(progress);
      const current = from + BigInt(Math.round(Number(delta) * eased));
      setDisplayCents(current);
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        setDisplayCents(targetCents);
        frameRef.current = null;
      }
    };

    frameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [targetCents, reducedMotion]);

  useEffect(() => {
    fromRef.current = displayCents;
  }, [displayCents]);

  const safeCents = displayCents < 0n ? 0n : displayCents;
  return Money.of(safeCents);
}
