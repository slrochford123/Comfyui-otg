"use client";

import React from "react";

type AnyGalleryItem = {
  name?: string;
  title?: string;
  url?: string;
  thumbnailUrl?: string;
  kind?: string;
  media?: string;
};

type GalleryVirtualListProps = {
  files?: AnyGalleryItem[];
  items?: AnyGalleryItem[];
  onFavorite?: (name: string) => void;
  onDelete?: (name: string) => void;
  onSelect?: (item: AnyGalleryItem) => void;
} & Record<string, unknown>;

function itemName(item: AnyGalleryItem, index: number) {
  return item.name || item.title || "Gallery item " + (index + 1);
}

export default function GalleryVirtualList(props: GalleryVirtualListProps) {
  const items = Array.isArray(props.items)
    ? props.items
    : Array.isArray(props.files)
      ? props.files
      : [];

  if (!items.length) {
    return (
      <div data-testid="gallery-virtual-list" className="otg-emptyState">
        No gallery items yet.
      </div>
    );
  }

  return (
    <div data-testid="gallery-virtual-list" className="otg-galleryGrid">
      {items.map((item, index) => {
        const name = itemName(item, index);
        const src = item.thumbnailUrl || item.url || "";
        return (
          <article key={name + "-" + index} className="otg-card" aria-label={name}>
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={name} style={{ width: "100%", height: "auto" }} />
            ) : null}
            <div className="otg-cardBody">
              <strong>{name}</strong>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {props.onFavorite ? (
                  <button type="button" onClick={() => props.onFavorite?.(name)}>
                    Favorite
                  </button>
                ) : null}
                {props.onDelete ? (
                  <button type="button" onClick={() => props.onDelete?.(name)}>
                    Delete
                  </button>
                ) : null}
                {props.onSelect ? (
                  <button type="button" onClick={() => props.onSelect?.(item)}>
                    Open
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
