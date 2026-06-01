import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/* Topbar — shared site nav. The live game lives at "/" (auth-gated), so the
   "Play" link points there; the marketing landing lives at "/landing". */

type Active = "play" | "wallet" | "profile" | "fair" | null;

const LINKS: { to: string; label: string; key: Active }[] = [
  { to: "/", label: "Play", key: "play" },
  { to: "/wallet", label: "Wallet", key: "wallet" },
  { to: "/profile", label: "Profile", key: "profile" },
  { to: "/fair", label: "Provably Fair", key: "fair" },
];

export function Topbar({ active = null, right }: { active?: Active; right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="tb-left">
        <Link to="/landing" className="wordmark"><span className="bolt" />CRASH</Link>
        <nav className="nav">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} aria-current={active === l.key ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="tb-right">{right}</div>
    </header>
  );
}
