import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Calendar, Flame, ShieldCheck } from "lucide-react";
import { Topbar } from "@/components/site/Topbar";
import "@/styles/crash-site.css";
import "@/styles/app.css";
import "@/styles/crash-pages.css";

export const Route = createFileRoute("/profile")({ component: ProfilePage });

type Bet = { round: string; bet: string; cashout: string; crash: string; time: string; result: string; win: boolean };
const BETS: Bet[] = [
  { round: "#a1b2c3d4", bet: "200.00", cashout: "4.21x", crash: "8.90x", time: "14:02", result: "+642.00", win: true },
  { round: "#9f3c1a02", bet: "200.00", cashout: "—", crash: "1.08x", time: "13:58", result: "−200.00", win: false },
  { round: "#7d2188fe", bet: "150.00", cashout: "2.40x", crash: "3.66x", time: "13:51", result: "+210.00", win: true },
  { round: "#5c0a77b1", bet: "150.00", cashout: "—", crash: "1.42x", time: "13:22", result: "−150.00", win: false },
  { round: "#3b8e44a9", bet: "100.00", cashout: "6.10x", crash: "9.12x", time: "13:15", result: "+510.00", win: true },
  { round: "#1a0f9023", bet: "100.00", cashout: "1.90x", crash: "2.05x", time: "13:08", result: "+90.00", win: true },
];
const STATS = [["Net profit (30d)", "+7,840", true], ["Total wagered", "48,200", false], ["Biggest multiplier", "31.20x", false], ["Win rate", "58%", false]] as const;

function ProfilePage() {
  return (
    <>
      <Topbar active="profile" right={
        <span className="pill balance-pill"><span className="dot" style={{ background: "var(--accent)" }} />2,480.00 CRD</span>
      } />
      <div className="page-wrap">
        <div className="card prof-head">
          <span className="avatar-lg" style={{ ["--c" as string]: "#22d3ee" }}>YO</span>
          <div className="prof-id">
            <span className="name">you_3f9a</span>
            <div className="meta">
              <span><Calendar className="ic" />Joined Mar 2026</span>
              <span><Flame className="ic" />4-win streak</span>
              <span><ShieldCheck className="ic" />Verified player</span>
            </div>
          </div>
          <div className="rankbox"><div className="r">#12</div><div className="l">Daily leaderboard</div></div>
        </div>

        <div className="stats-grid">
          {STATS.map((s, i) => (
            <div className="card stat-card" key={i}><div className="k">{s[0]}</div>
              <div className={"v" + (s[2] ? " text-accent" : "")}>{s[1]}</div></div>
          ))}
        </div>

        <div className="card" style={{ padding: 0 }}>
          <div className="seg-wrap"><h3 style={{ fontSize: 16, fontWeight: 600 }}>Bet history</h3></div>
          <table className="tbl">
            <thead><tr><th>Round</th><th>Bet</th><th>Cashout</th><th>Crash</th><th>Time</th>
              <th style={{ textAlign: "right" }}>Result</th><th /></tr></thead>
            <tbody>
              {BETS.map((b, i) => (
                <tr key={i}>
                  <td className="mono">{b.round}</td><td className="mono">{b.bet}</td>
                  <td className={"mono" + (b.win ? " pos" : "")}>{b.cashout}</td>
                  <td className={"mono" + (!b.win ? " neg" : "")}>{b.crash}</td><td>{b.time}</td>
                  <td className={"mono " + (b.win ? "pos" : "neg")} style={{ textAlign: "right" }}>{b.result}</td>
                  <td style={{ textAlign: "right" }}>
                    <Link to="/fair" className="btn btn-quiet btn-sm" style={{ padding: "4px 8px" }}><ShieldCheck size={14} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
