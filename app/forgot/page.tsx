"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2">
        <div className="otg-authHeaderMini">RESET PASSWORD</div>

        <h1 className="otg-authTitle">Reset your password</h1>
        <p className="otg-authSub">We&apos;ll email you a reset link.</p>

        <form
          className="otg-authForm"
          onSubmit={(e) => {
            e.preventDefault();
            // UI-only for now (API hookup can come later)
            setSent(true);
          }}
        >
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

          {sent ? (
            <div className="otg-authNotice">If that email exists, we&apos;ll send a reset link.</div>
          ) : null}

          <button className="otg-authPrimaryBtn otg-authGradientBtn" type="submit">
            <span className="otg-authBtnRow">
              <span>Send reset link</span>
              <span className="otg-authArrow">→</span>
            </span>
          </button>

          <div className="otg-authLinks" style={{ marginTop: 10 }}>
            <Link className="otg-authLink" href="/login">
              Back to sign in
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
