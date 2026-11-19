"use client";
import React from "react";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ExtractionPlayerSource } from "@/lib/videoCharacters/playerSource";

const VideoCharacterLab = dynamic(() => import("./VideoCharacterLab"));
export default function ExtractCharactersAction({ engine, jobId, fileName }: ExtractionPlayerSource) {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setAllowed(false);
    setOpen(false);
    if (!jobId) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ engine, playerJob: jobId, ...(fileName ? {fileName} : {}) });
    void fetch("/api/experiments/video-characters?" + query, {cache:"no-store",signal:abort.signal})
      .then(response => {if(!abort.signal.aborted) setAllowed(response.ok);}).catch(() => undefined);
    return () => abort.abort();
  }, [engine,jobId,fileName]);
  if (!allowed) return null;
  return <div className="my-2">
    <button className="min-h-11 rounded-lg border border-white/20 px-3 text-sm" type="button"
      aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Close extraction" : "Extract Characters"}</button>
    {open && <VideoCharacterLab player={{engine,jobId,fileName}} />}
  </div>;
}
