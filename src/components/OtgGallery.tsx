"use client";

import { useEffect, useState } from "react";
import { otgFetch } from "../lib/otgDevice";

export type OtgGalleryItem = {
  id: string;
  rel: string;
  url: string;
  mtimeMs: number;
  bytes: number;
};

export default function OtgGallery() {
  const [items, setItems] = useState<OtgGalleryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const r = await otgFetch("/api/otg/gallery", { cache: "no-store" });
      if (!r.ok) throw new Error(`gallery ${r.status}`);
      const data = await r.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load gallery");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-3">
        <button
          className="px-3 py-2 rounded-lg border"
          onClick={refresh}
          type="button"
        >
          Refresh
        </button>
        {error ? <div className="text-red-500 text-sm">{error}</div> : null}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((it) => (
          <div key={it.id} className="rounded-lg overflow-hidden border">
            <img
              src={it.url}
              alt={it.id}
              className="w-full h-auto block"
              loading="lazy"
              onError={() => console.error("IMG failed:", it.url)}
            />
            <div className="text-xs p-2 truncate">{it.id}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
