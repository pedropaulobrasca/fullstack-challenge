import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Rocket, KeyRound, Gift, ShieldCheck, Zap } from "lucide-react";
import { RocketHero } from "@/components/site/RocketHero";
import "@/styles/crash-site.css";
import "@/styles/auth.css";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const signup = tab === "signup";
  const navigate = useNavigate();
  const startKeycloakLogin = () => navigate({ to: "/" });
  return (
    <div className="auth">
      <aside className="auth-art">
        <RocketHero className="auth-art-canvas" />
        <div className="layer"><Link to="/" className="wordmark" style={{ fontSize: 20 }}><span className="bolt" />CRASH</Link></div>
        <div className="layer art-props">
          <h2 className="h-sec" style={{ fontSize: 30, marginBottom: 6 }}>Your seat on the next rocket.</h2>
          <Prop icon={<Gift className="ic" />} h="1,000 CRD on the house" p="Start playing instantly — no deposit needed." />
          <Prop icon={<ShieldCheck className="ic" />} h="Provably fair, always" p="Verify every crash point yourself, in your browser." />
          <Prop icon={<Zap className="ic" />} h="Instant cash-outs" p="Pull your winnings the moment you tap. ~1.4s average." />
        </div>
      </aside>

      <main className="auth-form">
        <div className="auth-card">
          <Link to="/" className="btn btn-quiet btn-sm" style={{ alignSelf: "flex-start", paddingLeft: 0 }}><ArrowLeft size={16} />Back home</Link>
          <div className="seg">
            <button data-on={!signup} onClick={() => setTab("login")}>Log in</button>
            <button data-on={signup} onClick={() => setTab("signup")}>Sign up</button>
          </div>
          <div>
            <h1 className="auth-title">{signup ? "Create your account" : "Welcome back"}</h1>
            <p className="auth-sub">{signup ? "1,000 CRD waiting on the other side." : "Log in to keep climbing."}</p>
          </div>
          <button type="button" className="sso" onClick={startKeycloakLogin}><KeyRound size={18} />Continue with Keycloak SSO</button>
          <div className="divider-or">or with email</div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" placeholder="you@email.com" /></div>
          {signup && <div className="field"><label htmlFor="username">Username</label><input id="username" className="input mono" placeholder="rocket_rider" /></div>}
          <div className="field">
            <div className="field-row"><label htmlFor="password">Password</label>{!signup && <a href="#">Forgot?</a>}</div>
            <input id="password" className="input" type="password" placeholder="••••••••" />
          </div>
          <Link to="/" className="btn btn-primary btn-block btn-lg"><Rocket size={18} />{signup ? "Create account" : "Log in & play"}</Link>
          <p className="fine">By continuing you agree to our <a href="#">Terms</a> and confirm you&apos;re 18+. CRD has no cash value.</p>
        </div>
      </main>
    </div>
  );
}

function Prop({ icon, h, p }: { icon: React.ReactNode; h: string; p: string }) {
  return <div className="art-prop">{icon}<div><h4>{h}</h4><p>{p}</p></div></div>;
}
