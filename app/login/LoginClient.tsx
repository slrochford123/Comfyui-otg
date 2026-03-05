"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}

type MeResponse = { ok: boolean; user?: { email: string; username?: string | null } };

export default function LoginClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextPath = useMemo(() => sp.get("next") || "/app", [sp]);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already signed in, go straight to app
  useEffect(() => {
    (async () => {
      const r = await fetch("/api/whoami", { credentials: "include", cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as MeResponse;
      if (r.ok && j?.ok) router.replace(nextPath);
    })();
  }, [router, nextPath]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-otg-device-id": getDeviceId() ?? "desktop_default",
        },
        credentials: "include",
        body: JSON.stringify({ identifier, password, remember }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setError(j?.error || "Login failed.");
        return;
      }

      router.replace(nextPath);
    } catch (e: any) {
      setError(e?.message || "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />

      <section className="otg-authCard2 otg-authCardHero">
        {/* HERO HEADER (inside the card) */}
        <div className="otg-authHero" aria-hidden="true">
          {/* Use your banner image in /public */}
          <img
            src="/login-hero.png"
            alt=""
            className="otg-authHeroImg"
            draggable={false}
          />
          <div className="otg-authHeroOverlay" />
        </div>

        {/* FORM */}
        <form className="otg-authForm otg-authFormTight" onSubmit={onSubmit}>
          <label className="otg-authLabel">
            Email
            <input
              className="otg-authInput"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@domain.com or username"
              autoComplete="username"
              required
            />
          </label>

          <label className="otg-authLabel">
            Password
            <div className="otg-authPwRow">
              <input
                className="otg-authInput"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="otg-authShowBtn"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label className="otg-authRemember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember me</span>
          </label>

          {error ? <div className="otg-authErr">{error}</div> : null}

          <button
            className="otg-authPrimaryBtn otg-authGradientBtn"
            type="submit"
            disabled={submitting}
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>

          <div className="otg-authLinks">
            <Link href="/signup" className="otg-authLink">
              Create account
            </Link>
            <span className="otg-sepDot">|</span>
            <Link href="/forgot" className="otg-authLink">
              Forgot password
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
