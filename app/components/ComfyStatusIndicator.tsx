"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import React, { useEffect, useState } from "react";

type Status = {
  ok: boolean;
  serverState?: string;
  serverHint?: string;
  comfyBaseUrl?: string;
  upstreamStatus?: number;
  error?: string;
};

export default function ComfyStatusIndicator() {
  const [st, setSt] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const r = await fetch("/api/comfy-status", { cache: "no-store" });
        const j = (await r.json()) as any;
        if (!alive) return;
        setSt({ ...(j ?? {}), ok: !!j?.ok });
      } catch (e: any) {
        if (!alive) return;
        setSt({ ok: false, error: String(e?.message ?? e) });
      }
    }

    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const ok = !!st?.ok;
  const label = st ? (ok ? "ComfyUI Connected" : "ComfyUI Offline") : "Checking...";
  const sub = st?.error ? st.error : st?.serverHint ? st.serverHint : st?.comfyBaseUrl ? st.comfyBaseUrl : "";

  const dotStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: 9999,
    display: "inline-block",
    marginRight: 8,
    boxShadow: "0 0 0 2px rgba(255,255,255,0.10)",
    background: st ? (ok ? "#22c55e" : "#ef4444") : "#94a3b8",
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 14,
        right: 110,
        zIndex: 50,
        padding: "6px 10px",
        borderRadius: 9999,
        background: "rgba(0,0,0,0.55)",
        color: "white",
        border: "1px solid rgba(255,255,255,0.12)",
        fontSize: 12,
        lineHeight: 1,
        maxWidth: 320,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        backdropFilter: "blur(6px)",
      }}
      title={sub}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden style={dotStyle} />
      <span style={{ fontWeight: 600 }}>{label}</span>
    </div>
  );
}

