"use client";
import Link from "next/link";
export default function ForgotPage() {
  return <main className="otg-authPage">
    <div className="otg-authBg" />
    <section className="otg-authCard2">
      <div className="otg-authHeaderMini">ACCOUNT RECOVERY</div>
      <h1 className="otg-authTitle">Recover your account</h1>
      <p className="otg-authSub">Password recovery is handled by your SLR Studios administrator.</p>
      <div className="otg-authNotice" role="status">
        Contact your administrator with your username. Do not send your password.
        Automatic reset emails are not configured, so no email has been sent.
      </div>
      <div className="otg-authLinks" style={{ marginTop: 16 }}>
        <Link className="otg-authLink" href="/login">Back to sign in</Link>
      </div>
    </section>
  </main>;
}
