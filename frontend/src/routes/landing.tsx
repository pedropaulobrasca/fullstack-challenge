import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Rocket, ShieldCheck, Lock, TrendingUp, ExternalLink } from "lucide-react";
import { Topbar } from "@/components/site/Topbar";
import { RocketHero } from "@/components/site/RocketHero";
import "@/styles/crash-site.css";

/* Marketing landing, mounted at "/landing". The live game stays at "/" (it is
   auth-gated via enforceLogin and whitelisted for the Keycloak OIDC redirect). */
export const Route = createFileRoute("/landing")({ component: LandingPage });

const band = (x: number) => (x < 2 ? "low" : x <= 10 ? "mid" : "high");
const RECENT = [3.27, 1.08, 8.91, 2.15, 1.42, 5.6];

function LandingPage() {
  const [players, setPlayers] = useState(3418);
  useEffect(() => {
    const id = setInterval(() => setPlayers(3300 + Math.floor(Math.random() * 260)), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <Topbar right={<>
        <Link to="/login" className="btn btn-ghost btn-sm">Log in</Link>
        <Link to="/login" className="btn btn-primary btn-sm">Sign up</Link>
      </>} />

      <main>
        <section className="hero wrap">
          <div className="hero-copy">
            <span className="pill" style={{ marginBottom: 22 }}>
              <span className="dot pulse" style={{ background: "var(--accent)" }} />Provably fair · 100% verifiable
            </span>
            <h1 className="h-hero">Watch it climb.<br /><span className="text-accent">Cash out</span> in time.</h1>
            <p className="lead" style={{ margin: "22px 0 30px", maxWidth: "30ch" }}>
              Bet, ride the multiplier as the rocket flies, and pull out before it crashes. Every round is
              cryptographically provable — no house tricks.
            </p>
            <div className="hero-cta">
              <Link to="/" className="btn btn-primary btn-lg"><Rocket size={18} />Play now</Link>
              <a href="#fair" className="btn btn-ghost btn-lg"><ShieldCheck size={18} />How it&apos;s fair</a>
            </div>
            <div className="trust">
              <div className="trust-item"><b className="mono">{players.toLocaleString("en-US")}</b><span>playing now</span></div>
              <div className="trust-sep" />
              <div className="trust-item"><b className="mono">2.1M</b><span>rounds played</span></div>
              <div className="trust-sep" />
              <div className="trust-item"><b className="mono">99%</b><span>RTP</span></div>
            </div>
          </div>

          <div className="hero-stage card">
            <div className="hs-top">
              <span className="hud-badge"><span className="dot pulse" style={{ background: "#ff5b5b" }} />LIVE</span>
              <span className="hud-round mono">Round #a1b2c3</span>
            </div>
            <div className="hs-canvas"><RocketHero /></div>
            <div className="hs-recent">
              <span className="hs-recent-label">Recent</span>
              <div className="hs-chips">
                {RECENT.map((c, i) => <span key={i} className={"hs-chip band-" + band(c)}>{c.toFixed(2)}x</span>)}
              </div>
            </div>
          </div>
        </section>

        <section className="wrap ticker-wrap">
          <div className="ticker card">
            <span className="ticker-label"><TrendingUp size={16} />Biggest wins today</span>
            <div className="ticker-row">
              {[["K7", "#22d3ee", "k7f2", "128.4x", "+64,200"], ["9B", "#a78bfa", "9b0e", "71.0x", "+35,500"],
                ["C1", "#f59e0b", "c12d", "44.8x", "+22,400"], ["A4", "#f472b6", "a44f", "31.2x", "+15,600"]].map((w, i) => (
                <div className="win" key={i}>
                  <span className="av" style={{ ["--c" as string]: w[1] }}>{w[0]}</span>
                  <span className="mono">{w[2]}</span><b className="mono">{w[3]}</b>
                  <span className="mono win-amt">{w[4]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="fair" className="section wrap">
          <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 56px" }}>
            <span className="eyebrow">Provably fair</span>
            <h2 className="h-sec" style={{ marginTop: 14 }}>You don&apos;t have to trust us.<br />You can check.</h2>
            <p className="lead" style={{ marginTop: 18 }}>
              Every crash point is committed before the round and revealed after — recomputable by anyone, in your browser.
            </p>
          </div>
          <div className="fair-grid">
            {[[Lock, "01", "Commit", "Before betting opens, the server publishes a SHA-256 hash of the secret seed. It can't change the outcome after you bet."],
              [Rocket, "02", "Play", "The rocket flies and the multiplier climbs. Cash out whenever — or ride it and risk the crash."],
              [ShieldCheck, "03", "Reveal", "The seed is revealed. The hash matches and the crash point recomputes exactly. Math, not promises."]].map((s, i) => {
              const Ic = s[0] as typeof Lock;
              return (
                <div className="card fair-step" key={i}>
                  <span className="step-n">{s[1] as string}</span>
                  <Ic className="step-ic" />
                  <h3>{s[2] as string}</h3>
                  <p>{s[3] as string}</p>
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <Link to="/fair" className="btn btn-ghost"><ExternalLink size={16} />Verify a round</Link>
          </div>
        </section>

        <section className="wrap">
          <div className="stats card">
            {[["48.2M", "CRD wagered today"], ["1.4s", "avg. payout time"], ["24/7", "rounds, never closes"], ["0%", "house edge tricks"]].map((s, i) => (
              <div className="stat" key={i}><b className="mono">{s[0]}</b><span>{s[1]}</span></div>
            ))}
          </div>
        </section>

        <section className="section wrap" style={{ textAlign: "center" }}>
          <h2 className="h-sec">Fuel up. The next rocket is boarding.</h2>
          <p className="lead" style={{ margin: "18px auto 30px", maxWidth: "46ch" }}>
            Start with 1,000 CRD on the house. No download, plays in your browser.
          </p>
          <Link to="/login" className="btn btn-primary btn-lg"><Rocket size={18} />Create free account</Link>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <p className="legal">CRD is a play-money credit with no cash value. Play responsibly — set limits and take breaks.</p>
        </div>
      </footer>
    </>
  );
}
