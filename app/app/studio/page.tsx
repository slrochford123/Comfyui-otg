"use client";



function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id =
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "";

  if (!id) {
    id = "desktop_default";
    try { localStorage.setItem("otg_device_id", (id ?? "desktop_default")); } catch {}
    try { sessionStorage.setItem("otg_device_id", (id ?? "desktop_default")); } catch {}
  }
  return id;
}
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: (() => { const h = new Headers({ "Content-Type": "application/json" }); h.set("x-otg-device-id", (String((getDeviceId() ?? "desktop_default") ).trim() || "desktop_default")); return h; })(),
        body: JSON.stringify({ email, username, password: pw }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Signup failed.");
        return;
      }

      router.replace("/signup/success");
    } catch (e: any) {
      setError(e?.message || "Signup failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2">
        <div className="otg-authHeaderMini">CREATE ACCOUNT</div>

        <h1 className="otg-authTitle">
          Comfy<span style={{ color: "rgba(195,104,255,.95)" }}>UI</span> OTG
        </h1>
        <p className="otg-authSub">Create your account to start creating on the go.</p>

        <form className="otg-authForm" onSubmit={onSubmit}>
          <label className="otg-authLabel">
            Email
            <input
              className="otg-authInput"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="otg-authLabel">
            Create username
            <input
              className="otg-authInput"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="username"
              required
            />
          </label>

          <label className="otg-authLabel">
            Create password
            <div className="otg-authPwRow">
              <input
                className="otg-authInput"
                type={showPw ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Create a password"
                autoComplete="new-password"
                required
              />
              <button type="button" className="otg-authShowBtn" onClick={() => setShowPw((v) => !v)}>
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label className="otg-authLabel">
            Confirm password
            <div className="otg-authPwRow">
              <input
                className="otg-authInput"
                type={showPw2 ? "text" : "password"}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                placeholder="Confirm your password"
                autoComplete="new-password"
                required
              />
              <button type="button" className="otg-authShowBtn" onClick={() => setShowPw2((v) => !v)}>
                {showPw2 ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {error ? <div className="otg-authErr">{error}</div> : null}

          <button className="otg-authPrimaryBtn otg-authGradientBtn" type="submit" disabled={submitting}>
            {submitting ? "CreatingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" : "Create account"}
          </button>

          <div className="otg-authLinks" style={{ marginTop: 14 }}>
            <span style={{ color: "rgba(244,244,247,.65)" }}>Already have an account?</span>{" "}
            <Link href="/login" className="otg-authLink">
              Sign in
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}


