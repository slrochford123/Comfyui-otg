"use client";

import { useEffect, useMemo, useState } from "react";

type ApiItem = {
  name?: string;
  video?: boolean;
};

type Props = {
  items?: ApiItem[];
};

function isVideoName(name: string) {
  const n = name.toLowerCase();
  return n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mov") || n.endsWith(".mkv");
}

export default function GalleryGridMinimal({ items = [] }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const tiles = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    return list.map((it, i) => {
      const name = String(it?.name || "").trim() || `item-${i}`;
      const video = typeof it?.video === "boolean" ? it.video : isVideoName(name);
      const thumb = `/api/gallery/thumb?name=${encodeURIComponent(name)}`;
      const file = `/api/gallery/file?name=${encodeURIComponent(name)}`;
      return { key: `${name}::${i}`, name, video, thumb, file };
    });
  }, [items]);

  if (!mounted) return <div className="otg-help">Loading…</div>;
  if (tiles.length === 0) return <div className="otg-help">No outputs yet.</div>;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: 12,
      }}
    >
      {tiles.map((t) => (
        <a
          key={t.key}
          href={t.file}
          target="_blank"
          rel="noreferrer"
          style={{
            position: "relative",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            overflow: "hidden",
            background: "rgba(255,255,255,0.03)",
            textDecoration: "none",
          }}
          title={t.name}
        >
          <img
            src={t.thumb}
            alt={t.name}
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              height: 180,
              objectFit: "cover",
              display: "block",
              background: "rgba(0,0,0,0.25)",
            }}
          />

          {t.video ? (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                background: "rgba(0,0,0,0.72)",
                color: "white",
                fontSize: 12,
                padding: "4px 8px",
                borderRadius: 999,
                letterSpacing: 0.4,
              }}
            >
              VIDEO
            </div>
          ) : null}

          <div style={{ padding: 8, fontSize: 12, opacity: 0.85, wordBreak: "break-all" }}>{t.name}</div>
        </a>
      ))}
    </div>
  );
}
