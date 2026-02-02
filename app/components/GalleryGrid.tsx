"use client";

function getDeviceId(): string {
  if (typeof window === "undefined") return "desktop_default";
  return (
    localStorage.getItem("otg_device_id") ||
    sessionStorage.getItem("otg_device_id") ||
    "desktop_default"
  );
}
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authHeaders } from '@/lib/authClient';
import GalleryActions from './GalleryActions';
import GalleryItemActions from './GalleryItemActions';

type GalleryItem = {
  name?: string;
  filename?: string;
  fileName?: string;
  file?: string;
  path?: string;
  src?: string;
  url?: string;
  type?: string;
  mime?: string;
  mtimeMs?: number;
  size?: number;
};

function pickName(it: GalleryItem): string | null {
  return (
    it.name ||
    it.filename ||
    it.fileName ||
    it.file ||
    it.path ||
    null
  );
}

function pickSrc(it: GalleryItem): string | null {
  return it.src || it.url || null;
}

function isVideoName(name: string) {
  const n = name.toLowerCase();
  return n.endsWith('.mp4') || n.endsWith('.webm') || n.endsWith('.mov');
}

export default function GalleryGrid() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [deviceId, setDeviceId] = useState<string>('local');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadGallery = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gallery', { cache: 'no-store', headers: authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j?.error || `Gallery fetch failed (${res.status})`);
      }
      setDeviceId(j?.deviceId || 'local');
      setItems(Array.isArray(j?.items) ? j.items : []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  const tiles = useMemo(() => {
    return (items || []).map((it, idx) => {
      const name = pickName(it) || `item-${idx}`;
      const src = pickSrc(it) || `/api/gallery/file?name=${encodeURIComponent(name)}`;
      const video = isVideoName(name);
      return { it, name, src, video };
    });
  }, [items]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Gallery</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Device: {deviceId}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <GalleryActions onRefresh={loadGallery} />
          <button onClick={loadGallery} disabled={loading} style={{ padding: '6px 10px' }}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: 12, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10 }}>
          <div style={{ color: '#ff7b7b', marginBottom: 6 }}>Gallery error</div>
          <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'pre-wrap' }}>{error}</div>
        </div>
      ) : null}

      {loading && tiles.length === 0 ? (
        <div style={{ padding: 12, opacity: 0.75 }}>Loading…</div>
      ) : null}

      {!loading && tiles.length === 0 ? (
        <div style={{ padding: 12, opacity: 0.75 }}>No outputs yet. Run a job, then come back here.</div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {tiles.map(({ name, src, video }) => (
          <div
            key={name}
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <div style={{ aspectRatio: '1 / 1', background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {video ? (
                <video
                  src={src}
                  controls
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <img
                  src={src}
                  alt={name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
            </div>

            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.85, wordBreak: 'break-all' }}>{name}</div>
              <GalleryItemActions name={name} onDeleted={loadGallery} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
