"use client";

import React from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/cn";

export type GalleryItem = {
  fileName?: string;
  name?: string;
  sourceName?: string;
  url?: string;
  video?: boolean;
  kind?: "image" | "video";
  source?: "user" | "device" | string;
  createdAt?: number;
  updatedAt?: number;
  meta?: {
    favorite?: boolean;
    renamedName?: string | null;
    originalName?: string | null;
    positivePrompt?: string | null;
    negativePrompt?: string | null;
    submitPayload?: Record<string, any> | null;
    workflowId?: string | null;
    workflowTitle?: string | null;
  };
};

export type GalleryViewMode = "default" | "grid" | "list";
export type GalleryActionKind = "" | "favorite" | "rename" | "redo" | "delete" | "extend-prepare" | "edit-submit" | "animate-submit" | "extend-submit" | "character-import";
export type ViewerCollection = "gallery" | "favorites";

export type ViewerState = {
  collection: ViewerCollection;
  itemKey: string;
  item: GalleryItem;
};

export type EditModalState = {
  item: GalleryItem;
  positivePrompt: string;
  negativePrompt: string;
  enhancing: boolean;
};

export type AnimateModalState = {
  item: GalleryItem;
  positivePrompt: string;
  negativePrompt: string;
  durationSeconds: number;
  enhancing: boolean;
};

export type ExtendModalState = {
  item: GalleryItem;
  frameUrl: string;
  frameName: string;
  orientation: "portrait" | "landscape";
  positivePrompt: string;
  negativePrompt: string;
  durationSeconds: number;
  enhancing: boolean;
};

const ITEMS_PER_PAGE_OPTIONS = [5, 10, 25, 50, 100, 0] as const;

export function getGalleryItemKey(item: GalleryItem) {
  return String(item.fileName || item.name || item.sourceName || item.meta?.renamedName || item.meta?.originalName || "").trim();
}

function buildGalleryThumbUrl(item: GalleryItem, width = 640) {
  const name = getGalleryItemKey(item);
  if (!name) return String(item.url || "");
  const params = new URLSearchParams({
    collection: "gallery",
    name,
    scope: String(item.source || "user"),
    w: String(width),
  });
  return `/api/thumb?${params.toString()}`;
}


const MEDIA_CARD_STYLE: React.CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "360px 320px",
};

const ThumbImage = React.memo(function ThumbImage({
  item,
  thumbUrl,
  alt,
  eager = false,
}: {
  item: GalleryItem;
  thumbUrl: string;
  alt: string;
  eager?: boolean;
}) {
  const [src, setSrc] = React.useState(thumbUrl);

  React.useEffect(() => {
    setSrc(thumbUrl);
  }, [thumbUrl]);

  const fallbackUrl = String(item.url || "").trim();

  return (
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-contain"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "low"}
      onError={() => {
        if (fallbackUrl && src !== fallbackUrl) {
          setSrc(fallbackUrl);
        }
      }}
    />
  );
});

function IconHeart({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={filled ? "currentColor" : "none"} aria-hidden="true">
      <path
        d="M12 20.5s-7-4.35-7-10a4 4 0 0 1 7-2.47A4 4 0 0 1 19 10.5c0 5.65-7 10-7 10Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#060912] p-5 shadow-[0_0_50px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black tracking-tight text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyStateCard({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-[22px] border border-dashed border-white/10 bg-black/30 p-6 text-center" style={MEDIA_CARD_STYLE}>
      <div className="text-base font-semibold text-white/88">{title}</div>
      <div className="mt-2 text-sm text-white/55">{detail}</div>
    </div>
  );
}

