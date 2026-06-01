import { useCallback, useEffect, useRef } from "react";
import { useRoundStore } from "@/stores/round.store";
import { useRafCurve, type RafCurveDriver } from "@/features/curve/use-raf-curve";
import { drawCurve, createCurveScene, type CurveScene } from "@/features/curve/draw-curve";

/* ============================================================================
   crash-curve.tsx — owns the canvas, the persistent CurveScene, and a
   CONTINUOUS rAF that re-draws every frame so the rocket / starfield /
   crash-explosion animate through every phase (not just RUNNING).

   `useRafCurve` is kept ONLY to compute + publish the live multiplier number
   (it still writes to multiplier.store and returns a frameRef). The visual
   loop below reads that number plus the round status each frame. The two
   concerns stay cleanly separated.
   ============================================================================ */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function readDpr(): number {
  return typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
}

type CrashCurveProps = {
  driver?: RafCurveDriver;
  ariaLabel?: string;
};

export function CrashCurve({ driver, ariaLabel }: CrashCurveProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cssSizeRef = useRef({ width: 0, height: 0 });
  const reducedMotionRef = useRef(false);
  const sceneRef = useRef<CurveScene>(createCurveScene());

  // keep the multiplier number flowing through the store + frameRef
  const frameRef = useRafCurve(undefined, driver);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const cssWidth = parent.clientWidth;
    const cssHeight = parent.clientHeight;
    const dpr = readDpr();
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    cssSizeRef.current = { width: cssWidth, height: cssHeight };
  }, []);

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    reducedMotionRef.current = media.matches;
    const onChange = () => { reducedMotionRef.current = media.matches; };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    sizeCanvas();
    const parent = canvasRef.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => sizeCanvas());
    observer.observe(parent);
    return () => observer.disconnect();
  }, [sizeCanvas]);

  // continuous visual loop
  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const round = useRoundStore.getState();
        const { width, height } = cssSizeRef.current;
        drawCurve(ctx, {
          width: width || canvas.width,
          height: height || canvas.height,
          dpr: readDpr(),
          multiplier: frameRef.current.multiplier,
          status: driver ? driver.status() : round.status,
          crashValue: driver ? driver.crashValue() : round.crashValue,
          reducedMotion: reducedMotionRef.current,
          scene: sceneRef.current,
          time: performance.now(),
        });
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [driver, frameRef]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        data-slot="crash-curve"
        role="img"
        aria-label={ariaLabel ?? "Live crash multiplier curve"}
        className="block h-full w-full"
      />
    </div>
  );
}
