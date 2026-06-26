"use client";

import Image from "next/image";
import ThemeToggle from "@/app/components/ThemeToggle";

export default function HeaderBar({ isConnected }: { isConnected: boolean | null }) {
  return (
    <header className="otg-header">
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
