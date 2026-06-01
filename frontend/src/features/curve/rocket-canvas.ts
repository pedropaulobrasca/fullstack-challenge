/* rocket-canvas.ts — typed, framework-agnostic Crash rocket scene + demo driver.
   Mount the looping demo into any <canvas> (marketing/auth surfaces):
     const stop = mountRocketDemo(canvasEl, { showReadout: true });
   Returns a cleanup fn. For the in-game live curve, use draw-curve.ts instead.

   NOTE: @ts-nocheck — this is a self-contained imperative canvas renderer; the
   internals lean on loose params on purpose. The exported signatures below are
   typed. If you prefer full strictness, the only public surface is
   mountRocketDemo / render / curveColor. */
// @ts-nocheck
export type RoundPhase = "BETTING" | "RUNNING" | "CRASHED";
export type DemoTick = { status: RoundPhase; multiplier: number; crash: number | null; secondsLeft: number; roundId: string };
export type DemoOptions = { showReadout?: boolean; onTick?: (p: DemoTick) => void };

  const CURVE_MAX = 10;
  const clampProg = (m) => { const c = Math.min(Math.max(m, 1), CURVE_MAX); return (c - 1) / (CURVE_MAX - 1); };
  const lerp = (a, b, t) => a + (b - a) * t;
  export const curveColor = (p: number): [number, number, number] => [Math.round(lerp(0, 34, p)), Math.round(lerp(255, 211, p)), Math.round(lerp(133, 238, p))];

  function drawRocket(ctx, x, y, angle, rgb, time) {
    const [cr, cg, cb] = rgb;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    const flick = 0.75 + Math.sin(time * 0.045) * 0.2 + Math.random() * 0.18;
    const flen = 30 * flick;
    const fg = ctx.createLinearGradient(-11, 0, -11 - flen, 0);
    fg.addColorStop(0, "rgba(255,255,255,0.95)"); fg.addColorStop(0.25, "rgba(255,214,90,0.95)");
    fg.addColorStop(0.6, "rgba(255,122,24,0.85)"); fg.addColorStop(1, "rgba(255,52,0,0)");
    ctx.shadowColor = "rgba(255,140,30,0.8)"; ctx.shadowBlur = 18; ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(-10, -6); ctx.quadraticCurveTo(-11 - flen * 0.5, -3.5, -11 - flen, 0);
    ctx.quadraticCurveTo(-11 - flen * 0.5, 3.5, -10, 6); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.moveTo(-10, -3);
    ctx.quadraticCurveTo(-11 - flen * 0.45, 0, -10, 3); ctx.closePath(); ctx.fill();
    ctx.shadowColor = `rgba(${cr},${cg},${cb},0.7)`; ctx.shadowBlur = 16; ctx.fillStyle = "#eef7f1";
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.quadraticCurveTo(11, -9, -5, -8); ctx.lineTo(-10, -6);
    ctx.lineTo(-10, 6); ctx.lineTo(-5, 8); ctx.quadraticCurveTo(11, 9, 20, 0); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.beginPath(); ctx.moveTo(-5, -7); ctx.lineTo(-15, -15); ctx.lineTo(-6, -4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-5, 7); ctx.lineTo(-15, 15); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.quadraticCurveTo(13, -5, 8, -4.5); ctx.lineTo(8, 4.5); ctx.quadraticCurveTo(13, 5, 20, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#0a1a14"; ctx.beginPath(); ctx.arc(1, 0, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`; ctx.beginPath(); ctx.arc(1, 0, 2, 0, 7); ctx.fill();
    ctx.restore();
  }

  export function render(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, p: any, st: any) {
    ctx.clearRect(0, 0, W, H);
    const crashed = p.status === "CRASHED", running = p.status === "RUNNING", betting = p.status === "BETTING";
    const m = (crashed && p.crash != null) ? p.crash : p.multiplier;
    const prog = clampProg(m);
    const [cr, cg, cb] = crashed ? [239, 68, 68] : curveColor(prog);
    const dt = st.lastT ? Math.min((t - st.lastT) / 1000, 0.05) : 0.016; st.lastT = t; st.t += dt;

    const mX = W * 0.09, baseY = H * 0.84, usableW = W - mX * 2, usableH = H * 0.62;
    const pt = (s) => [mX + s * usableW, baseY - Math.pow(s, 1.42) * usableH * prog];

    if (crashed && st.lastStatus !== "CRASHED") {
      const [hx, hy] = pt(1);
      for (let i = 0; i < 55; i++) { const a = Math.random() * 7, sp = 60 + Math.random() * 260, warm = Math.random() > 0.4;
        st.particles.push({ x: hx, y: hy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 1, r: 1.4 + Math.random() * 3, col: warm ? `255,${110 + Math.random() * 90 | 0},30` : "239,68,68" }); }
    }
    st.lastStatus = p.status;

    const cx = W * 0.5, cy = H * 0.86, amb = betting ? 0.2 : Math.min(1.2, 0.4 + prog * 1.1);
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.95);
    rg.addColorStop(0, `rgba(${cr},${cg},${cb},${0.22 * amb})`); rg.addColorStop(0.45, `rgba(${cr},${cg},${cb},${0.06 * amb})`); rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    if (!st.stars.length) for (let i = 0; i < 90; i++) st.stars.push({ x: Math.random() * W, y: Math.random() * H, s: 0.4 + Math.random() * 1.6, tw: Math.random() * 6 });
    const speed = betting ? 0.5 : 1.2 + prog * 7;
    for (const s of st.stars) { const v = speed * (0.4 + s.s * 0.5); s.y += v; if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
      const a = 0.25 + Math.abs(Math.sin(s.tw + st.t * 1.2)) * 0.45; ctx.strokeStyle = `rgba(210,235,255,${a})`; ctx.lineWidth = s.s;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - Math.min(v * 0.9, 24)); ctx.stroke(); }

    if (betting) {
      ctx.setLineDash([7, 7]); ctx.strokeStyle = "rgba(148,163,184,0.4)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mX, baseY); ctx.lineTo(mX + usableW, baseY); ctx.stroke(); ctx.setLineDash([]);
    } else {
      const [hx, hy] = pt(1);
      ctx.beginPath(); ctx.moveTo(mX, baseY); for (let i = 0; i <= 84; i++) { const [x, y] = pt(i / 84); ctx.lineTo(x, y); } ctx.lineTo(hx, baseY); ctx.closePath();
      const fgr = ctx.createLinearGradient(0, baseY - usableH, 0, baseY); fgr.addColorStop(0, `rgba(${cr},${cg},${cb},0.34)`); fgr.addColorStop(1, `rgba(${cr},${cg},${cb},0)`); ctx.fillStyle = fgr; ctx.fill();
      ctx.beginPath(); ctx.moveTo(mX, baseY); for (let i = 0; i <= 84; i++) { const [x, y] = pt(i / 84); ctx.lineTo(x, y); }
      const sgr = ctx.createLinearGradient(mX, baseY, hx, hy); sgr.addColorStop(0, "rgba(0,255,133,0.95)"); sgr.addColorStop(1, `rgba(${cr},${cg},${cb},1)`);
      ctx.strokeStyle = crashed ? "#ef4444" : sgr; ctx.lineWidth = 5; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.shadowColor = `rgba(${cr},${cg},${cb},0.9)`; ctx.shadowBlur = crashed ? 5 : 18 + prog * 26; ctx.stroke(); ctx.shadowBlur = 0;
      if (running) { const [x0, y0] = pt(0.975), angle = Math.atan2(hy - y0, hx - x0);
        for (let k = 0; k < 3; k++) { const warm = Math.random() > 0.45;
          st.particles.push({ x: hx - Math.cos(angle) * 10, y: hy - Math.sin(angle) * 10, vx: -Math.cos(angle) * (60 + Math.random() * 90) + (Math.random() - 0.5) * 40, vy: -Math.sin(angle) * (60 + Math.random() * 90) + 30 + Math.random() * 60, life: 1, r: 1.4 + Math.random() * 2.4, col: warm ? `255,${150 + Math.random() * 80 | 0},40` : `${cr},${cg},${cb}` }); }
        if (st.particles.length > 200) st.particles.splice(0, st.particles.length - 200);
        drawRocket(ctx, hx, hy, angle, [cr, cg, cb], t); }
    }

    for (const pa of st.particles) { pa.x += pa.vx * dt; pa.y += pa.vy * dt; pa.vy += 80 * dt; pa.life -= dt * 1.15; }
    st.particles = st.particles.filter((pa) => pa.life > 0);
    for (const pa of st.particles) { ctx.globalAlpha = Math.max(0, pa.life) * 0.85; ctx.fillStyle = `rgb(${pa.col})`; ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.r, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;

    // readout (canvas) — optional, only when asked
    if (st.showReadout) {
      const px = Math.max(28, W * 0.11);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (betting) { ctx.fillStyle = "#94a3b8"; ctx.font = `600 ${px * 0.4}px 'Fira Sans', sans-serif`; ctx.fillText(`Launching in ${Math.ceil(p.secondsLeft)}s`, W / 2, H / 2); }
      else { ctx.save(); ctx.shadowColor = `rgba(${cr},${cg},${cb},0.55)`; ctx.shadowBlur = 24 + prog * 40; ctx.fillStyle = crashed ? "#ef4444" : "#00ff85";
        ctx.font = `600 ${px}px 'Fira Code', monospace`; ctx.fillText(`${m.toFixed(2)}x`, W / 2, H / 2); ctx.restore(); }
    }
  }

  // Demo driver: BETTING -> RUNNING -> CRASHED -> loop, with onTick callback.
  export function mountRocketDemo(canvas: HTMLCanvasElement, opts: DemoOptions = {}): () => void {
    const ctx = canvas.getContext("2d");
    const st = { particles: [], stars: [], lastT: 0, lastStatus: "", t: 0, showReadout: opts.showReadout !== false };
    let W = 0, H = 0, dpr = window.devicePixelRatio || 1;
    const resize = () => { const r = canvas.parentElement.getBoundingClientRect(); W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + "px"; canvas.style.height = H + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);

    const GROW_T = 4200;
    const pick = () => Math.max(1.05, Math.min(28, 0.95 / (1 - Math.random())));
    const g = { phase: "BETTING", start: performance.now(), crash: 0, roundId: rid(), m: 1 };
    function rid() { return Math.random().toString(16).slice(2, 8); }

    let raf;
    const loop = (t) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const el = t - g.start;
      let secondsLeft = 0;
      if (g.phase === "BETTING") { secondsLeft = Math.ceil((4000 - el) / 1000);
        if (el >= 4000) { g.phase = "RUNNING"; g.start = t; g.crash = pick(); g.m = 1; } }
      else if (g.phase === "RUNNING") { g.m = Math.exp((t - g.start) / GROW_T);
        if (g.m >= g.crash) { g.phase = "CRASHED"; g.start = t; g.m = g.crash; } }
      else if (g.phase === "CRASHED") { if (el >= 2200) { g.phase = "BETTING"; g.start = t; g.roundId = rid(); g.m = 1; } }
      const p = { status: g.phase, multiplier: g.m, crash: g.phase === "CRASHED" ? g.crash : null, secondsLeft, roundId: g.roundId };
      render(ctx, W, H, t, p, st);
      if (opts.onTick) opts.onTick(p);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }
