"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignupSuccess() {
  const router = useRouter();

  useEffect(() => {
    // quick, friendly redirect to the generator page
    const t = setTimeout(() => router.replace("/app"), 700);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <main className="otg-authPage">
      <div className="otg-authBg" />
      <section className="otg-authCard2">
        <h1 className="otg-authTitle">Account created 🎉</h1>
        <p className="otg-authSub">Taking you to the generator…</p>

        <button className="otg-authPrimaryBtn" onClick={() => router.replace("/app")}>
          Continue
        </button>
      </section>
    </main>
  );
}
