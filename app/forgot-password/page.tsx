"use client";

// Keep this route for backwards compatibility.
// The app's primary reset UI lives at /forgot.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ForgotPasswordRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/forgot");
  }, [router]);

  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2">
        <div className="otg-authHeaderMini">RESET PASSWORD</div>
        <h1 className="otg-authTitle">Redirecting…</h1>
        <p className="otg-authSub">Taking you to the reset page.</p>
      </section>
    </main>
  );
}
