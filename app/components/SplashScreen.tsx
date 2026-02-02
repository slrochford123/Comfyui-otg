"use client";

import { useEffect, useState } from "react";

export default function SplashScreen({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    setVisible(show);
    if (!show) return;
    const t = window.setTimeout(() => setVisible(false), 2200);
    return () => window.clearTimeout(t);
  }, [show]);

  if (!visible) return null;

  return (
    <div className="otg-splash" role="status" aria-label="Loading SLR Studios OTG">
      <div className="otg-splash-card">
        <div className="otg-splash-title">SLR Studios OTG</div>
        <div className="otg-splash-sub">"On The Go"</div>
        <div className="otg-splash-bar" />
      </div>
    </div>
  );
}
