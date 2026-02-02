"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/app/lib/useAuth";

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname.startsWith(href);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || "/app";
  const auth = useAuth();

  const [loggingOut, setLoggingOut] = useState(false);

  const links = useMemo(
    () => [
      { href: "/app", label: "Generate" },
      { href: "/app/gallery", label: "Gallery" },
      { href: "/app/favorites", label: "Favorites" },
      { href: "/app/settings", label: "Settings" },
    ],
    []
  );

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      router.replace("/login?reason=session");
      setLoggingOut(false);
    }
  }

  // If auth is known-unauthed, bounce to login.
  if (auth.status === "unauthed") {
    // client-only redirect
    router.replace("/login?reason=session");
    return null;
  }

  return (
    <div className="slr-shell">
      <div className="slr-topbar">
        <div className="slr-wrap">
          <div className="slr-topbarRow">
            <div className="slr-brandRow" style={{ margin: 0 }}>
              <img className="slr-brandLogo" src="/icon-192-maskable.png" alt="SLR Studios OTG" />
              <div style={{ minWidth: 0 }}>
                <div className="slr-title" style={{ fontSize: 16 }}>
                  SLR Studios <span className="slr-gradText">OTG</span>
                </div>
                <div className="slr-sub" style={{ margin: 0 }}>
                  {auth.status === "authed" ? auth.user.email : ""}
                </div>
              </div>
            </div>

            <nav className="slr-nav" aria-label="Primary">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={["slr-navLink", isActive(pathname, l.href) ? "slr-navLinkActive" : ""].join(" ")}
                >
                  {l.label}
                </Link>
              ))}
              <button
                className="slr-btn slr-btnGhost"
                onClick={logout}
                disabled={loggingOut}
                style={{ padding: "9px 12px" }}
              >
                {loggingOut ? "Signing out…" : "Logout"}
              </button>
            </nav>
          </div>
        </div>
      </div>

      <main className="slr-main">
        <div className="slr-wrap">{children}</div>
      </main>
    </div>
  );
}
