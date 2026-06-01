import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, ArrowDownToLine, CreditCard, Wallet, Building2 } from "lucide-react";
import { Topbar } from "@/components/site/Topbar";
import "@/styles/crash-site.css";
import "@/styles/app.css";
import "@/styles/crash-pages.css";

export const Route = createFileRoute("/wallet")({ component: WalletPage });

type Tx = { tag: "win" | "loss" | "dep"; label: string; detail: string; time: string; amt: string; bal: string };
const TXS: Tx[] = [
  { tag: "win", label: "WIN", detail: "Round #a1b2 · 4.21x", time: "14:02", amt: "+842.00", bal: "2,480.00" },
  { tag: "loss", label: "LOSS", detail: "Round #9f3c · crashed 1.08x", time: "13:58", amt: "−200.00", bal: "1,638.00" },
  { tag: "win", label: "WIN", detail: "Round #7d21 · 2.40x", time: "13:51", amt: "+360.00", bal: "1,838.00" },
  { tag: "dep", label: "DEPOSIT", detail: "Visa ···· 4291", time: "13:30", amt: "+1,000.00", bal: "1,478.00" },
  { tag: "loss", label: "LOSS", detail: "Round #5c0a · crashed 1.42x", time: "13:22", amt: "−150.00", bal: "478.00" },
  { tag: "win", label: "WIN", detail: "Round #3b8e · 6.10x", time: "13:15", amt: "+610.00", bal: "628.00" },
];
const METHODS = [
  { icon: CreditCard, label: "Card", meta: "Visa ···· 4291" },
  { icon: Wallet, label: "Crypto", meta: "BTC · ETH · USDT" },
  { icon: Building2, label: "Bank transfer", meta: "1–2 days" },
];

function WalletPage() {
  const [method, setMethod] = useState(0);
  const [amount, setAmount] = useState("1,000.00");
  return (
    <>
      <Topbar active="wallet" right={
        <span className="pill balance-pill"><span className="dot" style={{ background: "var(--accent)" }} />2,480.00 CRD</span>
      } />
      <div className="page-wrap">
        <div className="page-head"><div><div className="page-title">Wallet</div>
          <div className="page-sub">Manage your CRD balance and review every transaction.</div></div></div>

        <div className="wallet-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card bal-hero">
              <span className="k">Available balance</span>
              <span className="v">2,480.00 <small>CRD</small></span>
              <div className="bal-actions">
                <button className="btn btn-primary"><Plus size={16} />Deposit</button>
                <button className="btn btn-ghost"><ArrowDownToLine size={16} />Withdraw</button>
              </div>
              <div className="bal-mini">
                <div><span>In play</span><b>0.00</b></div>
                <div><span>Deposited</span><b>5,000.00</b></div>
                <div><span>Lifetime won</span><b className="text-accent">12,840.00</b></div>
              </div>
            </div>

            <div className="card" style={{ padding: 0 }}>
              <div className="seg-wrap"><h3 style={{ fontSize: 16, fontWeight: 600 }}>Transactions</h3></div>
              <table className="tbl">
                <thead><tr><th>Type</th><th>Detail</th><th>Date</th>
                  <th style={{ textAlign: "right" }}>Amount</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
                <tbody>
                  {TXS.map((t, i) => (
                    <tr key={i}>
                      <td><span className={"tag tag-" + (t.tag === "dep" ? "dep" : t.tag)}>{t.label}</span></td>
                      <td className="mono">{t.detail}</td><td>{t.time}</td>
                      <td className={"mono " + (t.amt.startsWith("+") ? "pos" : "neg")} style={{ textAlign: "right" }}>{t.amt}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{t.bal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card panel">
            <h3>Deposit</h3>
            <div className="field"><label>Amount</label>
              <div className="input-group"><input className="input mono" value={amount} onChange={(e) => setAmount(e.target.value)} /><span className="suffix">CRD</span></div>
            </div>
            <div className="chip-row">
              {["100", "500", "1,000", "5,000"].map((q) => (
                <button key={q} className="chip-btn" data-on={amount === q + ".00" || amount === q} onClick={() => setAmount(q)}>{q}</button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {METHODS.map((m, i) => {
                const Ic = m.icon;
                return (
                  <div key={i} className="method" data-on={method === i} onClick={() => setMethod(i)}>
                    <Ic className="ic" /><span className="label">{m.label}</span><span className="meta">{m.meta}</span>
                  </div>
                );
              })}
            </div>
            <button className="btn btn-primary btn-block btn-lg"><Plus size={18} />Deposit {amount} CRD</button>
            <p className="fine" style={{ textAlign: "center", margin: 0 }}>Demo only — no real funds move.</p>
          </div>
        </div>
      </div>
    </>
  );
}