const MediaGrid = React.memo(function MediaGrid({
  items,
  viewMode = "default",
  busyName,
  busyKind = "",
  actionsLocked = false,
  emptyStateTitle = "No items found.",
  emptyStateDetail = "There is nothing to show right now.",
  onDownload,
  onFavorite,
  onRename,
  onRedo,
  onEdit,
  onAnimate,
  onExtend,
  onCreateCharacter,
  onDelete,
  onOpenViewer,
}: {
  items: GalleryItem[];
  viewMode?: GalleryViewMode;
  busyName?: string;
  busyKind?: GalleryActionKind;
  actionsLocked?: boolean;
  emptyStateTitle?: string;
  emptyStateDetail?: string;
  onDownload?: (item: GalleryItem) => void;
  onFavorite?: (item: GalleryItem) => void;
  onRename?: (item: GalleryItem) => void;
  onRedo?: (item: GalleryItem) => void;
  onEdit?: (item: GalleryItem) => void;
  onAnimate?: (item: GalleryItem) => void;
  onExtend?: (item: GalleryItem) => void;
  onCreateCharacter?: (item: GalleryItem) => void;
  onDelete?: (item: GalleryItem) => void;
  onOpenViewer?: (item: GalleryItem) => void;
}) {
  const listVirtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 116,
    overscan: 8,
    enabled: viewMode === "list" && items.length > 100,
  });

  if (!items.length) {
    return <EmptyStateCard title={emptyStateTitle} detail={emptyStateDetail} />;
  }

  const containerClass =
    viewMode === "list"
      ? "space-y-3"
      : viewMode === "grid"
        ? "grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5"
        : "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

  if (viewMode === "list" && items.length > 100) {
    return (
      <div className="relative" style={{ height: `${listVirtualizer.getTotalSize()}px` }}>
        {listVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          const itemKey = getGalleryItemKey(item);
          const isCurrentBusyItem = !!busyName && busyName === itemKey;
          const isBusy = actionsLocked || isCurrentBusyItem;
          const favorite = Boolean(item.meta?.favorite);
          const favoriteLabel = isCurrentBusyItem && busyKind === "favorite" ? (favorite ? "Saving..." : "Updating...") : favorite ? "Saved" : "Heart";
          const renameLabel = isCurrentBusyItem && busyKind === "rename" ? "Renaming..." : "Rename";
          const redoLabel = isCurrentBusyItem && busyKind === "redo" ? "Retrying..." : "Redo";
          const deleteLabel = isCurrentBusyItem && busyKind === "delete" ? "Deleting..." : "Delete";
          const isImage = !item.video && item.kind !== "video";
          const createdLabel = item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleString() : "Unknown time";

          return (
            <div
              key={`${itemKey || "item"}-${virtualRow.index}`}
              ref={listVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 right-0"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div className="mb-3 overflow-hidden rounded-[24px] border border-white/10 bg-black/35 p-3 md:p-4" style={MEDIA_CARD_STYLE}>
                <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 md:flex-row md:items-center">
                  <button type="button" onClick={() => onOpenViewer?.(item)} className="min-w-0 text-left">
                    <div className="space-y-2">
                      <div className="break-all text-base font-semibold text-white/90 hover:text-white">{item.name || "Unnamed item"}</div>
                      <div className="text-sm text-white/50">{createdLabel}</div>
                      <div className="text-xs uppercase tracking-[0.18em] text-white/35">{item.video ? "Video" : "Image"}</div>
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-2 md:shrink-0">
                    <button type="button" onClick={() => onDownload?.(item)} disabled={actionsLocked} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
                      Download
                    </button>
                    <button
                      type="button"
                      onClick={() => onFavorite?.(item)}
                      disabled={isBusy}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50",
                        favorite ? "border-pink-400/30 bg-pink-500/15 text-pink-100" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                      )}
                    >
                      <IconHeart filled={favorite} />
                      <span>{favoriteLabel}</span>
                    </button>
                    {isImage ? (
                      <>
                        <button type="button" onClick={() => onEdit?.(item)} disabled={isBusy} className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/15 disabled:opacity-50">
                          Edit
                        </button>
                        <button type="button" onClick={() => onAnimate?.(item)} disabled={isBusy} className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/15 disabled:opacity-50">
                          Animate
                        </button>
                        {onCreateCharacter ? (
                          <button type="button" onClick={() => onCreateCharacter?.(item)} disabled={isBusy} className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-50">
                            Characters
                          </button>
                        ) : null}
                      </>
                    ) : (
                      <button type="button" onClick={() => onExtend?.(item)} disabled={isBusy} className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/15 disabled:opacity-50">
                        Extend
                      </button>
                    )}
                    <button type="button" onClick={() => onRename?.(item)} disabled={isBusy} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50">
                      {renameLabel}
                    </button>
                    <button type="button" onClick={() => onRedo?.(item)} disabled={isBusy} className="rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.30),rgba(40,200,255,0.22))] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                      {redoLabel}
                    </button>
                    <button type="button" onClick={() => onDelete?.(item)} disabled={isBusy} className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/15 disabled:opacity-50">
                      {deleteLabel}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {items.map((item, index) => {
        const itemKey = getGalleryItemKey(item);
        const isCurrentBusyItem = !!busyName && busyName === itemKey;
        const isBusy = actionsLocked || isCurrentBusyItem;
        const favorite = Boolean(item.meta?.favorite);
        const favoriteLabel = isCurrentBusyItem && busyKind === "favorite" ? (favorite ? "Saving..." : "Updating...") : favorite ? "Saved" : "Heart";
        const renameLabel = isCurrentBusyItem && busyKind === "rename" ? "Renaming..." : "Rename";
        const redoLabel = isCurrentBusyItem && busyKind === "redo" ? "Retrying..." : "Redo";
        const deleteLabel = isCurrentBusyItem && busyKind === "delete" ? "Deleting..." : "Delete";
        const animateLabel = isCurrentBusyItem && busyKind === "extend-prepare" ? "Preparing..." : "Animate";
        const characterLabel = isCurrentBusyItem && busyKind === "character-import" ? "Sending..." : "Characters";
        const extendLabel = isCurrentBusyItem && busyKind === "extend-prepare" ? "Preparing..." : "Extend";
        const isImage = !item.video && item.kind !== "video";
        const isCharacterCandidate = isImage;
        const createdLabel = item.updatedAt || item.createdAt ? new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleString() : "Unknown time";
        const mediaAspectClass = viewMode === "grid" ? "aspect-square" : "aspect-[4/3]";
        const thumbUrl = buildGalleryThumbUrl(item, viewMode === "grid" ? 512 : 768);
        const thumbEager = index < (viewMode === "grid" ? 12 : 6);

        const actionButtons = (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onDownload?.(item)}
              disabled={actionsLocked}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download
            </button>
            <button
              type="button"
              onClick={() => onFavorite?.(item)}
              disabled={isBusy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50",
                favorite
                  ? "border-pink-400/30 bg-pink-500/15 text-pink-100"
                  : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              )}
            >
              <IconHeart filled={favorite} />
              <span>{favoriteLabel}</span>
            </button>
            {isImage ? (
              <>
                <button
                  type="button"
                  onClick={() => onEdit?.(item)}
                  disabled={isBusy}
                  className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/15 disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onAnimate?.(item)}
                  disabled={isBusy}
                  className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/15 disabled:opacity-50"
                >
                  {animateLabel}
                </button>
                {onCreateCharacter && isCharacterCandidate ? (
                  <button
                    type="button"
                    onClick={() => onCreateCharacter?.(item)}
                    disabled={isBusy}
                    className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/15 disabled:opacity-50"
                  >
                    {characterLabel}
                  </button>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                onClick={() => onExtend?.(item)}
                disabled={isBusy}
                className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-500/15 disabled:opacity-50"
              >
                Extend
              </button>
            )}
            <button
              type="button"
              onClick={() => onRename?.(item)}
              disabled={isBusy}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
            >
              {renameLabel}
            </button>
            <button
              type="button"
              onClick={() => onRedo?.(item)}
              disabled={isBusy}
              className="rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.30),rgba(40,200,255,0.22))] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {redoLabel}
            </button>
            <button
              type="button"
              onClick={() => onDelete?.(item)}
              disabled={isBusy}
              className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/15 disabled:opacity-50"
            >
              {deleteLabel}
            </button>
          </div>
        );

        if (viewMode === "list") {
          return (
            <div key={`${itemKey || "item"}-${index}`} className="overflow-hidden rounded-[24px] border border-white/10 bg-black/35 p-3 md:p-4" style={MEDIA_CARD_STYLE}>
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-4 md:flex-row md:items-center">
                <button type="button" onClick={() => onOpenViewer?.(item)} className="min-w-0 text-left">
                  <div className="space-y-2">
                    <div className="break-all text-base font-semibold text-white/90 hover:text-white">{item.name || "Unnamed item"}</div>
                    <div className="text-sm text-white/50">{createdLabel}</div>
                    <div className="text-xs uppercase tracking-[0.18em] text-white/35">{item.video ? "Video" : "Image"}</div>
                  </div>
                </button>
                <div className="md:shrink-0">{actionButtons}</div>
              </div>
            </div>
          );
        }

        return (
          <div key={`${itemKey || "item"}-${index}`} className={cn("overflow-hidden rounded-[24px] border border-white/10 bg-black/35", viewMode === "grid" ? "rounded-[20px]" : "") } style={MEDIA_CARD_STYLE}>
            <button type="button" onClick={() => onOpenViewer?.(item)} className={cn("relative block w-full overflow-hidden bg-black/50 text-left", mediaAspectClass)}>
              <ThumbImage item={item} thumbUrl={thumbUrl} alt={item.name || "media"} eager={thumbEager} />
              {item.video ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
                  <span className="rounded-full border border-white/10 bg-black/45 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Video</span>
                  <span className="rounded-full border border-white/10 bg-black/45 px-2 py-1 text-[10px] font-semibold text-white/80">Open</span>
                </div>
              ) : null}
            </button>
            <div className={cn("space-y-3", viewMode === "grid" ? "p-3" : "p-4")}>
              <div>
                <div className={cn("break-all font-semibold text-white/85", viewMode === "grid" ? "text-xs" : "text-sm")}>{item.name || "Unnamed item"}</div>
                <div className={cn("text-white/45", viewMode === "grid" ? "text-[11px]" : "text-xs")}>{createdLabel}</div>
              </div>
              {actionButtons}
            </div>
          </div>
        );
      })}
    </div>
  );
});

