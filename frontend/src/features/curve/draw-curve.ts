import type { RoundStatus } from "@/stores/round.store";

/* ============================================================================
   draw-curve.ts — Aviator-style crash scene (drop-in replacement)

   Same entry point as before: `drawCurve(ctx, args)`. The difference is it now
   takes a persistent `scene` object (particles + starfield) and a `time` value
   so it can animate a flying rocket, an exhaust spark trail, a speed-streaked
   starfield, and a crash explosion across frames. The function is still the
   single source of truth for what one frame looks like — the component just
   owns the mutable scene + drives a continuous rAF (see crash-curve.tsx).

   All motion is gated behind `!reducedMotion`.
   ============================================================================ */

const RISING_START = "#00FF85";
const CRASH_RED = "#EF4444";
const TEXT_FONT_DESKTOP_PX = 80;
const TEXT_FONT_MOBILE_PX = 48;
const MOBILE_MAX_WIDTH = 768;
const CURVE_LINE_WIDTH = 5;
const CURVE_MAX_MULTIPLIER = 10;
const CURVE_SAMPLES = 84;
const MARGIN_X_RATIO = 0.09;
const BASE_Y_RATIO = 0.84;
const USABLE_H_RATIO = 0.62;
const MAX_PARTICLES = 220;
const STAR_COUNT = 110;

export type CurveParticle = {
  x: number; y: number; vx: number; vy: number; life: number; r: number; col: string;
};
export type CurveStar = { x: number; y: number; s: number; tw: number };

export type CurveScene = {
  particles: CurveParticle[];
  stars: CurveStar[];
  lastTime: number;
  lastStatus: RoundStatus | null;
  t: number;
};

export function createCurveScene(): CurveScene {
  return { particles: [], stars: [], lastTime: 0, lastStatus: null, t: 0 };
}

export type DrawCurveArgs = {
  width: number;
  height: number;
  dpr: number;
  multiplier: number;
  status: RoundStatus;
  crashValue: number | null;
  reducedMotion: boolean;
  scene: CurveScene;
  time: number; // performance.now()
};

