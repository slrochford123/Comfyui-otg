"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import { useCallback, useState } from 'react';

type Props = { onRefresh?: () => void };

export default function GalleryActions({ onRefresh }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const clearAll = useCallback(async () => {
    if (!confirm('Clear ALL gallery items? This deletes copied files from OTG gallery.')) return;
    setBusy('clearing');
    try {
      const res = await fetch('/api/gallery?confirm=1', { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) alert(j?.error || 'Failed to clear');
      onRefresh?.();
    } finally {
      setBusy(null);
    }
  }, [onRefresh]);

  const downloadAll = useCallback(async () => {
    setBusy('downloading');
    try {
      const res = await fetch('/api/gallery/download-all', { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Failed to get download list');

      for (const f of j.files || []) {
        const a = document.createElement('a');
        a.href = f.url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const btn = (active: boolean) =>
    `rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 ${active ? 'opacity-70' : ''}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={clearAll} disabled={!!busy} className={btn(busy === 'clearing')}>
        {busy === 'clearing' ? 'Clearing…' : 'Clear All'}
      </button>
      <button onClick={downloadAll} disabled={!!busy} className={btn(busy === 'downloading')}>
        {busy === 'downloading' ? 'Downloading…' : 'Download All'}
      </button>
    </div>
  );
}
