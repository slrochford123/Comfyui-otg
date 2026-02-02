"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import { useCallback, useEffect, useMemo, useState } from "react";
import { authHeaders } from "@/lib/authClient";

type GalleryItem = {
  name?: string;
  filename?: string;
  fileName?: string;
  file?: string;
  path?: string;
  src?: string;
  url?: string;
};

function pickName(it: GalleryItem): string | null {
  return it.name || it.filename || it.fileName || it.file || it.path || null;
}

function pickSrc(it: GalleryItem): string | null {
  return it.src || it.url || null;
}

function isVideoName(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mov");
}

export default function GalleryGridMinimal() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gallery", { cache: "no-store", headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Gallery fetch failed (${res.status})`);
      setItems(Array.isArray(j?.items) ? j.items : []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tiles = useMemo(() => {
    return (items || []).map((it, idx) => {
      const name = pickName(it) || `item-${idx}`;
      const src = pickSrc(it) || `/api/gallery/file?name=${encodeURIComponent(name)}`;
      const video = isVideoName(name);
      return { name, src, video };
    });
  }, [items]);

  if (error) return <div className="slr-error">{error}</div>;

  if (loading && tiles.length === 0) return <div className="slr-empty">Loading…</div>;

  if (!loading && tiles.length === 0) return <div className="slr-empty">No outputs yet.</div>;

  return (
    <div className="slr-grid">
      {tiles.map(({ name, src, video }) => (
        <div key={name} className="slr-tile">
          <div className="slr-tileMedia">
            {video ? <video src={src} controls /> : <img src={src} alt={name} loading="lazy" />}
          </div>
        </div>
      ))}
    </div>
  );
}
