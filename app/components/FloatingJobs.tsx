"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type FloatingJob = {
  id: string; // prompt_id or a local id
  title: string;
  status: "submitted" | "running" | "done" | "error";
  createdAt: number;
};

type Props = {
  jobs: FloatingJob[];
  onSelect?: (jobId: string) => void;
};

type Pos = { x: number; y: number };

const LS_KEY = "otg_floating_jobs_pos_v1";

export default function FloatingJobs({ jobs, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 16, y: 160 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (typeof j?.x === "number" && typeof j?.y === "number") setPos({ x: j.x, y: j.y });
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(pos));
    } catch {}
  }, [pos]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({ x: Math.max(8, dragRef.current.baseX + dx), y: Math.max(8, dragRef.current.baseY + dy) });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const runningCount = useMemo(() => jobs.filter((j) => j.status === "submitted" || j.status === "running").length, [jobs]);
  const totalCount = jobs.length;

  return (
    <div
      className="fixed z-[999]"
      style={{ right: `${pos.x}px`, bottom: `${pos.y}px` }}
    >
      <div
        className="select-none"
        onPointerDown={(e) => {
          // drag from the header area only
          const t = e.target as HTMLElement;
          if (!t.closest("[data-drag-handle='1']")) return;
          dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
        }}
      >
        <div
          data-drag-handle="1"
          className="cursor-grab active:cursor-grabbing rounded-full border border-white/15 bg-black/40 px-3 py-2 shadow-lg backdrop-blur"
        >
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2"
            aria-label="Toggle generation queue"
          >
            <span className="text-sm font-semibold">Jobs</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">
              {runningCount}/{totalCount}
            </span>
          </button>
        </div>

        {open ? (
          <div className="mt-2 w-[320px] max-w-[80vw] rounded-2xl border border-white/10 bg-black/50 p-3 shadow-xl backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">Generation Queue</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>

            {jobs.length === 0 ? (
              <div className="text-xs opacity-70">No generations yet.</div>
            ) : (
              <div className="max-h-[45vh] overflow-auto space-y-2">
                {jobs
                  .slice()
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((j) => (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => onSelect?.(j.id)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium line-clamp-1">{j.title || "Untitled"}</div>
                        <div className="text-[10px] rounded-full border border-white/10 bg-black/20 px-2 py-0.5 opacity-90">
                          {j.status}
                        </div>
                      </div>
                      <div className="mt-1 text-[10px] opacity-70">{new Date(j.createdAt).toLocaleString()}</div>
                    </button>
                  ))}
              </div>
            )}

            <div className="mt-2 text-[10px] opacity-60">
              Tip: drag the pill to move it.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