function fontPxForWidth(width: number): number {
  return width < MOBILE_MAX_WIDTH ? TEXT_FONT_MOBILE_PX : TEXT_FONT_DESKTOP_PX;
}
function curveProgress(multiplier: number): number {
  const clamped = Math.min(Math.max(multiplier, 1), CURVE_MAX_MULTIPLIER);
  return (clamped - 1) / (CURVE_MAX_MULTIPLIER - 1);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
// neon-green (#00ff85) → cyan (#22d3ee) as the multiplier climbs
function curveColor(prog: number): [number, number, number] {
  return [
    Math.round(lerp(0, 34, prog)),
    Math.round(lerp(255, 211, prog)),
    Math.round(lerp(133, 238, prog)),
  ];
}

function drawStars(
  ctx: CanvasRenderingContext2D, W: number, H: number, scene: CurveScene, speed: number,
): void {
  if (scene.stars.length === 0) {
    for (let i = 0; i < STAR_COUNT; i++) {
      scene.stars.push({ x: Math.random() * W, y: Math.random() * H, s: 0.4 + Math.random() * 1.7, tw: Math.random() * 6 });
    }
  }
  for (const star of scene.stars) {
    const v = speed * (0.4 + star.s * 0.5);
    star.y += v;
    if (star.y > H + 4) { star.y = -4; star.x = Math.random() * W; }
    const streak = Math.min(v * 0.9, 26);
    const a = 0.25 + Math.abs(Math.sin(star.tw + scene.t * 1.2)) * 0.45;
    ctx.strokeStyle = `rgba(210,235,255,${a})`;
    ctx.lineWidth = star.s;
    ctx.beginPath(); ctx.moveTo(star.x, star.y); ctx.lineTo(star.x, star.y - streak); ctx.stroke();
  }
}

function drawRocket(
  ctx: CanvasRenderingContext2D, x: number, y: number, angle: number,
  rgb: [number, number, number], time: number, animate: boolean,
): void {
  const [cr, cg, cb] = rgb;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // flame
  const flick = animate ? 0.75 + Math.sin(time * 0.045) * 0.2 + Math.random() * 0.18 : 0.9;
  const flen = 30 * flick;
  const fg = ctx.createLinearGradient(-11, 0, -11 - flen, 0);
  fg.addColorStop(0, "rgba(255,255,255,0.95)");
  fg.addColorStop(0.25, "rgba(255,214,90,0.95)");
  fg.addColorStop(0.6, "rgba(255,122,24,0.85)");
  fg.addColorStop(1, "rgba(255,52,0,0)");
  ctx.shadowColor = "rgba(255,140,30,0.8)"; ctx.shadowBlur = 18;
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(-10, -6); ctx.quadraticCurveTo(-11 - flen * 0.5, -3.5, -11 - flen, 0);
  ctx.quadraticCurveTo(-11 - flen * 0.5, 3.5, -10, 6); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.moveTo(-10, -3); ctx.quadraticCurveTo(-11 - flen * 0.45, 0, -10, 3); ctx.closePath(); ctx.fill();
  // body
  ctx.shadowColor = `rgba(${cr},${cg},${cb},0.7)`; ctx.shadowBlur = 16;
  ctx.fillStyle = "#eef7f1";
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.quadraticCurveTo(11, -9, -5, -8);
  ctx.lineTo(-10, -6); ctx.lineTo(-10, 6); ctx.lineTo(-5, 8);
  ctx.quadraticCurveTo(11, 9, 20, 0); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  // fins
  ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
  ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(-15, -15); ctx.lineTo(-6, -4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-5, 7); ctx.lineTo(-15, 15); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
  // nose accent + window
  ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
  ctx.beginPath(); ctx.moveTo(20, 0); ctx.quadraticCurveTo(13, -5, 8, -4.5); ctx.lineTo(8, 4.5); ctx.quadraticCurveTo(13, 5, 20, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#0a1a14"; ctx.beginPath(); ctx.arc(1, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`; ctx.beginPath(); ctx.arc(1, 0, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function drawCurve(
  ctx: CanvasRenderingContext2D,
  { width, height, dpr, multiplier, status, crashValue, reducedMotion, scene, time }: DrawCurveArgs,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const motion = !reducedMotion;
  const crashed = status === "CRASHED";
  const running = status === "RUNNING";
  const betting = status === "BETTING";
  const displayValue = crashed && crashValue !== null ? crashValue : multiplier;
  const prog = curveProgress(displayValue);
  const [cr, cg, cb] = crashed ? [239, 68, 68] : curveColor(prog);

  const dt = scene.lastTime ? Math.min((time - scene.lastTime) / 1000, 0.05) : 0.016;
  scene.lastTime = time;
  scene.t += dt;

  // ---- crash explosion (spawn once on entering CRASHED) ----
  const baseX = width * MARGIN_X_RATIO;
  const baseY = height * BASE_Y_RATIO;
  const usableWidth = width - baseX * 2;
  const usableHeight = height * USABLE_H_RATIO;
  const pt = (s: number): [number, number] => [
    baseX + s * usableWidth,
    baseY - Math.pow(s, 1.42) * usableHeight * prog,
  ];
  if (crashed && scene.lastStatus !== "CRASHED" && motion) {
    const [hx, hy] = pt(1);
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 280;
      const warm = Math.random() > 0.4;
      scene.particles.push({
        x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 1, r: 1.5 + Math.random() * 3,
        col: warm ? `255,${(110 + Math.random() * 90) | 0},30` : "239,68,68",
      });
    }
  }
  scene.lastStatus = status;

  // ---- ambient glow ----
  const cx = width * 0.5, cy = height * 0.86;
  const amb = betting ? 0.2 : Math.min(1.2, 0.4 + prog * 1.1);
  const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.95);
  rg.addColorStop(0, `rgba(${cr},${cg},${cb},${0.22 * amb})`);
  rg.addColorStop(0.45, `rgba(${cr},${cg},${cb},${0.06 * amb})`);
  rg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rg; ctx.fillRect(0, 0, width, height);

  // ---- starfield (speed scales with multiplier) ----
  if (motion) drawStars(ctx, width, height, scene, betting ? 0.5 : 1.2 + prog * 7);

  if (betting) {
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = "rgba(148,163,184,0.4)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(baseX + usableWidth, baseY); ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const [hx, hy] = pt(1);
    // area fill
    ctx.beginPath(); ctx.moveTo(baseX, baseY);
    for (let i = 0; i <= CURVE_SAMPLES; i++) { const [x, y] = pt(i / CURVE_SAMPLES); ctx.lineTo(x, y); }
    ctx.lineTo(hx, baseY); ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, baseY - usableHeight, 0, baseY);
    fillGrad.addColorStop(0, `rgba(${cr},${cg},${cb},0.34)`);
    fillGrad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = fillGrad; ctx.fill();
    // stroke
    ctx.beginPath(); ctx.moveTo(baseX, baseY);
    for (let i = 0; i <= CURVE_SAMPLES; i++) { const [x, y] = pt(i / CURVE_SAMPLES); ctx.lineTo(x, y); }
    const strokeGrad = ctx.createLinearGradient(baseX, baseY, hx, hy);
    strokeGrad.addColorStop(0, "rgba(0,255,133,0.95)");
    strokeGrad.addColorStop(1, `rgba(${cr},${cg},${cb},1)`);
    ctx.strokeStyle = crashed ? CRASH_RED : strokeGrad;
    ctx.lineWidth = CURVE_LINE_WIDTH; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowColor = `rgba(${cr},${cg},${cb},0.9)`;
    ctx.shadowBlur = crashed ? 5 : 18 + prog * 26;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // rocket head + spark emission
    if (running) {
      const [x0, y0] = pt(0.975);
      const angle = Math.atan2(hy - y0, hx - x0);
      if (motion) {
        for (let k = 0; k < 3; k++) {
          const warm = Math.random() > 0.45;
          scene.particles.push({
            x: hx - Math.cos(angle) * 10, y: hy - Math.sin(angle) * 10,
            vx: -Math.cos(angle) * (60 + Math.random() * 90) + (Math.random() - 0.5) * 40,
            vy: -Math.sin(angle) * (60 + Math.random() * 90) + 30 + Math.random() * 60,
            life: 1, r: 1.4 + Math.random() * 2.4,
            col: warm ? `255,${(150 + Math.random() * 80) | 0},40` : `${cr},${cg},${cb}`,
          });
        }
        if (scene.particles.length > MAX_PARTICLES) {
          scene.particles.splice(0, scene.particles.length - MAX_PARTICLES);
        }
      }
      drawRocket(ctx, hx, hy, angle, [cr, cg, cb], time, motion);
    }
  }

  // ---- particles ----
  if (motion) {
    for (const p of scene.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 80 * dt; p.life -= dt * 1.15;
    }
    scene.particles = scene.particles.filter((p) => p.life > 0);
    for (const p of scene.particles) {
      ctx.globalAlpha = Math.max(0, p.life) * 0.85;
      ctx.fillStyle = `rgb(${p.col})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- multiplier readout ----
  const px = fontPxForWidth(width);
  ctx.font = `600 ${px}px 'Fira Code', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (betting) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = `600 ${px * 0.42}px 'Fira Sans', sans-serif`;
    ctx.fillText("Place your bets…", width / 2, height / 2);
  } else {
    ctx.save();
    ctx.shadowColor = `rgba(${cr},${cg},${cb},0.55)`;
    ctx.shadowBlur = motion ? 26 + prog * 50 : 0;
    ctx.fillStyle = crashed ? CRASH_RED : RISING_START;
    ctx.fillText(`${displayValue.toFixed(2)}x`, width / 2, height / 2);
    ctx.restore();
  }
}