function buildPaginationModel(currentPage: number, totalPages: number) {
  if (totalPages <= 1) return [1];
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) pages.push("ellipsis");
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < totalPages - 1) pages.push("ellipsis");
  pages.push(totalPages);
  return pages;
}

function preloadImageUrl(url: string) {
  if (typeof window === "undefined" || !url) return;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

function preloadVideoUrl(url: string) {
  if (typeof document === "undefined" || !url) return;
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  video.load();
}

function useGalleryMediaWarmup(args: {
  activeTab: string | null;
  visibleGalleryItems: GalleryItem[];
  visibleFavoriteItems: GalleryItem[];
  viewerItem: GalleryItem | null;
  viewerItems: GalleryItem[];
  viewerIndex: number;
}) {
  const { activeTab, visibleGalleryItems, visibleFavoriteItems, viewerItem, viewerItems, viewerIndex } = args;

  React.useEffect(() => {
    if (activeTab !== "gallery" && activeTab !== "favorites") return;
    const items = activeTab === "favorites" ? visibleFavoriteItems : visibleGalleryItems;
    for (const item of items.slice(0, 12)) {
      preloadImageUrl(buildGalleryThumbUrl(item, 768));
    }
  }, [activeTab, visibleFavoriteItems, visibleGalleryItems]);

  React.useEffect(() => {
    if (!viewerItem) return;
    const neighbors = [viewerItems[viewerIndex - 1], viewerItems[viewerIndex + 1]].filter(Boolean);
    for (const item of neighbors) {
      const url = String(item.url || "").trim();
      if (!url) continue;
      if (item.video || item.kind === "video") {
        preloadImageUrl(buildGalleryThumbUrl(item, 1280));
        preloadVideoUrl(url);
      } else {
        preloadImageUrl(url);
      }
    }
  }, [viewerIndex, viewerItem, viewerItems]);
}

const PaginationBar = React.memo(function PaginationBar({
  totalItems,
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  totalItems: number;
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (value: number) => void;
}) {
  const pages = buildPaginationModel(page, totalPages);
  const summary = pageSize <= 0 ? `Showing all ${totalItems} item${totalItems === 1 ? "" : "s"}` : `Showing ${totalItems ? (page - 1) * pageSize + 1 : 0}-${Math.min(page * pageSize, totalItems)} of ${totalItems}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-black/30 px-4 py-3" style={MEDIA_CARD_STYLE}>
      <div className="text-sm text-white/60">{summary}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">Items per page</label>
        <select
          value={String(pageSize)}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-full border border-white/10 bg-black/55 px-4 py-2 text-sm text-white outline-none focus:border-cyan-400/45"
        >
          {ITEMS_PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === 0 ? "Unlimited" : option}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Prev
        </button>
        {pages.map((entry, index) =>
          entry === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="px-1 text-sm text-white/40">...
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? "page" : undefined}
              className={cn(
                "min-w-10 rounded-full border px-3 py-2 text-sm font-semibold transition",
                entry === page
                  ? "border-cyan-400/35 bg-[linear-gradient(90deg,rgba(145,92,255,0.45),rgba(40,200,255,0.28))] text-white"
                  : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
              )}
            >
              {entry}
            </button>
          )
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
});

type GalleryWorkspaceProps = {
  activeTab: string | null;
  galleryItems: GalleryItem[];
  galleryBusy: boolean;
  galleryForcePullBusy: boolean;
  galleryFilter: "all" | "images" | "videos";
  onGalleryFilterChange: (value: "all" | "images" | "videos") => void;
  gallerySort: "newest" | "oldest" | "name";
  onGallerySortChange: (value: "newest" | "oldest" | "name") => void;
  galleryViewMode: GalleryViewMode;
  onGalleryViewModeChange: (value: GalleryViewMode) => void;
  galleryItemsPerPage: number;
  onGalleryItemsPerPageChange: (value: number) => void;
  galleryPage: number;
  onGalleryPageChange: (value: number) => void;
  gallerySearch: string;
  onGallerySearchChange: (value: string) => void;
  galleryActionBusyName: string;
  galleryActionBusyKind: GalleryActionKind;
  galleryActionsLocked: boolean;
  visibleGalleryItems: GalleryItem[];
  galleryTotalPages: number;
  onRefreshGallery: () => void;
  onForcePullGallery: () => void;
  favoriteItems: GalleryItem[];
  favoritesRawCount: number;
  favoritesBusy: boolean;
  favoritesFilter?: "all" | "images" | "videos";
  onFavoritesFilterChange?: (value: "all" | "images" | "videos") => void;
  favoritesSort?: "newest" | "oldest" | "name";
  onFavoritesSortChange?: (value: "newest" | "oldest" | "name") => void;
  favoritesViewMode?: GalleryViewMode;
  onFavoritesViewModeChange?: (value: GalleryViewMode) => void;
  favoritesSearch?: string;
  onFavoritesSearchChange?: (value: string) => void;
  favoritesItemsPerPage: number;
  onFavoritesItemsPerPageChange: (value: number) => void;
  favoritesPage: number;
  onFavoritesPageChange: (value: number) => void;
  favoritesTotalPages: number;
  visibleFavoriteItems: GalleryItem[];
  onRefreshFavorites: () => void;
  onDownload: (item: GalleryItem) => void;
  onFavorite: (item: GalleryItem) => void;
  onRename: (item: GalleryItem) => void;
  onRedo: (item: GalleryItem) => void;
  onEdit: (item: GalleryItem) => void;
  onAnimate: (item: GalleryItem) => void;
  onExtend: (item: GalleryItem) => void;
  onCreateCharacter: (item: GalleryItem) => void;
  onDelete: (item: GalleryItem) => void;
  onOpenViewer: (item: GalleryItem) => void;
  viewerState: ViewerState | null;
  viewerItem: GalleryItem | null;
  viewerUrl: string;
  viewerTitle: string;
  viewerItems: GalleryItem[];
  viewerIndex: number;
  viewerIsVideo: boolean;
  viewerCanPrev: boolean;
  viewerCanNext: boolean;
  onCloseViewer: () => void;
  onMoveViewer: (direction: "prev" | "next") => void;
  onViewerTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
  onViewerTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void;
  editModal: EditModalState | null;
  onCloseEditModal: () => void;
  onEditPositivePromptChange: (value: string) => void;
  onEditNegativePromptChange: (value: string) => void;
  onEnhanceEdit: () => void;
  onSubmitEdit: () => void;
  animateModal: AnimateModalState | null;
  onCloseAnimateModal: () => void;
  onAnimatePositivePromptChange: (value: string) => void;
  onAnimateNegativePromptChange: (value: string) => void;
  onAnimateDurationChange: (value: number) => void;
  onEnhanceAnimate: () => void;
  onSubmitAnimate: () => void;
  extendModal: ExtendModalState | null;
  onCloseExtendModal: () => void;
  onExtendPositivePromptChange: (value: string) => void;
  onExtendNegativePromptChange: (value: string) => void;
  onExtendDurationChange: (value: number) => void;
  onClearExtendPrompts: () => void;
  onEnhanceExtend: () => void;
  onSubmitExtend: () => void;
};

const GalleryWorkspace = React.memo(function GalleryWorkspace(props: GalleryWorkspaceProps) {
  const {
    activeTab,
    galleryItems,
    galleryBusy,
    galleryForcePullBusy,
    galleryFilter,
    onGalleryFilterChange,
    gallerySort,
    onGallerySortChange,
    galleryViewMode,
    onGalleryViewModeChange,
    galleryItemsPerPage,
    onGalleryItemsPerPageChange,
    galleryPage,
    onGalleryPageChange,
    gallerySearch,
    onGallerySearchChange,
    galleryActionBusyName,
    galleryActionBusyKind,
    galleryActionsLocked,
    visibleGalleryItems,
    galleryTotalPages,
    onRefreshGallery,
    onForcePullGallery,
    favoriteItems,
    favoritesRawCount,
    favoritesBusy,
    favoritesFilter,
    onFavoritesFilterChange,
    favoritesSort,
    onFavoritesSortChange,
    favoritesViewMode,
    onFavoritesViewModeChange,
    favoritesSearch,
    onFavoritesSearchChange,
    favoritesItemsPerPage,
    onFavoritesItemsPerPageChange,
    favoritesPage,
    onFavoritesPageChange,
    favoritesTotalPages,
    visibleFavoriteItems,
    onRefreshFavorites,
    onDownload,
    onFavorite,
    onRename,
    onRedo,
    onEdit,
    onAnimate,
    onExtend,
    onCreateCharacter,
    onDelete,
    onOpenViewer,
    viewerState,
    viewerItem,
    viewerUrl,
    viewerTitle,
    viewerItems,
    viewerIndex,
    viewerIsVideo,
    viewerCanPrev,
    viewerCanNext,
    onCloseViewer,
    onMoveViewer,
    onViewerTouchStart,
    onViewerTouchEnd,
    editModal,
    onCloseEditModal,
    onEditPositivePromptChange,
    onEditNegativePromptChange,
    onEnhanceEdit,
    onSubmitEdit,
    animateModal,
    onCloseAnimateModal,
    onAnimatePositivePromptChange,
    onAnimateNegativePromptChange,
    onAnimateDurationChange,
    onEnhanceAnimate,
    onSubmitAnimate,
    extendModal,
    onCloseExtendModal,
    onExtendPositivePromptChange,
    onExtendNegativePromptChange,
    onExtendDurationChange,
    onClearExtendPrompts,
    onEnhanceExtend,
    onSubmitExtend,
  } = props;

  const safeGallerySearch = typeof gallerySearch === "string" ? gallerySearch : "";
  const safeFavoritesSearch = typeof favoritesSearch === "string" ? favoritesSearch : "";
  const safeFavoritesFilter = favoritesFilter ?? "all";
  const safeFavoritesSort = favoritesSort ?? "newest";
  const safeFavoritesViewMode = favoritesViewMode ?? galleryViewMode ?? "default";
  const handleFavoritesSearchChange = onFavoritesSearchChange ?? (() => undefined);
  const handleFavoritesFilterChange = onFavoritesFilterChange ?? (() => undefined);
  const handleFavoritesSortChange = onFavoritesSortChange ?? (() => undefined);
  const handleFavoritesViewModeChange = onFavoritesViewModeChange ?? (() => undefined);

  useGalleryMediaWarmup({
    activeTab,
    visibleGalleryItems,
    visibleFavoriteItems,
    viewerItem,
    viewerItems,
    viewerIndex,
  });

  const galleryHasRefinements = safeGallerySearch.trim().length > 0 || galleryFilter !== "all" || gallerySort !== "newest";
  const gallerySummary = galleryHasRefinements
    ? `${galleryItems.length} matching item${galleryItems.length === 1 ? "" : "s"}`
    : `${galleryItems.length} gallery item${galleryItems.length === 1 ? "" : "s"}`;
  const favoritesHasRefinements = safeFavoritesSearch.trim().length > 0 || safeFavoritesFilter !== "all" || safeFavoritesSort !== "newest";
  const favoritesSummary = favoritesHasRefinements
    ? `${favoriteItems.length} matching favorite${favoriteItems.length === 1 ? "" : "s"}`
    : `${favoriteItems.length} favorite${favoriteItems.length === 1 ? "" : "s"}`;

  return (
    <>
      {activeTab === "gallery" ? (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tight text-white">Gallery</h1>
                <p className="text-sm text-white/60">If you don't see your content, please update.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onRefreshGallery}
                  disabled={galleryBusy || galleryForcePullBusy || galleryActionsLocked}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {galleryBusy ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  type="button"
                  onClick={onForcePullGallery}
                  disabled={galleryBusy || galleryForcePullBusy || galleryActionsLocked}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {galleryForcePullBusy ? "Updating Content..." : "Update Content"}
                </button>
              </div>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <input
                value={gallerySearch}
                onChange={(e) => onGallerySearchChange(e.target.value)}
                placeholder="Search by name"
                className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <select
                value={galleryFilter}
                onChange={(e) => onGalleryFilterChange(e.target.value as "all" | "images" | "videos")}
                className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                <option value="all">All</option>
                <option value="images">Images</option>
                <option value="videos">Videos</option>
              </select>
              <select
                value={gallerySort}
                onChange={(e) => onGallerySortChange(e.target.value as "newest" | "oldest" | "name")}
                className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
              </select>
              <select
                value={galleryViewMode}
                onChange={(e) => onGalleryViewModeChange(e.target.value as GalleryViewMode)}
                className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                <option value="default">Default cards</option>
                <option value="grid">Grid view</option>
                <option value="list">List view</option>
              </select>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/60" style={MEDIA_CARD_STYLE}>
              <div>{gallerySummary}</div>
              <div>{galleryHasRefinements ? "Filtered results are active." : "Showing all gallery content."}</div>
            </div>

            <div className="mb-4">
              <PaginationBar
                totalItems={galleryItems.length}
                page={galleryPage}
                totalPages={galleryTotalPages}
                pageSize={galleryItemsPerPage}
                onPageChange={onGalleryPageChange}
                onPageSizeChange={onGalleryItemsPerPageChange}
              />
            </div>

            <MediaGrid
              items={visibleGalleryItems}
              viewMode={galleryViewMode}
              busyName={galleryActionBusyName}
              busyKind={galleryActionBusyKind}
              actionsLocked={galleryActionsLocked}
              emptyStateTitle={galleryHasRefinements ? "No gallery items match your current filters." : "No gallery items yet."}
              emptyStateDetail={galleryHasRefinements ? "Clear the search or adjust the filters, then try Update Content again if needed." : "Generate or sync content first. If you do not see expected items, use Update Content."}
              onDownload={onDownload}
              onFavorite={onFavorite}
              onRename={onRename}
              onRedo={onRedo}
              onEdit={onEdit}
              onAnimate={onAnimate}
              onExtend={onExtend}
              onCreateCharacter={onCreateCharacter}
              onDelete={onDelete}
              onOpenViewer={onOpenViewer}
            />

            <div className="mt-4">
              <PaginationBar
                totalItems={galleryItems.length}
                page={galleryPage}
                totalPages={galleryTotalPages}
                pageSize={galleryItemsPerPage}
                onPageChange={onGalleryPageChange}
                onPageSizeChange={onGalleryItemsPerPageChange}
              />
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "favorites" ? (
        <div className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-black/45 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_0_40px_rgba(80,80,180,0.08)] backdrop-blur-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tight text-white">Favorites</h1>
                <p className="text-sm text-white/60">Saved gallery items only. Use filters here without changing the Gallery tab view.</p>
              </div>
              <button
                type="button"
                onClick={onRefreshFavorites}
                disabled={favoritesBusy || galleryActionsLocked}
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {favoritesBusy ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <input
                value={safeFavoritesSearch}
                onChange={(e) => handleFavoritesSearchChange(e.target.value)}
                placeholder="Search favorites by name"
                className="w-full rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <select
                value={safeFavoritesFilter}
                onChange={(e) => handleFavoritesFilterChange(e.target.value as "all" | "images" | "videos")}
                className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                <option value="all">All</option>
                <option value="images">Images</option>
                <option value="videos">Videos</option>
              </select>
              <select
                value={safeFavoritesSort}
                onChange={(e) => handleFavoritesSortChange(e.target.value as "newest" | "oldest" | "name")}
                className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
              </select>
              <select
                value={safeFavoritesViewMode}
                onChange={(e) => handleFavoritesViewModeChange(e.target.value as GalleryViewMode)}
                className="rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45"
              >
                <option value="default">Default cards</option>
                <option value="grid">Grid view</option>
                <option value="list">List view</option>
              </select>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-black/25 px-4 py-3 text-sm text-white/60" style={MEDIA_CARD_STYLE}>
              <div>{favoritesSummary}{favoritesRawCount !== favoriteItems.length ? ` from ${favoritesRawCount} total` : ""}</div>
              <div className="flex flex-wrap items-center gap-3">
                <span>{favoritesHasRefinements ? "Filtered favorites are active." : "Heart items in Gallery to keep them here."}</span>
                {favoritesHasRefinements ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleFavoritesSearchChange("");
                      handleFavoritesFilterChange("all");
                      handleFavoritesSortChange("newest");
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mb-4">
              <PaginationBar
                totalItems={favoriteItems.length}
                page={favoritesPage}
                totalPages={favoritesTotalPages}
                pageSize={favoritesItemsPerPage}
                onPageChange={onFavoritesPageChange}
                onPageSizeChange={onFavoritesItemsPerPageChange}
              />
            </div>

            <MediaGrid
              items={visibleFavoriteItems}
              viewMode={safeFavoritesViewMode}
              busyName={galleryActionBusyName}
              busyKind={galleryActionBusyKind}
              actionsLocked={galleryActionsLocked}
              emptyStateTitle="No favorites yet."
              emptyStateDetail="Use Heart on any Gallery item to save it here for quick access."
              onDownload={onDownload}
              onFavorite={onFavorite}
              onRename={onRename}
              onRedo={onRedo}
              onEdit={onEdit}
              onAnimate={onAnimate}
              onExtend={onExtend}
              onDelete={onDelete}
              onOpenViewer={onOpenViewer}
            />

            <div className="mt-4">
              <PaginationBar
                totalItems={favoriteItems.length}
                page={favoritesPage}
                totalPages={favoritesTotalPages}
                pageSize={favoritesItemsPerPage}
                onPageChange={onFavoritesPageChange}
                onPageSizeChange={onFavoritesItemsPerPageChange}
              />
            </div>
          </div>
        </div>
      ) : null}

      {viewerState && viewerItem && viewerUrl ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/90 p-4" onClick={onCloseViewer}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col gap-3 rounded-[28px] border border-white/10 bg-[#060912] p-4 shadow-[0_0_50px_rgba(0,0,0,0.55)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white/80">{viewerTitle}</div>
                <div className="mt-1 text-xs text-white/45">
                  {viewerItems.length > 0 && viewerIndex >= 0 ? `${viewerIndex + 1} of ${viewerItems.length}` : viewerIsVideo ? "Video" : "Image"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onMoveViewer("prev")}
                  disabled={!viewerCanPrev}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => onMoveViewer("next")}
                  disabled={!viewerCanNext}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={onCloseViewer}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[24px] border border-white/10 bg-black/65" onTouchStart={onViewerTouchStart} onTouchEnd={onViewerTouchEnd}>
              {viewerCanPrev ? (
                <button
                  type="button"
                  onClick={() => onMoveViewer("prev")}
                  className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-3 text-sm font-semibold text-white/90 hover:bg-black/75"
                  aria-label="Previous item"
                >
                  {"<"}
                </button>
              ) : null}
              {viewerIsVideo ? (
                <video src={viewerUrl} poster={buildGalleryThumbUrl(viewerItem, 1280)} className="max-h-[78vh] w-full object-contain" controls autoPlay playsInline preload="auto" />
              ) : (
                <img src={viewerUrl} alt={viewerTitle} className="max-h-[78vh] w-full object-contain" />
              )}
              {viewerCanNext ? (
                <button
                  type="button"
                  onClick={() => onMoveViewer("next")}
                  className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-3 text-sm font-semibold text-white/90 hover:bg-black/75"
                  aria-label="Next item"
                >
                  {">"}
                </button>
              ) : null}
            </div>
            {viewerItems.length > 1 ? (
              <div className="text-center text-xs text-white/45">Swipe left or right, or use the arrow keys, to move through the gallery without closing the viewer.</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {editModal ? (
        <ModalShell title="Edit Image" onClose={onCloseEditModal}>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/50">
              <div className="aspect-[4/3] bg-black/60">
                <img src={editModal.item.url} alt={editModal.item.name || "Edit source"} className="h-full w-full object-contain" />
              </div>
            </div>
            <div className="space-y-4">
              <textarea
                value={editModal.positivePrompt}
                onChange={(e) => onEditPositivePromptChange(e.target.value)}
                rows={6}
                placeholder="Positive Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <textarea
                value={editModal.negativePrompt}
                onChange={(e) => onEditNegativePromptChange(e.target.value)}
                rows={5}
                placeholder="Negative Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onEnhanceEdit}
                  disabled={editModal.enhancing || !editModal.positivePrompt.trim()}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editModal.enhancing ? "Enhancing..." : "Enhance"}
                </button>
                <button
                  type="button"
                  onClick={onSubmitEdit}
                  disabled={galleryActionsLocked || editModal.enhancing}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {galleryActionBusyName === getGalleryItemKey(editModal.item) && galleryActionBusyKind === "edit-submit" ? "Submitting..." : "Submit"}
                </button>
                <button
                  type="button"
                  onClick={onCloseEditModal}
                  disabled={galleryActionsLocked || editModal.enhancing}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {animateModal ? (
        <ModalShell title="Animate Image" onClose={onCloseAnimateModal}>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/50">
              <div className="aspect-[4/3] bg-black/60">
                <img src={animateModal.item.url} alt={animateModal.item.name || "Animate source"} className="h-full w-full object-contain" />
              </div>
            </div>
            <div className="space-y-4">
              <textarea
                value={animateModal.positivePrompt}
                onChange={(e) => onAnimatePositivePromptChange(e.target.value)}
                rows={6}
                placeholder="Positive Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <textarea
                value={animateModal.negativePrompt}
                onChange={(e) => onAnimateNegativePromptChange(e.target.value)}
                rows={5}
                placeholder="Negative Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <div className="space-y-2">
                <div className="text-sm font-semibold text-white/80">Duration: {animateModal.durationSeconds} seconds</div>
                <input
                  type="range"
                  min={5}
                  max={15}
                  step={1}
                  value={animateModal.durationSeconds}
                  onChange={(e) => onAnimateDurationChange(Number(e.target.value))}
                  className="w-full accent-violet-400"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onEnhanceAnimate}
                  disabled={animateModal.enhancing || !animateModal.positivePrompt.trim()}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {animateModal.enhancing ? "Enhancing..." : "Enhance"}
                </button>
                <button
                  type="button"
                  onClick={onSubmitAnimate}
                  disabled={galleryActionsLocked || animateModal.enhancing}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {galleryActionBusyName === getGalleryItemKey(animateModal.item) && galleryActionBusyKind === "animate-submit" ? "Submitting..." : "Submit"}
                </button>
                <button
                  type="button"
                  onClick={onCloseAnimateModal}
                  disabled={galleryActionsLocked || animateModal.enhancing}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {extendModal ? (
        <ModalShell title="Extend Video (last-frame continue)" onClose={onCloseExtendModal}>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4 overflow-hidden rounded-[24px] border border-white/10 bg-black/50 p-4">
              <div className="overflow-hidden rounded-[20px] border border-white/10 bg-black/60">
                <div className={cn("bg-black/70", extendModal.orientation === "portrait" ? "aspect-[9/16]" : "aspect-video")}>
                  <img src={extendModal.frameUrl} alt={extendModal.item.name || "Extend source"} className="h-full w-full object-contain" />
                </div>
              </div>
              <div className="space-y-2 text-sm text-white/70">
                <div><span className="font-semibold text-white/85">Source:</span> {extendModal.item.name || getGalleryItemKey(extendModal.item)}</div>
                <div><span className="font-semibold text-white/85">Orientation:</span> {extendModal.orientation}</div>
                <div><span className="font-semibold text-white/85">Frame:</span> tail frame prepared from the selected video</div>
                <div><span className="font-semibold text-white/85">Mode:</span> uses the prepared last frame to continue the clip through the Gallery video workflow</div>
              </div>
            </div>
            <div className="space-y-4">
              <textarea
                value={extendModal.positivePrompt}
                onChange={(e) => onExtendPositivePromptChange(e.target.value)}
                rows={6}
                placeholder="Positive Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <textarea
                value={extendModal.negativePrompt}
                onChange={(e) => onExtendNegativePromptChange(e.target.value)}
                rows={5}
                placeholder="Negative Prompt"
                className="w-full rounded-[24px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none placeholder:text-white/35 focus:border-cyan-400/45"
              />
              <div className="space-y-2">
                <div className="text-sm font-semibold text-white/80">Duration: {extendModal.durationSeconds} seconds</div>
                <input
                  type="range"
                  min={5}
                  max={15}
                  step={1}
                  value={extendModal.durationSeconds}
                  onChange={(e) => onExtendDurationChange(Number(e.target.value))}
                  className="w-full accent-amber-400"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onClearExtendPrompts}
                  disabled={galleryActionsLocked || extendModal.enhancing}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={onEnhanceExtend}
                  disabled={extendModal.enhancing || !extendModal.positivePrompt.trim()}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {extendModal.enhancing ? "Enhancing..." : "Enhance"}
                </button>
                <button
                  type="button"
                  onClick={onSubmitExtend}
                  disabled={galleryActionsLocked || extendModal.enhancing}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-cyan-400/20 bg-[linear-gradient(90deg,rgba(145,92,255,0.35),rgba(40,200,255,0.28))] px-5 py-3 text-base font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {galleryActionBusyName === getGalleryItemKey(extendModal.item) && galleryActionBusyKind === "extend-submit" ? "Extending..." : "Extend"}
                </button>
                <button
                  type="button"
                  onClick={onCloseExtendModal}
                  disabled={galleryActionsLocked || extendModal.enhancing}
                  className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
});

export default GalleryWorkspace;
