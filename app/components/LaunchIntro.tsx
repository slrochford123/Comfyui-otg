"use client";
import { useEffect, useState } from "react";

/** Mounted once by the root layout, never by tab panels. No session identifiers. */
export default function LaunchIntro() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="slr-launch-intro" role="status" aria-label="Launching SLR Studios">
    <div className="slr-launch-mark"><img src="/Brand/slr-icon.png" width="144" height="144" alt="SLR Studios" fetchPriority="high" /><p>SLR Studios</p><span>Create something extraordinary.</span></div>
  </div>;
}
