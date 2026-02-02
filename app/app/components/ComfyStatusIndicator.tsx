"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import React, { useEffect, useMemo, useState } from 'react';

type ComfyStatusResponse =
  | { ok: true; status: number; comfyBase: string; target: string; system?: { comfyui_version?: string; required_frontend_version?: string } }
  | { ok: false; status: number; comfyBase: string; target: string; error?: string };

export function ComfyStatusIndicator({
  pollMs = 3000,
  compact = true,
}: {
  pollMs?: number;
  compact?: boolean;
}) {
  const [data, setData] = useState<ComfyStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await fetch('/api/comfy-status', { cache: 'no-store' });
        const j = (await r.json()) as ComfyStatusResponse;
        if (!alive) return;
        setData(j);
      } catch (e: any) {
        if (!alive) return;
        setData({
          ok: false,
          status: 0,
          comfyBase: '',
          target: '',
          error: String(e?.message ?? e),
        });
      } finally {
        if (alive) setLoading(false);
      }
    }
    tick();
    const id = window.setInterval(tick, pollMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [pollMs]);

  const tone = useMemo(() => {
    if (loading && !data) return 'checking';
    if (!data) return 'checking';
    if (data.ok) return 'ok';
    return 'bad';
  }, [data, loading]);

  const label = useMemo(() => {
    if (tone === 'checking') return 'Checkingâ€¦';
    if (tone === 'ok') return 'ComfyUI Connected';
    return 'ComfyUI Offline';
  }, [tone]);

  const sub = useMemo(() => {
    if (!data) return '';
    if (data.ok) {
      const v = data.system?.comfyui_version ? `v${data.system.comfyui_version}` : '';
      return [data.comfyBase || data.target, v].filter(Boolean).join(' â€¢ ');
    }
    return data.error || `HTTP ${data.status}`;
  }, [data]);

  const dotColor = tone === 'ok' ? '#22c55e' : tone === 'checking' ? '#f59e0b' : '#ef4444';

  return (
    <div
      role="status"
      aria-live="polite"
      title={sub}
      style={{
        position: 'fixed',
        top: 14,
        right: 90, // leave room for Build badge on the far right
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: compact ? '8px 12px' : '10px 14px',
        borderRadius: 999,
        border: '1px solid rgba(255,255,255,.14)',
        background: 'rgba(0,0,0,.55)',
        color: 'rgba(255,255,255,.92)',
        fontWeight: 800,
        fontSize: compact ? 12 : 13,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        maxWidth: 380,
      }}
    >
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: dotColor, boxShadow: `0 0 0 2px rgba(0,0,0,.35)` }} />
      <span>{label}</span>
    </div>
  );
}


