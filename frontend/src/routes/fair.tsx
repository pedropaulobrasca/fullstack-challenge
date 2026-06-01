import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Copy, Check, Lock, Rocket, ShieldCheck } from "lucide-react";
import { Topbar } from "@/components/site/Topbar";
import "@/styles/crash-site.css";
import "@/styles/app.css";
import "@/styles/crash-pages.css";

/* Static "Provably Fair" showcase. To wire your real /verify/$roundId route,
   keep your useRecomputeCrashpoint hook and feed its values into this markup. */
export const Route = createFileRoute("/fair")({ component: FairPage });

function Hash({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="hashbox">
      <code>{value}</code>
      <button aria-label="copy" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
        {copied ? <Check size={15} color="var(--accent)" /> : <Copy size={15} />}
      </button>
    </div>
  );
}

function FairPage() {
  return (
    <>
      <Topbar active="fair" right={
        <Link to="/" className="btn btn-ghost btn-sm"><ArrowLeft size={15} />Live game</Link>
      } />
      <div className="page-wrap verify-wrap">
        <div className="page-head"><div>
          <div className="page-title mono">Verifying Round #a1b2c3d4</div>
          <div className="page-sub">Recomputed in your browser — nothing trusted, everything checked.</div>
        </div></div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="verdict">
            <span className="vic"><CheckCircle2 size={24} /></span>
            <div><h3>MATCH</h3><p>Computed crash point equals the value reported by the server. This round was fair.</p></div>
          </div>

          <div className="card vcard">
            <div className="vhead"><h3>Inputs</h3><span className="badge">from server</span></div>
            <div className="vbody">
              <div className="kv"><span className="k">server seed</span><Hash value="4a7d2f9c8e1b6035a9f4c2d7e8b1306f5c2a9d4e7b8f1c603a1b2c3d4e5f60718" /></div>
              <div className="kv"><span className="k">client seed</span><Hash value="player-entropy-9f3c1a02" /></div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div className="kv" style={{ flex: 1, minWidth: 120 }}><span className="k">nonce</span><code className="bigval" style={{ fontSize: 15, fontWeight: 600 }}>42</code></div>
                <div className="kv" style={{ flex: 2, minWidth: 200 }}><span className="k">formula</span><code className="bigval" style={{ fontSize: 13, fontWeight: 600 }}>bustabit-52bit-instant-101</code></div>
              </div>
            </div>
          </div>

          <div className="card vcard">
            <div className="vhead"><h3>Computed in your browser</h3><span className="badge">HMAC-SHA-256(seed, client:nonce)</span></div>
            <div className="vbody">
              <div className="kv"><span className="k">computed HMAC</span><Hash value="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" /></div>
              <div className="kv"><span className="k">52-bit slice (first 13 hex)</span><code className="bigval" style={{ fontSize: 15, fontWeight: 600 }}>0x9f86d081884c7</code></div>
              <div className="kv"><span className="k">computed crash point</span><span className="bigval text-accent">8.90x</span></div>
            </div>
          </div>

          <div className="card vcard">
            <div className="vhead"><h3>Reported by server</h3><span className="badge">on-chain record</span></div>
            <div className="vbody"><span className="bigval">8.90x</span></div>
          </div>

          <section style={{ marginTop: 14 }}>
            <h2 className="h-sec" style={{ fontSize: 22, marginBottom: 14 }}>How this works</h2>
            <div className="explain">
              <div className="estep"><Lock className="ic" /><h4>1 · Commit</h4><p>Server publishes a hash of the secret seed before bets open.</p></div>
              <div className="estep"><Rocket className="ic" /><h4>2 · Play</h4><p>The round runs; the outcome is already locked by the commitment.</p></div>
              <div className="estep"><ShieldCheck className="ic" /><h4>3 · Reveal</h4><p>Seed is revealed; the HMAC recomputes to the exact crash point.</p></div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
