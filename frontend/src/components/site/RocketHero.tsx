import { useEffect, useRef } from "react";
import { mountRocketDemo } from "@/features/curve/rocket-canvas";

/* RocketHero — drops the looping rocket demo into a <canvas>. Size it with the
   parent element (the canvas fills it). Used on the landing hero + auth art. */

export function RocketHero({ showReadout = true, className }: { showReadout?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    return mountRocketDemo(ref.current, { showReadout });
  }, [showReadout]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
