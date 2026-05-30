import { useCallback, useEffect, useRef } from "react";
import { useRoundStore } from "@/stores/round.store";
import {
  useRafCurve,
  type CurveFrame,
  type RafCurveDriver,
} from "@/features/curve/use-raf-curve";
import { drawCurve } from "@/features/curve/draw-curve";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function readDpr(): number {
  return typeof window !== "undefined" && window.devicePixelRatio
    ? window.devicePixelRatio
    : 1;
}

type CrashCurveProps = {
  driver?: RafCurveDriver;
  ariaLabel?: string;
};

export function CrashCurve({ driver, ariaLabel }: CrashCurveProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cssSizeRef = useRef({ width: 0, height: 0 });
  const reducedMotionRef = useRef(false);

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }
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
    const onChange = () => {
      reducedMotionRef.current = media.matches;
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    sizeCanvas();
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) {
      return;
    }
    const observer = new ResizeObserver(() => sizeCanvas());
    observer.observe(parent);
    return () => observer.disconnect();
  }, [sizeCanvas]);

  const renderFrame = useCallback((frame: CurveFrame) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const round = useRoundStore.getState();
    const { width, height } = cssSizeRef.current;
    const drawStatus = driver ? driver.status() : round.status;
    const drawCrashValue = driver ? driver.crashValue() : round.crashValue;
    drawCurve(ctx, {
      width: width || canvas.width,
      height: height || canvas.height,
      dpr: readDpr(),
      multiplier: frame.multiplier,
      status: drawStatus,
      crashValue: drawCrashValue,
      reducedMotion: reducedMotionRef.current,
    });
  }, [driver]);

  useRafCurve(renderFrame, driver);

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
