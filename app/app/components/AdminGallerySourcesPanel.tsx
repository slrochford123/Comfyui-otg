"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SourceId = "comfy-3090" | "comfy-5060";
type SourceFilter = "all" | SourceId;
type MediaFilter = "all" | "images" | "videos";
type Sort = "newest" | "oldest" | "name";
type ViewMode = "default" | "grid" | "list";

type Source = { id: SourceId; label: string; description: string; kind: string };
type Status = { id: SourceId; label: string; ok: boolean; count: number; error?: string };
type Item = {
  id: string;
  source: SourceId;
  sourceLabel: string;
  name: string;
  rel: string;
  kind: "image" | "video";
  mimeType: string;
  bytes: number;
  mtimeMs: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  url: string;
};
type Payload = { ok: boolean; items?: Item[]; sources?: Source[]; statuses?: Status[]; hasMore?: boolean; error?: string };

const PAGE_SIZE = 48;
const SOURCE_OPTIONS: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All Sources" },
  { id: "comfy-3090", label: "RTX 3090 ComfyUI" },
  { id: "comfy-5060", label: "RTX 5060 Ti ComfyUI" },
];

export default function AdminGallerySourcesPanel() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("default");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [viewerId, setViewerId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async (append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setMessage("");
    try {
      const offset = append ? items.length : 0;
      const params = new URLSearchParams({ source: sourceFilter, offset: String(offset), limit: String(PAGE_SIZE) });
      const response = await fetch(`/api/admin/gallery-sources?${params.toString()}`, { cache: "no-store", credentials: "include" });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error || `Full Gallery load failed (${response.status}).`);
      setItems((current) => append ? dedupeItems([...current, ...(data.items || [])]) : dedupeItems(data.items || []));
      setStatuses(data.statuses || []);
      setHasMore(Boolean(data.hasMore));
      if (!data.ok) setMessage("No configured Full Gallery source is currently healthy.");
    } catch (error) {
      if (!append) setItems([]);
      setMessage(error instanceof Error ? error.message : "Unable to load Admin Full Gallery.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [items.length, sourceFilter]);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { void load(false); }, [sourceFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => mediaFilter === "all" || (mediaFilter === "images" ? item.kind === "image" : item.kind === "video"))
      .filter((item) => !query || item.name.toLowerCase().includes(query) || item.rel.toLowerCase().includes(query))
      .sort((a, b) => sort === "oldest"
        ? a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id)
        : sort === "name"
          ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
          : b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
  }, [items, mediaFilter, search, sort]);

  const viewerIndex = visibleItems.findIndex((item) => item.id === viewerId);
  const viewerItem = viewerIndex >= 0 ? visibleItems[viewerIndex] : null;
  const moveViewer = useCallback((direction: -1 | 1) => {
    if (viewerIndex < 0) return;
    const next = visibleItems[viewerIndex + direction];
    if (next) setViewerId(next.id);
  }, [viewerIndex, visibleItems]);

  useEffect(() => {
    if (!viewerItem) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerId("");
      if (event.key === "ArrowLeft") moveViewer(-1);
      if (event.key === "ArrowRight") moveViewer(1);
    };
    window.addEventListener("keydown", keydown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [moveViewer, viewerItem]);

  const deleteItem = useCallback(async (item: Item) => {
    if (!window.confirm(`Delete "${item.name}"? This permanently removes the source file.`)) return;
    setDeletingId(item.id);
    setMessage("");
    try {
      const response = await fetch(item.url, { method: "DELETE", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Delete failed.");
      setViewerId("");
      setMessage("Gallery item deleted.");
      await load(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId("");
    }
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="rounded-[28px] border border-white/10 bg-black/45 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-cyan-200/70">Settings / Admin</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-white">Full Gallery</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/62">Administrator-only, read-through browsing of both configured ComfyUI output filesystems. Files are never copied into the normal Gallery.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/app/admin" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-white/10">Admin</a>
            <button type="button" onClick={() => void load(false)} disabled={loading} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-50">
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" disabled title="Full Gallery reads source files directly; content synchronization does not apply." className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white opacity-50">
              Update Content
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2" aria-label="Full Gallery source filters">
          {SOURCE_OPTIONS.map((option) => (
            <button key={option.id} type="button" onClick={() => setSourceFilter(option.id)} className={sourceFilter === option.id ? activePill : inactivePill}>
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" className={controlClass} />
          <select value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value as MediaFilter)} className={controlClass}>
            <option value="all">All</option><option value="images">Images</option><option value="videos">Videos</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className={controlClass}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option>
          </select>
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)} className={controlClass}>
            <option value="default">Default cards</option><option value="grid">Grid view</option><option value="list">List view</option>
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {statuses.map((status) => (
          <div key={status.id} className={`rounded-[20px] border p-4 ${status.ok ? "border-emerald-400/20 bg-emerald-500/10" : "border-red-400/20 bg-red-500/10"}`}>
            <div className="flex items-center justify-between gap-3"><span className="font-black text-white">{status.label}</span><span className="text-xs font-black uppercase text-white/65">{status.ok ? "Healthy" : "Unavailable"}</span></div>
            <div className="mt-1 text-sm text-white/65">{status.ok ? `${status.count} supported media files reported` : status.error || "Source unavailable."}</div>
          </div>
        ))}
      </div>

      {message ? <div className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">{message}</div> : null}
      {loading ? <div className="rounded-[22px] border border-white/10 bg-black/35 p-6 text-center text-white/60">Loading Full Gallery…</div> : null}
      {!loading && !visibleItems.length ? <div className="rounded-[22px] border border-dashed border-white/10 bg-black/30 p-6 text-center text-white/60">No supported media files match this view.</div> : null}

      <div className={viewMode === "list" ? "space-y-3" : viewMode === "grid" ? "grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>
        {visibleItems.map((item) => (
          <MediaCard key={item.id} item={item} compact={viewMode === "grid"} list={viewMode === "list"} deleting={deletingId === item.id} onOpen={() => setViewerId(item.id)} onDelete={() => void deleteItem(item)} />
        ))}
      </div>

      {hasMore ? <div className="flex justify-center"><button type="button" onClick={() => void load(true)} disabled={loadingMore} className="rounded-full border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white hover:bg-white/10 disabled:opacity-50">{loadingMore ? "Loading..." : "Load More"}</button></div> : null}

      {mounted && viewerItem ? createPortal(
        <MixedMediaViewer item={viewerItem} index={viewerIndex} total={visibleItems.length} canPrev={viewerIndex > 0} canNext={viewerIndex < visibleItems.length - 1} onPrev={() => moveViewer(-1)} onNext={() => moveViewer(1)} onClose={() => setViewerId("")} />,
        document.body,
      ) : null}
    </section>
  );
}

function MediaCard({ item, compact, list, deleting, onOpen, onDelete }: { item: Item; compact: boolean; list: boolean; deleting: boolean; onOpen: () => void; onDelete: () => void }) {
  const disabledReason = "This Standard Gallery action is disabled because Full Gallery items are filesystem-backed and have no normal Gallery record.";
  return (
    <article className={`overflow-hidden rounded-[24px] border border-white/10 bg-black/35 ${list ? "flex flex-col gap-3 p-3 md:flex-row md:items-center" : "p-3"}`}>
      <button type="button" onClick={onOpen} className={list ? "min-w-0 flex-1 text-left" : "block w-full text-left"}>
        {!list ? <div className={compact ? "aspect-square overflow-hidden rounded-[18px] bg-black/60" : "aspect-[4/3] overflow-hidden rounded-[18px] bg-black/60"}>
          {item.kind === "video" ? <video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-contain" /> : <img src={item.url} alt={item.name} loading="lazy" className="h-full w-full object-contain" />}
        </div> : null}
        <div className={list ? "" : "mt-3"}>
          <div className="flex flex-wrap items-start justify-between gap-2"><span className="break-all font-semibold text-white/90">{item.name}</span><SourceBadge label={item.sourceLabel} /></div>
          <div className="mt-1 break-all text-xs text-white/45">{item.rel}</div>
          <div className="mt-1 text-xs text-white/45">{new Date(item.mtimeMs).toLocaleString()} · {formatBytes(item.bytes)} · {item.kind === "video" ? "Video" : "Image"}</div>
        </div>
      </button>
      <div className={`flex flex-wrap gap-2 ${list ? "md:shrink-0" : "mt-3"}`}>
        <a href={`${item.url}&download=1`} download={item.name} className={actionClass}>Download</a>
        <button type="button" disabled title={disabledReason} className={disabledActionClass}><IconHeart />Heart</button>
        {item.kind === "image" ? <><button type="button" disabled title={disabledReason} className={disabledActionClass}>Edit</button><button type="button" disabled title={disabledReason} className={disabledActionClass}>Animate</button><button type="button" disabled title={disabledReason} className={disabledActionClass}>Characters</button></> : <button type="button" disabled title={disabledReason} className={disabledActionClass}>Extend</button>}
        <button type="button" disabled title={disabledReason} className={disabledActionClass}>Rename</button>
        <button type="button" disabled title={disabledReason} className={disabledActionClass}>Redo</button>
        <button type="button" onClick={onDelete} disabled={deleting} className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-500/15 disabled:opacity-50">{deleting ? "Deleting..." : "Delete"}</button>
      </div>
    </article>
  );
}

function MixedMediaViewer({ item, index, total, canPrev, canNext, onPrev, onNext, onClose }: { item: Item; index: number; total: number; canPrev: boolean; canNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const touch = useRef<{ x: number; y: number } | null>(null);
  return <div className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/90 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={`Full Gallery viewer: ${item.name}`} onClick={onClose}>
    <div className="flex max-h-[100dvh] w-full max-w-6xl flex-col gap-3 rounded-[20px] border border-white/10 bg-[#060912] p-3 sm:max-h-[92vh] sm:rounded-[28px] sm:p-4" onClick={(event) => event.stopPropagation()}>
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-[#060912]">
        <div className="min-w-0"><div className="truncate text-sm font-semibold text-white/80">{item.name}</div><div className="mt-1 flex items-center gap-2 text-xs text-white/45"><SourceBadge label={item.sourceLabel} /><span>{index + 1} of {total}</span></div></div>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button type="button" onClick={onPrev} disabled={!canPrev} className={viewerButtonClass}>Prev</button>
          <button type="button" onClick={onNext} disabled={!canNext} className={viewerButtonClass}>Next</button>
          <button type="button" onClick={onClose} className={viewerButtonClass}>Close</button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[18px] border border-white/10 bg-black/65" onTouchStart={(event) => { const point = event.changedTouches[0]; if (point) touch.current = { x: point.clientX, y: point.clientY }; }} onTouchEnd={(event) => { const start = touch.current; touch.current = null; const point = event.changedTouches[0]; if (!start || !point) return; const dx = point.clientX - start.x; const dy = point.clientY - start.y; if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? onNext() : onPrev(); }}>
        {canPrev ? <button type="button" onClick={onPrev} aria-label="Previous item" className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-3 text-white">{"<"}</button> : null}
        {item.kind === "video" ? <video key={item.id} src={item.url} className="max-h-[78dvh] w-full object-contain" controls autoPlay playsInline preload="metadata" /> : <img key={item.id} src={item.url} alt={item.name} className="max-h-[78dvh] w-full object-contain" />}
        {canNext ? <button type="button" onClick={onNext} aria-label="Next item" className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/55 px-3 py-3 text-white">{">"}</button> : null}
      </div>
      {total > 1 ? <div className="text-center text-xs text-white/45">Swipe left or right, or use the arrow keys, to move through the gallery without closing the viewer.</div> : null}
    </div>
  </div>;
}

function SourceBadge({ label }: { label: string }) { return <span className="shrink-0 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-cyan-100">{label}</span>; }
function IconHeart() { return <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true"><path d="M12 20.5s-7-4.35-7-10a4 4 0 0 1 7-2.47A4 4 0 0 1 19 10.5c0 5.65-7 10-7 10Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function dedupeItems(items: Item[]) { const seen = new Set<string>(); return items.filter((item) => !seen.has(item.id) && seen.add(item.id)); }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(1)} GB`; }

const controlClass = "rounded-[22px] border border-white/10 bg-black/55 px-5 py-4 text-white outline-none focus:border-cyan-400/45";
const activePill = "rounded-full border border-cyan-300/50 bg-cyan-500/15 px-4 py-2 text-sm font-black text-cyan-50";
const inactivePill = "rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-white/10";
const actionClass = "rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/85 no-underline hover:bg-white/10";
const disabledActionClass = "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 opacity-50";
const viewerButtonClass = "rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4";
