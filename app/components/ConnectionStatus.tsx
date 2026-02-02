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

type StatusPayload = {
  ok: boolean;
  status?: number;
  comfyBase?: string;
  target?: string;
  error?: string;
  system?: {
    comfyui_version?: string;
  };
};

export default function ConnectionStatus(props: {
  /** Poll interval in ms (default 3000) */
  intervalMs?: number;
  /** Optional label to show next to the dot (default true) */
  showLabel?: boolean;
  /** Optional compact mode (smaller) */
  compact?: boolean;
}) {
  const intervalMs = props.intervalMs ?? 3000;
  const showLabel = props.showLabel ?? true;
  const compact = props.compact ?? false;

  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);
  const [detail, setDetail] = useState<string>('');

  useEffect(() => {
    let alive = true;
    let timer: any = null;

    const tick = async () => {
      try {
        const res = await fetch('/api/comfy-status', { cache: 'no-store' });
        const data = (await res.json()) as StatusPayload;

        if (!alive) return;
        setOk(Boolean(data?.ok));
        const ver = data?.system?.comfyui_version ? `ComfyUI ${data.system.comfyui_version}` : 'ComfyUI';
        if (data?.ok) {
          setDetail(`${ver} reachable via ${data?.comfyBase ?? ''}`.trim());
        } else {
          setDetail(data?.error ? `Disconnected: ${data.error}` : 'Disconnected');
        }
      } catch (e: any) {
        if (!alive) return;
        setOk(false);
        setDetail(`Disconnected: ${e?.message ?? 'request failed'}`);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };

    tick();
    timer = setInterval(tick, intervalMs);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [intervalMs]);

  const dotClass = useMemo(() => {
    // Colors rely on Tailwind's default palette
    if (loading) return 'bg-zinc-400/70';
    return ok ? 'bg-emerald-500' : 'bg-rose-500';
  }, [loading, ok]);

  const ringClass = useMemo(() => {
    if (loading) return 'ring-zinc-400/20';
    return ok ? 'ring-emerald-500/20' : 'ring-rose-500/20';
  }, [loading, ok]);

  const label = loading ? 'Checking…' : ok ? 'Connected' : 'Disconnected';

  return (
    <div
      className={[
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-sm',
        'border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
        compact ? 'text-xs' : 'text-sm',
      ].join(' ')}
      title={detail || label}
      aria-label={detail || label}
    >
      <span
        className={[
          'relative inline-flex h-2.5 w-2.5 rounded-full',
          dotClass,
          'ring-4',
          ringClass,
        ].join(' ')}
      />
      {showLabel ? <span className="font-semibold">{label}</span> : null}
    </div>
  );
}
