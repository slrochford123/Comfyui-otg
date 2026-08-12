"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "@/app/components/ThemeToggle";

export default function HeaderBar({ isConnected }: { isConnected: boolean | null }) {
  const [headerVisible, setHeaderVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function clearHideTimer() {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    }

    function revealHeader() {
      setHeaderVisible(true);
      clearHideTimer();
      hideTimerRef.current = window.setTimeout(() => {
        setHeaderVisible(false);
      }, 2000);
    }

    revealHeader();

    window.addEventListener("scroll", revealHeader, { passive: true });
    window.addEventListener("wheel", revealHeader, { passive: true });
    window.addEventListener("touchmove", revealHeader, { passive: true });
    window.addEventListener("mousemove", revealHeader, { passive: true });
    window.addEventListener("keydown", revealHeader);
    window.addEventListener("focusin", revealHeader);

    return () => {
      clearHideTimer();
      window.removeEventListener("scroll", revealHeader);
      window.removeEventListener("wheel", revealHeader);
      window.removeEventListener("touchmove", revealHeader);
      window.removeEventListener("mousemove", revealHeader);
      window.removeEventListener("keydown", revealHeader);
      window.removeEventListener("focusin", revealHeader);
    };
  }, []);

  return (
    <header
      className="otg-header"
      data-otg-autohide-header="true"
      style={{
        transform: headerVisible ? "translateY(0)" : "translateY(-115%)",
        opacity: headerVisible ? 1 : 0,
        pointerEvents: headerVisible ? "auto" : "none",
        transition: "transform 220ms ease, opacity 220ms ease",
        willChange: "transform, opacity",
      }}
    >
      <div className="otg-header-left">
        <div className="otg-title-row">
          <h1 className="otg-title otg-gradText">SLR Studios OTG</h1>
          <div className="otg-logo-stack" aria-label='SLR Studios OTG "On The Go" logo'>
            <Image
              src="/brand/otg-logo.png"
              alt="SLR Studios OTG"
              width={34}
              height={34}
              className="otg-logo-inline"
              priority
            />
            <div className="otg-logo-caption">"On The Go"</div>
          </div>
        </div>
        <p className="otg-subtitle">Making pictures and videos on the go.</p>
      </div>

      <div className="otg-header-right">
        <div className={["otg-conn", isConnected ? "ok" : "bad"].join(" ")}>
          <span className="dot" aria-hidden="true" />
          <span>{isConnected ? "Connected" : "Disconnected"}</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
