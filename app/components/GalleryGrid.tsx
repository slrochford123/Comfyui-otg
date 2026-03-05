"use client";

import React from "react";

type ItemObj = { name: string; video?: boolean };
type Item = string | ItemObj;

type Props = {
  items: Item[];
  onOpen?: (name: string, isVideo: boolean) => void;
};

function isVideoName(name: string) {
  const n = (name || "").toLowerCase();
  return n.endsWith(".mp4") || n.endsWith(".webm") || n.endsWith(".mov");
}

function normalize(items: Item[]) {
  const out: Array<{ name: string; video: boolean; thumbSrc: string }> = [];
  for (let i = 0; i < (items || []).length; i++) {
    const it: any = (items as any)[i];
    const name = typeof it === "string" ? it : (it?.name || "");
    if (!name) continue;
    const video = typeof it === "string" ? isVideoName(name) : Boolean(it?.video ?? isVideoName(name));
    const thumbSrc = `/api/gallery/thumb?name=${encodeURIComponent(name)}`;
    out.push({ name, video, thumbSrc });
  }
  return out;
}

export function GalleryGrid({ items, onOpen }: Props) {
  const list = normalize(items);

  return (
    <div className="otg-gallery-grid">
      {list.map((x, idx) => (
        <button
          key={`${x.name}__${idx}`}
          className="otg-gallery-tile"
          onClick={() => onOpen?.(x.name, x.video)}
          title={x.name}
          type="button"
        >
          <img className="otg-gallery-thumb" src={x.thumbSrc} alt={x.name} loading="lazy" />
          <div className="otg-gallery-name">{x.name}</div>
          {x.video ? <div className="otg-gallery-badge">VIDEO</div> : null}
        </button>
      ))}
    </div>
  );
}
