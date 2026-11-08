"use client";

import { useRef, useState, type ReactNode, type SyntheticEvent } from "react";

const previewButton = "rounded-lg border border-white/20 bg-black/80 px-3 py-2 text-xs font-semibold text-white";

function Preview({title, children, expanded, image = false}: {
  title: string; children: ReactNode; expanded: (position: number) => ReactNode; image?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inline = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<number | null>(null);

  function show() {
    const player = inline.current?.querySelector<HTMLMediaElement>("video, audio");
    player?.pause();
    dialog.current?.showModal();
    setPosition(player?.currentTime || 0);
  }

  return <div className="relative min-w-0 w-full">
    <div ref={inline} className="min-w-0">
      {image ? <button type="button" aria-label={`Expand ${title}`} onClick={show}
        className="relative block w-full cursor-zoom-in rounded-xl focus-visible:outline focus-visible:outline-cyan-300">
        {children}<span className={`absolute right-2 top-2 ${previewButton}`}>Expand</span>
      </button> : <>{children}<button type="button" onClick={show} className={`mt-2 ${previewButton}`}>Expand player</button></>}
    </div>
    <dialog ref={dialog} aria-label={title} onClose={() => {
      const player = inline.current?.querySelector<HTMLMediaElement>("video, audio");
      const expandedPlayer = dialog.current?.querySelector<HTMLMediaElement>("video, audio");
      if (player && expandedPlayer && expandedPlayer.readyState > 0) player.currentTime = expandedPlayer.currentTime;
      setPosition(null);
    }}
      className="m-auto max-h-[94dvh] w-[min(94vw,72rem)] overflow-auto rounded-xl border border-white/20 bg-slate-950 p-3 text-white backdrop:bg-black/80">
      <div className="mb-2 flex items-center justify-between gap-3">
        <strong className="min-w-0 break-words">{title}</strong>
        <button type="button" onClick={() => dialog.current?.close()} className={previewButton}>Close</button>
      </div>
      {position !== null ? expanded(position) : null}
    </dialog>
  </div>;
}

export function StoryImagePreview({src, alt, className}: {src: string; alt: string; className: string}) {
  return <Preview title={alt} image expanded={() =>
    <img src={src} alt={alt} className="mx-auto max-h-[80dvh] max-w-full object-contain"/>}>
    <img src={src} alt={alt} loading="lazy" className={className}/>
  </Preview>;
}

export function StoryMediaPreview({src, title, kind, className}: {
  src: string; title: string; kind: "video" | "audio"; className: string;
}) {
  function player(style: string, position = 0) {
    const props = {controls: true, preload: "metadata", src, className: style, "aria-label": title,
      onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
        if (position > 0) event.currentTarget.currentTime = Math.min(position, event.currentTarget.duration);
      }};
    return kind === "video" ? <video {...props} playsInline/> : <audio {...props}/>;
  }
  return <Preview title={title} expanded={position => player("mx-auto max-h-[80dvh] w-full", position)}>
    {player(className)}
  </Preview>;
}
