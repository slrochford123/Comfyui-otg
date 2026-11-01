"use client";

import * as React from "react";
import ExpandedMediaViewer from "./ExpandedMediaViewer";

type MediaPreviewPanelProps = {
  url: string;
  kind: "image" | "video" | "";
  name?: string;
  meta?: string;
  onClear?: () => void;
  onRefresh?: () => void;
  onReset?: () => void;
  refreshing?: boolean;
};

export default function MediaPreviewPanel({
  url,
  kind,
  name,
  meta,
  onClear,
  onRefresh,
  onReset,
  refreshing,
}: MediaPreviewPanelProps) {
  const [expanded, setExpanded] = React.useState(false);
  const panel = React.useRef<HTMLDivElement>(null);
  function expand() { panel.current?.querySelector("video")?.pause(); setExpanded(true); }
  const isVideo = kind === "video";
  const isImage = kind === "image";
  const canShow = Boolean(url && (isVideo || isImage));

  const preview = canShow ? (
    isVideo ? (
      <video src={url} className="h-full w-full object-contain" controls playsInline />
    ) : (
      <img src={url} alt={name || "Generated preview"} className="h-full w-full object-contain" />
    )
  ) : (
    <div className="flex h-full items-center justify-center px-6 text-center text-white/45">
      Preview will appear here after generation finishes.
    </div>
  );

  return (
    <div ref={panel} className="space-y-3" data-otg="shared-media-preview">
      <div className="block w-full overflow-hidden rounded-[24px] border border-white/10 bg-black/45">
        {isVideo ? <div className="aspect-[16/9] bg-black/60">{preview}</div> : <button type="button" disabled={!canShow} onClick={expand} className="block w-full text-left" aria-label={canShow ? "Expand generated media preview" : "Generated media preview is empty"}><div className="aspect-[16/9] bg-black/60">{preview}</div></button>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/60">
        <div className="min-w-0 space-y-1">
          <div className="truncate">{name || "No completed output yet"}</div>
          <div className="text-xs text-white/45">{meta || "Generate content to update this preview."}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onRefresh ? <button type="button" onClick={onRefresh} disabled={refreshing} className="min-h-10 rounded-xl border border-white/10 px-3 text-sm font-bold text-white/70 disabled:opacity-40">Refresh</button> : null}
          {canShow ? <button type="button" onClick={expand} className="min-h-10 rounded-xl border border-white/10 px-3 text-sm font-bold text-white/70">Expand</button> : null}
          {canShow ? <a href={url} download className="inline-flex min-h-10 items-center rounded-xl border border-white/10 px-3 text-sm font-bold text-white/70">Download</a> : null}
          {onClear ? <button type="button" onClick={onClear} disabled={!canShow} className="min-h-10 rounded-xl border border-white/10 px-3 text-sm font-bold text-white/70 disabled:opacity-40">Clear Preview</button> : null}
          {onReset ? <button type="button" onClick={onReset} className="min-h-10 rounded-xl border border-red-300/20 px-3 text-sm font-bold text-red-100">Reset</button> : null}
        </div>
      </div>
      {expanded && canShow ? <ExpandedMediaViewer url={url} kind={isVideo ? "video" : "image"} name={name || "Generated media preview"} onClose={() => setExpanded(false)} /> : null}
    </div>
  );
}
