import type { RoundStatus } from "@/stores/round.store";

const RISING_START = "#00FF85";
const RISING_END = "#22D3EE";
const CRASH_RED = "#EF4444";
const GLOW_RISING = "rgba(0, 255, 133, 0.5)";
const GLOW_MAX_BLUR = 24;
const TEXT_FONT_DESKTOP_PX = 64;
const TEXT_FONT_MOBILE_PX = 44;
const MOBILE_MAX_WIDTH = 768;
const CURVE_LINE_WIDTH = 3;
const CURVE_MARGIN_RATIO = 0.12;
const CURVE_MAX_MULTIPLIER = 10;
const CURVE_SAMPLES = 64;

export type DrawCurveArgs = {
  width: number;
  height: number;
  dpr: number;
  multiplier: number;
  status: RoundStatus;
  crashValue: number | null;
  reducedMotion: boolean;
};

function fontPxForWidth(width: number): number {
  return width < MOBILE_MAX_WIDTH ? TEXT_FONT_MOBILE_PX : TEXT_FONT_DESKTOP_PX;
}

function curveProgress(multiplier: number): number {
  const clamped = Math.min(Math.max(multiplier, 1), CURVE_MAX_MULTIPLIER);
  return (clamped - 1) / (CURVE_MAX_MULTIPLIER - 1);
}

export function drawCurve(
  ctx: CanvasRenderingContext2D,
  { width, height, dpr, multiplier, status, crashValue, reducedMotion }: DrawCurveArgs,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const crashed = status === "CRASHED";
  const displayValue = crashed && crashValue !== null ? crashValue : multiplier;

  const marginX = width * CURVE_MARGIN_RATIO;
  const marginY = height * CURVE_MARGIN_RATIO;
  const baseX = marginX;
  const baseY = height - marginY;
  const usableWidth = width - marginX * 2;
  const usableHeight = height - marginY * 2;
  const progress = curveProgress(displayValue);

  const gradient = ctx.createLinearGradient(baseX, baseY, baseX + usableWidth, baseY - usableHeight);
  if (crashed) {
    gradient.addColorStop(0, CRASH_RED);
    gradient.addColorStop(1, CRASH_RED);
  } else {
    gradient.addColorStop(0, RISING_START);
    gradient.addColorStop(1, RISING_END);
  }

  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const s = i / CURVE_SAMPLES;
    const x = baseX + s * usableWidth;
    const y = baseY - Math.pow(s, 1.4) * usableHeight * progress;
    ctx.lineTo(x, y);
  }

  ctx.lineWidth = CURVE_LINE_WIDTH;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = gradient;

  if (crashed) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  } else {
    ctx.shadowColor = GLOW_RISING;
    ctx.shadowBlur = reducedMotion ? 0 : Math.min(GLOW_MAX_BLUR, GLOW_MAX_BLUR * progress);
  }
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  const px = fontPxForWidth(width);
  ctx.font = `600 ${px}px 'Fira Code', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = crashed ? CRASH_RED : RISING_START;
  ctx.fillText(`${displayValue.toFixed(2)}x`, width / 2, height / 2);
}
