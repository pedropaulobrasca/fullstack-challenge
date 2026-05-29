import confetti from "canvas-confetti";
import { prefersReducedMotion } from "@/features/juice/use-reduced-motion";

const EMERALD = "#00ff85";
const CYAN = "#22d3ee";

const PARTICLE_COUNT = 40;
const SPREAD = 70;

export function celebrate(): void {
  if (prefersReducedMotion()) {
    return;
  }
  confetti({
    particleCount: PARTICLE_COUNT,
    spread: SPREAD,
    colors: [EMERALD, CYAN],
    origin: { y: 0.6 },
    disableForReducedMotion: true,
  });
}
